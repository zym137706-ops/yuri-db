/**
 * Small presentational primitives shared by every page.
 * All of these are React Server Components — the MVP ships no client JS of its own,
 * so search/filtering works through plain GET forms and the URL query string.
 */
import { BASIS_LABELS, classificationBasisLabel, labelOf } from '@/lib/labels';
import { UNKNOWN_TEXT, confidenceBand, confidencePercent } from '@/lib/policy';
import type { FieldBasis } from '@/lib/types';

const BASIS_CLASS: Record<string, string> = {
  official: 'badge badge-official',
  official_tag: 'badge badge-official_tag',
  editorial: 'badge badge-editorial',
  derived: 'badge badge-derived',
  third_party: 'badge badge-third_party',
};

/**
 * The provenance badge: where a value came from.
 * `editorial` is deliberately distinct (dashed amber) because it is a human
 * judgement with no source document behind it.
 */
export function BasisBadge({ basis, compact = false }: { basis: FieldBasis | null | undefined; compact?: boolean }) {
  if (!basis) {
    return <span className="badge badge-none">{compact ? '無溯源' : '無溯源紀錄'}</span>;
  }
  const cls = BASIS_CLASS[basis] ?? 'badge badge-plain';
  const text = labelOf(BASIS_LABELS, basis);
  return (
    <span className={cls} title={`field_sources.basis = ${basis}`}>
      {basis === 'editorial' ? `編輯判斷 / editorial` : `${text} / ${basis}`}
    </span>
  );
}

/** Badge for classification_basis itself (official_tag vs editorial). */
export function ClassificationBadge({ value }: { value: string | null | undefined }) {
  const cls = value === 'official_tag' ? 'badge badge-official_tag' : 'badge badge-editorial';
  return (
    <span className={cls} title={`classification_basis = ${value ?? UNKNOWN_TEXT}`}>
      {value === 'editorial' ? '編輯判斷 / editorial' : classificationBasisLabel(value)}
    </span>
  );
}

export function Pill({
  children,
  tone = 'plain',
  title,
}: {
  children: React.ReactNode;
  tone?: 'plain' | 'accent' | 'official' | 'editorial' | 'derived' | 'none';
  title?: string;
}) {
  const cls =
    tone === 'accent'
      ? 'badge badge-accent'
      : tone === 'plain'
        ? 'badge badge-plain'
        : `badge badge-${tone}`;
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}

/** A null/missing value is rendered as "unknown" — never hidden, never blank. */
export function UnknownValue({ label = UNKNOWN_TEXT }: { label?: string }) {
  return (
    <span className="unknown-value" title="schema 允許 null／未確認，不得推測填充">
      {label}
    </span>
  );
}

export function ConfidenceBar({ confidence }: { confidence: number | null | undefined }) {
  const percent = confidencePercent(confidence);
  const band = confidenceBand(confidence);
  if (percent === null) {
    return (
      <span className="badge badge-none" title="該欄位沒有 field_confidence 值">
        把握度 unknown
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5" title={`field_confidence = ${confidence}`}>
      <span className={`confidence-bar confidence-${band}`}>
        <span style={{ width: `${percent}%` }} />
      </span>
      <span className="text-xs text-zinc-600 tabular-nums">{percent}%</span>
    </span>
  );
}

export function SafeLink({
  href,
  children,
  className,
  title,
}: {
  href: string | null | undefined;
  children?: React.ReactNode;
  className?: string;
  title?: string;
}) {
  if (!href) return <UnknownValue label="無連結" />;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={className} title={title ?? href}>
      {children ?? href}
    </a>
  );
}

export function EmptyState({
  title,
  children,
  tone = 'info',
}: {
  title: string;
  children?: React.ReactNode;
  tone?: 'info' | 'warn';
}) {
  return (
    <div className={`callout ${tone === 'warn' ? 'callout-warn' : 'callout-info'}`}>
      <p className="font-semibold text-zinc-800">{title}</p>
      {children ? <div className="mt-1 text-sm text-zinc-700">{children}</div> : null}
    </div>
  );
}

export function SectionCard({
  id,
  title,
  subtitle,
  children,
  actions,
}: {
  id?: string;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section id={id} className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <header className="flex flex-col gap-1 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
          {subtitle ? <p className="text-xs text-zinc-600">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}
