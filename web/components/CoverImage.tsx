/**
 * Cover image display.
 *
 * POLICY (mirrors docs/phase1-feasibility-report.md §6.2):
 *   - We store the cover *URL* only and NEVER mirror the bytes. The image stays
 *     on the publisher's / database's own CDN.
 *   - It is referenced for introduction purposes with visible attribution
 *     and a link back to the source page, so the rights holder can request
 *     removal (see /sources).
 *   - When a source's terms forbid embedding (`cover_display_allowed === false`)
 *     we render a link instead of an <img>, never the image itself.
 *   - `referrerPolicy="no-referrer"` avoids leaking our URL to the CDN.
 *
 * The component is shared by BOTH catalogues — Work (works.json, publisher CDNs)
 * and Anime (anime.json, AniList's CDN) — so the policy cannot drift between
 * them. `subject` is a structural interface rather than the concrete `Work` type
 * for exactly that reason; `sourceTag` / `attribution` only change the wording of
 * the caption (AniList is a third-party database, not a publisher).
 */
import { REGION_LABELS } from '@/lib/labels';
import type { Region } from '@/lib/types';

/** The subset of a record this component needs. `Work` and `Anime` both satisfy it. */
export interface CoverSubject {
  title_ja: string;
  cover_url: string | null;
  cover_source_url: string | null;
  /** Region of the edition the cover belongs to; absent ⇒ "版本 unknown". */
  cover_region?: Region | null;
  /** `false` ⇒ the source forbids embedding: link only, never an <img>. */
  cover_display_allowed?: boolean | null;
  cover_note?: string | null;
}

const BOX = {
  card: 'h-[132px] w-[92px]',
  detail: 'h-[288px] w-[200px]',
} as const;

const PLACEHOLDER_TEXT = {
  card: 'text-[10px]',
  detail: 'text-xs',
} as const;

export function CoverImage({
  work,
  size = 'card',
  sourceTag,
  attribution,
}: {
  work: CoverSubject;
  size?: keyof typeof BOX;
  /**
   * Replaces the region tag in the caption. Work passes nothing (the region of
   * the edition is meaningful); the anime pages pass the database name, because
   * an AniList cover is not a regional edition.
   */
  sourceTag?: string;
  /** Replaces the "© 出版社" attribution line. */
  attribution?: string;
}) {
  const embeddable = work.cover_display_allowed !== false;
  const url = work.cover_url;
  const box = BOX[size];
  const tag =
    sourceTag ?? (work.cover_region ? (REGION_LABELS[work.cover_region] ?? work.cover_region) : '版本 unknown');

  return (
    <figure className="shrink-0">
      {url && embeddable ? (
        <img
          src={url}
          alt={`${work.title_ja} 封面`}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={`${box} rounded border border-zinc-200 bg-zinc-50 object-cover shadow-sm`}
        />
      ) : (
        <div
          className={`${box} flex flex-col items-center justify-center gap-1 rounded border border-dashed border-zinc-300 bg-zinc-50 px-1 text-center ${PLACEHOLDER_TEXT[size]} leading-tight text-zinc-400`}
          title={url ? '來源條款不允許本站嵌入封面' : '資料庫中尚未取得此條目的封面'}
        >
          {url ? (
            <>
              <span>不允許嵌入</span>
              <span>僅提供外連</span>
            </>
          ) : (
            <>
              <span>暫無封面</span>
              <span className="text-[9px]">未取得</span>
            </>
          )}
        </div>
      )}

      {url ? (
        <figcaption
          className={`mt-1 space-y-0.5 ${size === 'card' ? 'w-[92px]' : 'w-[200px]'} text-[10px] leading-tight text-zinc-500`}
        >
          <div className="flex flex-wrap items-center gap-1">
            <span className="rounded bg-zinc-100 px-1">{tag}</span>
            {embeddable ? (
              <span>{attribution ?? '© 出版社'}</span>
            ) : (
              <a href={url} target="_blank" rel="noreferrer noopener" className="underline">
                外連封面
              </a>
            )}
          </div>
          {work.cover_source_url ? (
            <a
              href={work.cover_source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="block truncate underline"
              title={work.cover_source_url}
            >
              出處
            </a>
          ) : (
            <span>出處 unknown</span>
          )}
          {size === 'detail' && work.cover_note ? (
            <p className="pt-1 text-zinc-400">{work.cover_note}</p>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
