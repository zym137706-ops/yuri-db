'use client';

/**
 * Browser-side catalogue for /anime.
 *
 * With `output: 'export'` there is no server to read `searchParams`, so the
 * filtering runs here instead, against the client-side projection
 * `lib/anime-slim.json` (built by scripts/build-slim.mjs from data/anime.json)
 * rather than the full dataset.
 *
 * Everything that decides WHAT the page shows is imported from
 * lib/anime-filters.ts — the same module the server components and
 * scripts/verify-anime.mjs execute — so the browser can never disagree with the
 * build-time pages about what a filter or a preset means.
 *
 * The URL stays the source of truth: the filter form is still a GET form and the
 * preset chips are still plain links, so every filtered view is a shareable,
 * bookmarkable URL on any static host. Only the rendering is client-side.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { AnimeCard } from '@/components/AnimeCard';
import { AnimeFilterPanel } from '@/components/AnimeFilterPanel';
import { EmptyState, SectionCard } from '@/components/ui';
import {
  ANIME_PRESETS,
  adaptationOptions,
  animePresetHref,
  buildAnimeQueryString,
  countActiveAnimeFilters,
  filterAndSortAnime,
  formatOptions,
  parseAnimeFilters,
  statusOptions,
  studioOptions,
  yearOptions,
} from '@/lib/anime-filters';
import { queryRecord } from '@/lib/url-state';
import slimRaw from '@/lib/anime-slim.json';
import type { SlimAnime, SlimAnimeFile } from '@/lib/anime-types';

/**
 * The JSON import's inferred literal type is enormous (298 records), and the
 * projection is asserted — record for record, filter for filter — against the full
 * dataset by scripts/verify-anime.mjs. The cast therefore narrows to the
 * structural contract rather than re-deriving it here.
 */
const slim = slimRaw as unknown as SlimAnimeFile;

export function AnimeBrowser() {
  // lib/url-state.ts is the single adapter from URLSearchParams to the record
  // shape the parsers expect — it preserves repeated keys (`?format=tv&format=movie`),
  // which Object.fromEntries would silently collapse to the last one.
  const filters = parseAnimeFilters(queryRecord(useSearchParams()));

  const anime: SlimAnime[] = slim.anime;
  const results = filterAndSortAnime(anime, filters);
  const activeCount = countActiveAnimeFilters(filters);
  const shareQuery = buildAnimeQueryString(filters);

  const options = {
    adaptations: adaptationOptions(anime),
    formats: formatOptions(anime),
    statuses: statusOptions(anime),
    years: yearOptions(anime),
    studios: studioOptions(anime),
  };

  // Preset counts are DERIVED from the loaded dataset every render — never
  // hardcoded — so the chips keep telling the truth as the catalogue grows.
  const presetCounts = ANIME_PRESETS.map((preset) => ({
    preset,
    count: filterAndSortAnime(anime, preset.filters).length,
  }));
  const originalAllFormats = anime.filter((entry) => entry.adaptation_source === 'original').length;
  const originalTvCount = presetCounts.find((row) => row.preset.id === 'original_tv')?.count ?? 0;

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- *
       * One-click presets (counts derived from the data)
       * ---------------------------------------------------------------- */}
      <SectionCard
        title="一鍵分類"
        subtitle="五個預設篩選；括號內為實際命中數，每次都由資料當場計算，不是寫死的數字。"
      >
        <ul className="flex flex-wrap gap-2">
          {presetCounts.map(({ preset, count }) => (
            <li key={preset.id}>
              <Link
                href={animePresetHref(preset)}
                className="badge badge-accent no-underline hover:bg-pink-100"
                title={preset.description}
              >
                {preset.label}
                <span className="ml-1 tabular-nums">({count})</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-zinc-600">
          「原創 TV 動畫」嚴格等於 <code className="mono">adaptation_source = original</code> 且{' '}
          <code className="mono">format = tv</code>，因此只計算 TV 形態。本資料集另有{' '}
          <strong>{Math.max(0, originalAllFormats - originalTvCount)}</strong> 部{' '}
          <code className="mono">original</code> 作品是 OVA／ONA／劇場版等其他形態
          （合計 {originalAllFormats} 部原創）；想看它們請用「形態」篩選，本站不把它們混進 TV 計數。
        </p>
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <AnimeFilterPanel
            filters={filters}
            options={options}
            resultCount={results.length}
            totalCount={anime.length}
          />
        </aside>

        <div className="space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <h2 className="text-base font-semibold text-zinc-900">
              搜尋結果：{results.length} / {anime.length} 部
            </h2>
            {activeCount > 0 ? (
              <p className="text-xs text-zinc-600">
                已套用 {activeCount} 個條件
                {shareQuery ? <code className="mono ml-1">{shareQuery}</code> : null}
              </p>
            ) : (
              <p className="text-xs text-zinc-600">未套用任何篩選條件（顯示全部）。</p>
            )}
          </div>

          {results.length === 0 ? (
            <EmptyState title="沒有符合條件的動畫" tone="warn">
              <p>請放寬篩選條件，或使用左下角「清除全部」重新開始。</p>
              <p className="mt-1">
                提示：篩選選項只列出資料中實際存在的值，因此選得到的組合不一定有交集（例如同時勾選「漫改」與「原創」）。
              </p>
            </EmptyState>
          ) : null}

          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((entry) => (
              <li key={entry.id}>
                <AnimeCard anime={entry} />
              </li>
            ))}
          </ul>

          <p className="pt-2 text-xs text-zinc-500">
            本頁為靜態網站：篩選在瀏覽器端執行，資料集在頁面載入時一併下載，
            因此之後的每次篩選都不需要連線伺服器。
          </p>
        </div>
      </div>
    </div>
  );
}
