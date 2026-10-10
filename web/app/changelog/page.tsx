/**
 * changelog — app/changelog/page.tsx
 *
 * Reads ../data/change_log.json if the daily pipeline has produced it. The file
 * is OPTIONAL by design: when it is absent (first deploy, or a pipeline that has
 * not run yet) this page renders a graceful empty state that explains where the
 * log comes from, instead of erroring out.
 */
import Link from 'next/link';
import type { Metadata } from 'next';

import { EmptyState, Pill, SectionCard } from '@/components/ui';
import { getChangeLog, getChangeLogMtime, getWorkIdToSlugMap } from '@/lib/data';
import { formatTimestamp, relativeAge, displayValue } from '@/lib/policy';
import type { ChangeLogEntry } from '@/lib/types';

export const metadata: Metadata = {
  title: '更新日誌',
  description: '每日排程管線對資料集所做的變更紀錄。',
};

const CHANGE_TYPE_LABELS: Record<string, string> = {
  created: '新增',
  updated: '更新',
  field_changed: '欄位變更',
  removed: '移除',
  unchanged: '無變化',
};

function changeTone(changeType: string): 'official' | 'editorial' | 'derived' | 'none' {
  if (changeType === 'created') return 'official';
  if (changeType === 'removed') return 'editorial';
  if (changeType === 'field_changed' || changeType === 'updated') return 'derived';
  return 'none';
}

function EntryRow({ entry, slug }: { entry: ChangeLogEntry; slug: string | undefined }) {
  return (
    <li className="flex flex-col gap-1 border-b border-zinc-100 py-2 last:border-b-0 sm:flex-row sm:items-start sm:gap-3">
      <span className="shrink-0">
        <Pill tone={changeTone(entry.change_type)}>{CHANGE_TYPE_LABELS[entry.change_type] ?? entry.change_type}</Pill>
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-baseline gap-2">
          {slug ? (
            <Link href={`/works/${slug}`} className="font-medium">
              {typeof entry.new_value === 'string' && entry.new_value ? entry.new_value : slug}
            </Link>
          ) : (
            <span className="font-medium text-zinc-700">
              {typeof entry.new_value === 'string' && entry.new_value ? entry.new_value : entry.work_id}
            </span>
          )}
          <span className="mono text-xs text-zinc-500">{entry.work_id}</span>
          {entry.field_name ? <Pill tone="plain">{entry.field_name}</Pill> : null}
          <span className="text-xs text-zinc-500">{entry.entity_type}</span>
        </div>

        {entry.field_name || entry.old_value !== null || entry.new_value !== null ? (
          <p className="mt-1 text-xs text-zinc-600">
            <span className="text-zinc-500">舊值：</span>
            <code className="mono">{displayValue(entry.old_value)}</code>
            <span className="mx-2 text-zinc-400">→</span>
            <span className="text-zinc-500">新值：</span>
            <code className="mono">
              {typeof entry.new_value === 'string' ? entry.new_value : displayValue(entry.new_value)}
            </code>
          </p>
        ) : null}

        <p className="mt-1 text-xs text-zinc-500">
          偵測時間：{formatTimestamp(entry.detected_at)}
          {entry.source_id ? <> · 來源：{entry.source_id}</> : null}
        </p>
      </div>
    </li>
  );
}

export default function ChangelogPage() {
  const { log, error, path } = getChangeLog();
  const mtime = getChangeLogMtime();
  const idToSlug = getWorkIdToSlugMap();

  const entries = log?.entries ?? [];
  const byType: Record<string, number> = {};
  for (const entry of entries) {
    byType[entry.change_type] = (byType[entry.change_type] ?? 0) + 1;
  }

  // Group by detection timestamp, newest first, so one pipeline run = one block.
  const grouped = new Map<string, ChangeLogEntry[]>();
  for (const entry of entries) {
    const key = entry.detected_at ?? 'unknown';
    const list = grouped.get(key);
    if (list) list.push(entry);
    else grouped.set(key, [entry]);
  }
  const groups = [...grouped.entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0])));

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-bold text-zinc-900">更新日誌</h1>
        <p className="mt-1 text-sm text-zinc-700">
          此頁顯示<strong>每日排程管線</strong>對資料集所做的變更。它是批次產生的紀錄，不是即時活動串；
          站上任何數值都可能落後於上游來源，請以各筆紀錄的 <code className="mono">retrieved_at</code> 為準。
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          檔案路徑：<code className="mono">{path}</code>
          {mtime ? <> · 檔案修改時間：{formatTimestamp(mtime)}（{relativeAge(mtime)}）</> : null}
        </p>
      </section>

      {error ? (
        <EmptyState title="更新日誌檔案無法解析" tone="warn">
          <p className="mono">{error}</p>
          <p className="mt-1">其餘頁面不受影響，仍可正常瀏覽作品資料。</p>
        </EmptyState>
      ) : null}

      {!log && !error ? (
        <SectionCard title="目前沒有可顯示的變更紀錄" subtitle="這是預期中的狀態，不是錯誤。">
          <div className="space-y-3 text-sm text-zinc-700">
            <EmptyState title="更新日誌尚未產生">
              <p>
                <code className="mono">data/change_log.json</code> 不存在。該檔案由<strong>每日排程管線</strong>在每輪採集後寫出：
                管線會比對本輪與上一輪的快照，將「新增作品」「欄位變更」「來源變更」等事件寫入此檔。
              </p>
              <p className="mt-1">
                因此第一次部署、或管線尚未跑過第一輪時，這裡會是空的。管線執行後重新整理本頁即可看到紀錄。
              </p>
            </EmptyState>

            <div className="callout">
              <p className="font-semibold text-zinc-800">日誌會記錄什麼？</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-zinc-700">
                <li>
                  <Pill tone="official">新增</Pill> 資料集中首次出現的作品（附偵測時間與來源）。
                </li>
                <li>
                  <Pill tone="derived">欄位變更</Pill> 某一欄位的值改變，含舊值與新值。
                </li>
                <li>
                  <Pill tone="editorial">移除</Pill> 作品不再出現於上游來源。
                </li>
              </ul>
              <p className="mt-2 text-xs text-zinc-600">
                日誌只記錄<strong>變更事件</strong>，不記錄評論正文；本資料庫沒有評論正文欄位（§5.2 P1）。
              </p>
            </div>

            <p className="text-xs text-zinc-500">
              相關頁面：<Link href="/data-quality">資料品質</Link>（欄位完整度）、
              <Link href="/sources">資料來源</Link>（94 條來源清單）。
            </p>
          </div>
        </SectionCard>
      ) : null}

      {log ? (
        <>
          <SectionCard
            title="本輪摘要"
            subtitle={`本次日誌產生時間：${formatTimestamp(log.generated_at)}`}
          >
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div className="rounded border border-zinc-200 p-2">
                <dt className="text-xs text-zinc-500">總筆數（total）</dt>
                <dd className="text-lg font-semibold tabular-nums">{log.total}</dd>
              </div>
              <div className="rounded border border-zinc-200 p-2">
                <dt className="text-xs text-zinc-500">本輪寫入（latest_run_entries）</dt>
                <dd className="text-lg font-semibold tabular-nums">{log.latest_run_entries}</dd>
              </div>
              <div className="rounded border border-zinc-200 p-2">
                <dt className="text-xs text-zinc-500">實際可顯示筆數</dt>
                <dd className="text-lg font-semibold tabular-nums">{entries.length}</dd>
              </div>
              <div className="rounded border border-zinc-200 p-2">
                <dt className="text-xs text-zinc-500">時間分組</dt>
                <dd className="text-lg font-semibold tabular-nums">{groups.length}</dd>
              </div>
            </dl>

            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(byType).map(([type, count]) => (
                <Pill key={type} tone={changeTone(type)}>
                  {CHANGE_TYPE_LABELS[type] ?? type}：{count}
                </Pill>
              ))}
            </div>

            <p className="mt-3 text-xs text-zinc-500">
              total 是日誌檔內的累計筆數；latest_run_entries 是最近一輪管線寫入的筆數。若兩者不同，代表日誌檔被截斷或僅保留最近一輪。
            </p>
          </SectionCard>

          {groups.map(([detectedAt, items]) => (
            <SectionCard
              key={detectedAt}
              title={`偵測批次：${formatTimestamp(detectedAt)}`}
              subtitle={`${items.length} 筆變更 · ${relativeAge(detectedAt) ?? ''}`}
            >
              <ul>
                {items.map((entry, index) => (
                  <EntryRow
                    key={`${entry.work_id}-${entry.field_name ?? 'record'}-${index}`}
                    entry={entry}
                    slug={idToSlug.get(entry.work_id) ?? idToSlug.get(entry.entity_id)}
                  />
                ))}
              </ul>
            </SectionCard>
          ))}
        </>
      ) : null}
    </div>
  );
}
