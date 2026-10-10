/**
 * sources — app/sources/page.tsx
 *
 * Lists all 94 registered sources from ../sources.yaml:
 *   - 75 under `sources:`     → grouped by `category`
 *   - 19 under `review_sources:` → grouped by `region`, showing
 *     `review_text_available` and `copyright_risk_for_reviews`
 *
 * Each entry shows name / url / method / confidence / status_2026, plus the
 * `display_policy` for review sources (which is what the rating UI obeys).
 */
import Link from 'next/link';
import type { Metadata } from 'next';

import { EmptyState, Pill, SafeLink, SectionCard, UnknownValue } from '@/components/ui';
import { getRegisteredSources, getReviewSources, getSourceIndex, getSourcesFile, groupSourcesByCategory } from '@/lib/data';
import {
  categoryLabel,
  copyrightRiskLabel,
  methodLabel,
  regionLabel,
  reviewTextAvailableLabel,
  sourceConfidenceLabel,
  status2026Label,
} from '@/lib/labels';
import type { RegisteredSource } from '@/lib/types';

export const metadata: Metadata = {
  title: '資料來源',
  description: '本資料庫登錄的全部 94 條資料來源（75 條一般來源 + 19 條評價來源）。',
};

function ConfidencePill({ value }: { value: string | undefined }) {
  const tone = value === 'high' ? 'official' : value === 'low' ? 'editorial' : 'plain';
  return (
    <Pill tone={tone} title={`confidence = ${value ?? 'unknown'}`}>
      可信度：{sourceConfidenceLabel(value)}
    </Pill>
  );
}

function StatusPill({ value }: { value: string | undefined }) {
  // status_2026 is partly free text in the YAML, so unknown values pass through.
  const tone = value === 'active' ? 'official' : value === 'discontinued' ? 'editorial' : 'plain';
  return (
    <Pill tone={tone} title={`status_2026 = ${value ?? 'unknown'}`}>
      2026 現狀：{status2026Label(value)}
    </Pill>
  );
}

function SourceCard({ source, showReviewFields }: { source: RegisteredSource; showReviewFields: boolean }) {
  return (
    <li id={source.id} className="rounded border border-zinc-200 bg-white p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium text-zinc-900">{source.name}</p>
          <p className="mono text-xs text-zinc-500">{source.id}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <ConfidencePill value={source.confidence} />
          <StatusPill value={source.status_2026} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {showReviewFields ? (
          <Pill tone="plain" title="review_sources 沒有 category，改以 region 分組">
            地區：{regionLabel(source.region)}
          </Pill>
        ) : (
          <Pill tone="accent" title={`category = ${source.category ?? 'unknown'}`}>
            {categoryLabel(source.category)}
          </Pill>
        )}
        <Pill tone="plain" title={`method = ${source.method ?? 'unknown'}`}>
          採集方式：{methodLabel(source.method)}
        </Pill>
        {source.source_type ? <Pill tone="plain">{source.source_type}</Pill> : null}
        {typeof source.reachable_from_dev_host === 'boolean' ? (
          <Pill tone={source.reachable_from_dev_host ? 'official' : 'none'}>
            {source.reachable_from_dev_host ? '本機可達' : '本機不可達'}
          </Pill>
        ) : null}
      </div>

      <p className="mt-2">
        <SafeLink href={typeof source.url === 'string' ? source.url : null} className="mono" />
      </p>

      {/* Rating sources carry the policy fields the UI is required to honour. */}
      {showReviewFields ? (
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-zinc-700 sm:grid-cols-2">
          <div>
            <dt className="inline text-zinc-500">可取得的評論內容：</dt>
            <dd className="inline">{reviewTextAvailableLabel(source.review_text_available)}</dd>
          </div>
          <div>
            <dt className="inline text-zinc-500">評論著作權風險：</dt>
            <dd className="inline">{copyrightRiskLabel(source.copyright_risk_for_reviews)}</dd>
          </div>
          {typeof source.display_policy === 'string' ? (
            <div className="sm:col-span-2">
              <dt className="inline text-zinc-500">本專案允許的展示方式：</dt>
              <dd className="inline">{source.display_policy}</dd>
            </div>
          ) : null}
          {typeof source.notes === 'string' ? (
            <div className="sm:col-span-2 text-zinc-600">
              <dt className="inline text-zinc-500">備註：</dt>
              <dd className="inline">{source.notes}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </li>
  );
}

function renderFieldRef(value: unknown, knownIds: Set<string>) {
  const items = Array.isArray(value) ? value : [value];
  return (
    <ul className="flex flex-wrap gap-1">
      {items.map((item, index) => {
        const text = typeof item === 'string' ? item : JSON.stringify(item);
        const isKnownId = knownIds.has(text);
        const isEditorial = text.startsWith('[E]');
        return (
          <li key={`${text}-${index}`}>
            {isKnownId ? (
              <a href={`#${text}`} className="badge badge-plain no-underline">
                {text}
              </a>
            ) : (
              <span className={isEditorial ? 'badge badge-editorial' : 'badge badge-none'}>{text}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function SourcesPage() {
  const { data, error, path } = getSourcesFile();
  const sources = getRegisteredSources();
  const reviewSources = getReviewSources();
  const sourceIndex = getSourceIndex();
  const knownIds = new Set(sourceIndex.keys());
  const byCategory = groupSourcesByCategory(sources);

  const reviewByRegion = new Map<string, RegisteredSource[]>();
  for (const source of reviewSources) {
    const key = typeof source.region === 'string' && source.region ? source.region : 'unlabelled';
    const list = reviewByRegion.get(key);
    if (list) list.push(source);
    else reviewByRegion.set(key, [source]);
  }

  const fieldSourceMap =
    data && data.field_source_map && typeof data.field_source_map === 'object'
      ? (data.field_source_map as Record<string, Record<string, unknown>>)
      : null;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-bold text-zinc-900">資料來源</h1>
        <p className="mt-1 text-sm text-zinc-700">
          本資料庫只登錄<strong>合法公開來源</strong>。任何盜版站、漫畫聚合站或漢化發布頁都不在調研與採集範圍內，
          也不得寫入來源清單。全部來源共 <strong>{sources.length + reviewSources.length}</strong> 條：
          一般來源 {sources.length} 條、評價來源 {reviewSources.length} 條。
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          檔案：<code className="mono">{path}</code>
          {data?.meta && typeof data.meta.version === 'string' ? (
            <>
              {' '}· 版本 <code className="mono">{String(data.meta.version)}</code>
            </>
          ) : null}
          {data?.meta && typeof data.meta.generated_at === 'string' ? (
            <>
              {' '}· 產生於 <code className="mono">{String(data.meta.generated_at)}</code>
            </>
          ) : null}
          {data?.meta && typeof data.meta.timezone === 'string' ? (
            <>
              {' '}· 時區 <code className="mono">{String(data.meta.timezone)}</code>
            </>
          ) : null}
        </p>
        {data?.meta && typeof data.meta.licensing_note === 'string' ? (
          <p className="mt-2 text-xs text-zinc-600">{String(data.meta.licensing_note)}</p>
        ) : null}
      </section>

      {error ? (
        <EmptyState title="無法解析 sources.yaml" tone="warn">
          <p className="mono">{error}</p>
          <p className="mt-1">
            作品頁與搜尋功能讀取的是 JSON 匯出檔，不受此問題影響。
          </p>
        </EmptyState>
      ) : null}

      <SectionCard
        title={`評價／評分來源（review_sources，${reviewSources.length} 條）`}
        subtitle="評價來源與一般來源分開建模：多了 rating_fields、review_text_available、copyright_risk_for_reviews 與 display_policy。"
      >
        <div className="space-y-4">
          <div className="callout callout-info text-xs text-zinc-700">
            <p className="font-semibold text-zinc-800">前端必須遵守的展示策略（§5.2）</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>P1：資料庫不設評論正文欄位，正文一律以外連卡片呈現。</li>
              <li>P2：只存聚合分數、評分人數與評論件數，並顯式記錄 score_scale。</li>
              <li>P3：不同來源的分數不得直接合併計算（5 / 10 / 100 分制）。</li>
              <li>P4：來源條款或 robots 禁止時，只做連結、不展示數值。</li>
              <li>P5：每筆評分展示都必須帶 source_url + retrieved_at。</li>
            </ul>
            <p className="mt-1">
              下表中 <code className="mono">display_allowed</code> 的依據即為各來源的「本專案允許的展示方式」欄位；
              作品頁的評分區塊依此決定是否顯示數字。
            </p>
          </div>

          {reviewSources.length === 0 && !error ? (
            <EmptyState title="沒有評價來源" tone="warn">sources.yaml 的 review_sources 區段為空。</EmptyState>
          ) : null}

          {[...reviewByRegion.entries()].map(([region, items]) => (
            <div key={region}>
              <h3 className="mb-2 text-sm font-semibold text-zinc-800">
                {regionLabel(region)}（{items.length} 條）
              </h3>
              <ul className="space-y-3">
                {items.map((source) => (
                  <SourceCard key={source.id} source={source} showReviewFields />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title={`一般資料來源（sources，${sources.length} 條）`}
        subtitle="依 category 分組。每條列出名稱／網址／採集方式／可信度／2026 現狀。"
      >
        <nav aria-label="來源分類" className="mb-4 flex flex-wrap gap-1.5">
          {byCategory.map((group) => (
            <a key={group.category} href={`#cat-${group.category}`} className="badge badge-plain no-underline">
              {categoryLabel(group.category)}（{group.items.length}）
            </a>
          ))}
        </nav>

        {sources.length === 0 && !error ? (
          <EmptyState title="沒有一般來源" tone="warn">sources.yaml 的 sources 區段為空。</EmptyState>
        ) : null}

        <div className="space-y-6">
          {byCategory.map((group) => (
            <div key={group.category} id={`cat-${group.category}`}>
              <h3 className="mb-2 text-sm font-semibold text-zinc-800">
                {categoryLabel(group.category)}
                <span className="mono ml-2 text-xs text-zinc-500">{group.category}</span>
                <span className="ml-2 text-xs text-zinc-500">（{group.items.length} 條）</span>
              </h3>
              <ul className="space-y-3">
                {group.items.map((source) => (
                  <SourceCard key={source.id} source={source} showReviewFields={false} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SectionCard>

      {fieldSourceMap ? (
        <SectionCard
          title={`欄位來源優先序（field_source_map，${Object.keys(fieldSourceMap).length} 個欄位）`}
          subtitle="階段 3 採集編排用的「主來源 → 補完來源 → 兜底」順序；標示 [E] 者為編輯判斷，沒有 source_url。"
        >
          <div className="space-y-3">
            {Object.entries(fieldSourceMap).map(([field, mapping]) => (
              <div key={field} className="rounded border border-zinc-200 p-3">
                <p className="mono text-sm font-medium text-zinc-800">{field}</p>
                <dl className="mt-1 space-y-1 text-xs">
                  {Object.entries(mapping ?? {}).map(([tier, value]) => (
                    <div key={tier} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
                      <dt className="w-24 shrink-0 text-zinc-500">{tier}</dt>
                      <dd className="min-w-0">
                        {Array.isArray(value) || typeof value === 'string' ? (
                          renderFieldRef(value, knownIds)
                        ) : (
                          <UnknownValue />
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <p className="text-sm text-zinc-600">
        想知道這些來源實際填了哪些欄位？請見 <Link href="/data-quality">資料品質</Link> 的溯源覆蓋率，
        或任選一筆作品查看其 <Link href="/">欄位級來源</Link>。
      </p>
    </div>
  );
}
