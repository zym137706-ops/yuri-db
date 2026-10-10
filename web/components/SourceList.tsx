/**
 * sources[] — the per-record provenance list.
 * Each row must show url + retrieved_at + confidence (schema requirement).
 */
import { EmptyState, SafeLink } from './ui';
import { confidenceBand, confidencePercent, formatTimestamp } from '@/lib/policy';
import type { WorkSource } from '@/lib/types';

function ConfidenceCell({ confidence }: { confidence: number }) {
  const percent = confidencePercent(confidence) ?? 0;
  const band = confidenceBand(confidence);
  const text = typeof confidence === 'number' && !Number.isNaN(confidence) ? confidence.toFixed(2) : 'unknown';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`confidence-bar confidence-${band}`}>
        <span style={{ width: `${percent}%` }} />
      </span>
      <span className="tabular-nums text-xs">{text}</span>
    </span>
  );
}

export function SourceList({ sources }: { sources: WorkSource[] }) {
  if (!sources || sources.length === 0) {
    return (
      <EmptyState title="尚無溯源來源" tone="warn">
        此作品在 schema 中要求 <code className="mono">sources</code> 至少有一筆，但資料集內為空。此為資料缺口，已如實呈現。
      </EmptyState>
    );
  }

  return (
    <ul className="space-y-3">
      {sources.map((source, index) => (
        <li key={`${source.url}-${index}`} className="rounded border border-zinc-200 bg-white p-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-medium text-zinc-900">{source.name}</span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
              {source.source_id ? (
                <a className="badge badge-plain no-underline" href={`/sources#${source.source_id}`}>
                  source_id: {source.source_id}
                </a>
              ) : (
                <span className="badge badge-none" title="works.json 未帶 source_id">
                  source_id: unknown
                </span>
              )}
              <span title="schema 要求每筆來源必須帶把握度">
                把握度 <ConfidenceCell confidence={source.confidence} />
              </span>
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-600">
            取得時間：{formatTimestamp(source.retrieved_at)}
          </p>
          <p className="mt-1">
            <SafeLink href={source.url} className="mono" />
          </p>
          {source.note ? <p className="mt-1 text-xs text-zinc-600">備註：{source.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}
