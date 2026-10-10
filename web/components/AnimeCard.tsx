/**
 * Result card for the /anime catalogue.
 *
 * Required per entry: 開播時間 (start_date), 主要聲優 (main_cast[].voice_actor with
 * its character) and 製作公司 (studios) — all three are on the card because a
 * reader scanning a list is usually looking for exactly one of them.
 *
 * All three titles (ja / zh-TW / zh-CN) are rendered through the shared
 * TitleTriple, so the missing zh translations stay visible as "未收錄" with the
 * reason instead of being dropped.
 */
import Link from 'next/link';

import { CoverImage } from './CoverImage';
import { TitleTriple } from './TitleTriple';
import { Pill, UnknownValue } from './ui';
import { adaptationSourceLabel, animeFormatLabel, animeSeasonLabel, animeStatusLabel } from '@/lib/anime-labels';
import { animeRuntimeSummary } from '@/lib/anime-filters';
import type { SlimAnime } from '@/lib/anime-types';

const MAX_SHOWN_STUDIOS = 2;
const MAX_SHOWN_CAST = 3;

/**
 * Renders from the client-side projection (lib/anime-slim.json), so it takes
 * `SlimAnime` and reads the precomputed `sources_count` instead of `sources`.
 * A full `Anime` record satisfies `SlimAnime` too, so the card also works when
 * rendered from the complete dataset.
 */
export function AnimeCard({ anime }: { anime: SlimAnime }) {
  const studios = anime.studios ?? [];
  const cast = (anime.main_cast ?? []).slice(0, MAX_SHOWN_CAST);
  const extraStudios = studios.length - MAX_SHOWN_STUDIOS;
  const announced = anime.status === 'announced';

  return (
    <article className="flex h-full flex-col justify-between rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-pink-300 hover:shadow">
      <div className="flex gap-3">
        <CoverImage work={anime} size="card" sourceTag="AniList" attribution="© 版權持有人" />

        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-snug text-zinc-900">
            <Link href={`/anime/${anime.slug}`} className="no-underline hover:underline">
              {anime.title_ja}
            </Link>
          </h3>

          {anime.title_romaji || anime.title_en ? (
            <p className="mt-0.5 truncate text-xs text-zinc-500" title={`${anime.title_romaji ?? ''} / ${anime.title_en ?? ''}`}>
              {[anime.title_romaji, anime.title_en].filter(Boolean).join(' · ')}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-zinc-400">
              羅馬字／英文標題：<UnknownValue />
            </p>
          )}

          <div className="mt-1.5">
            <TitleTriple work={anime} compact missingLabel="未收錄（來源未提供）" />
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <Pill tone="plain" title={`format = ${anime.format}`}>
              {animeFormatLabel(anime.format)}
            </Pill>
            <Pill tone="plain" title={`adaptation_source = ${anime.adaptation_source}`}>
              {adaptationSourceLabel(anime.adaptation_source)}
            </Pill>
            <Pill tone={announced ? 'accent' : 'plain'} title={`status = ${anime.status}`}>
              {animeStatusLabel(anime.status)}
            </Pill>
            {anime.season ? (
              <Pill tone="plain" title={`season = ${anime.season} / season_year = ${anime.season_year ?? 'null'}`}>
                {animeSeasonLabel(anime.season)}
                {anime.season_year ? ` ${anime.season_year}` : ''}
              </Pill>
            ) : null}
          </div>

          <dl className="mt-2 space-y-1 text-xs text-zinc-600">
            <div className="flex gap-1">
              <dt className="text-zinc-500">開播時間：</dt>
              <dd className="min-w-0 font-medium text-zinc-800">
                {anime.start_date ?? <UnknownValue label="未定／unknown" />}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt className="shrink-0 text-zinc-500">製作公司：</dt>
              <dd className="min-w-0">
                {studios.length === 0 ? (
                  <UnknownValue label="未收錄" />
                ) : (
                  <span className="truncate">
                    {studios.slice(0, MAX_SHOWN_STUDIOS).join('、')}
                    {extraStudios > 0 ? ` ＋${extraStudios}` : ''}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt className="shrink-0 text-zinc-500">主要聲優：</dt>
              <dd className="min-w-0 space-y-0.5">
                {cast.length === 0 ? (
                  <UnknownValue label="未收錄" />
                ) : (
                  cast.map((member) => (
                    <span key={`${member.character}-${member.voice_actor ?? 'unknown'}`} className="block truncate">
                      {member.character}
                      {' — '}
                      {member.voice_actor ?? <UnknownValue label="聲優 unknown" />}
                    </span>
                  ))
                )}
                {anime.main_cast.length > cast.length ? (
                  <span className="block text-zinc-400">（另有 {anime.main_cast.length - cast.length} 位）</span>
                ) : null}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt className="shrink-0 text-zinc-500">集數／時長：</dt>
              <dd className="min-w-0 truncate">{animeRuntimeSummary(anime)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-2 text-xs text-zinc-500">
        <span>
          {anime.sources_count} 筆來源 · 全部為第三方（AniList）
        </span>
        <span className="mono text-zinc-400">{anime.slug}</span>
      </footer>
    </article>
  );
}
