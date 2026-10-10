/**
 * review_meta — evaluation layer [B]: metadata only.
 *
 * There is deliberately no review-body column in the schema (P1), so this renders
 * outlet / reviewer / date / rank / points and links out to the original.
 */
import { EmptyState, UnknownValue } from './ui';
import { formatTimestamp } from '@/lib/policy';
import type { ReviewMeta } from '@/lib/types';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function ReviewMetaList({ items }: { items: ReviewMeta[] }) {
  if (!items || items.length === 0) {
    return (
      <EmptyState title="尚無書評／榜單元資料">
        資料庫只收錄書評的<strong>元資料</strong>（刊載媒體、書評者、日期、名次），不收錄正文。
        目前此作品沒有任何已登錄的書評或榜單條目。
      </EmptyState>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {items.map((item, index) => (
        <li key={`${item.source_id}-${index}`} className="rounded border border-zinc-200 bg-white p-3">
          <p className="font-medium text-zinc-900">{item.outlet}</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <Field label="書評者">{item.reviewer ?? <UnknownValue />}</Field>
            <Field label="刊載日">{item.published_date ?? <UnknownValue />}</Field>
            <Field label="名次">{item.rank ?? <UnknownValue />}</Field>
            <Field label="點數">{item.points ?? <UnknownValue />}</Field>
            <Field label="來源 ID">
              <span className="mono">{item.source_id}</span>
            </Field>
            <Field label="取得時間">{formatTimestamp(item.retrieved_at)}</Field>
          </dl>
          <p className="mt-2 text-xs">
            <a href={item.source_url} target="_blank" rel="noopener noreferrer nofollow" className="mono">
              {item.source_url}
            </a>
          </p>
          <p className="mt-1 text-xs text-zinc-500">僅顯示元資料並外連原文；本站不轉載評論正文（§5.2 P1）。</p>
        </li>
      ))}
    </ul>
  );
}
