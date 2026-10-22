/**
 * Result card for the search / browse list.
 *
 * Shows the highest-signal fields plus a provenance hint: the classification
 * basis badge is on the card itself, because "is this an official tag or an
 * editorial call?" changes how the whole record should be read.
 *
 * The cover sits on the left; all three titles (ja / zh-TW / zh-CN) are always
 * shown via TitleTriple, including the missing ones.
 */
import Link from 'next/link';

import { AuthorLinks } from './AuthorLinks';
import { CoverImage } from './CoverImage';
import { TitleTriple } from './TitleTriple';
import { ClassificationBadge, Pill, UnknownValue } from './ui';
import { mediaTypeLabel, serializationStatusLabel, yuriTypeLabel } from '@/lib/labels';
import type { SlimWork } from '@/lib/types';

/**
 * Renders from the slim client projection, so the values it shows are the ones
 * `scripts/build-slim.mjs` precomputed with the REAL lib functions
 * (`avg_confidence`, `has_zh_tw`, `has_zh_cn`). That is why it does not call
 * averageFieldConfidence() here: computing it a second time in the browser is
 * how the card and the detail page would start disagreeing.
 */
export function WorkCard({ work }: { work: SlimWork }) {
  const confidence = work.avg_confidence;
  const confidenceText = confidence === null ? null : `${Math.round(confidence * 100)}%`;

  return (
    <article className="flex h-full flex-col justify-between rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-pink-300 hover:shadow">
      <div className="flex gap-3">
        <CoverImage work={work} size="card" />

        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-snug text-zinc-900">
            <Link href={`/works/${work.slug}`} className="no-underline hover:underline">
              {work.title_ja}
            </Link>
          </h3>

          <div className="mt-1.5">
            <TitleTriple work={work} compact />
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <Pill tone="plain">{mediaTypeLabel(work.media_type)}</Pill>
            <Pill tone="plain">{serializationStatusLabel(work.serialization_status)}</Pill>
            <Pill tone="plain" title={`yuri_type = ${work.yuri_type}`}>
              百合：{yuriTypeLabel(work.yuri_type)}
            </Pill>
            <ClassificationBadge value={work.classification_basis} />
            {work.has_zh_tw ? <Pill tone="accent">有繁中版</Pill> : null}
            {work.has_zh_cn ? <Pill tone="accent">有簡中版</Pill> : null}
          </div>

          <dl className="mt-2 space-y-1 text-xs text-zinc-600">
            <div className="flex gap-1">
              <dt className="text-zinc-500">作者：</dt>
              <dd className="min-w-0 truncate">
                <AuthorLinks names={work.authors} />
              </dd>
            </div>
            {work.illustrators.length > 0 ? (
              <div className="flex gap-1">
                <dt className="text-zinc-500">繪者：</dt>
                <dd className="min-w-0 truncate">
                  <AuthorLinks names={work.illustrators} />
                </dd>
              </div>
            ) : null}
            <div className="flex gap-1">
              <dt className="text-zinc-500">出版社：</dt>
              <dd className="min-w-0 truncate">{work.publisher_ja ?? <UnknownValue />}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-zinc-500">雜誌／平台：</dt>
              <dd className="min-w-0 truncate">{work.magazine_or_platform ?? <UnknownValue />}</dd>
            </div>
          </dl>
        </div>
      </div>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-2 text-xs text-zinc-500">
        <span>
          {work.sources_count} 筆來源
          {confidenceText ? ` · 平均欄位把握度 ${confidenceText}` : ' · 平均欄位把握度 unknown'}
        </span>
        <span className="mono text-zinc-400">{work.slug}</span>
      </footer>
    </article>
  );
}
