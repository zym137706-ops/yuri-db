/**
 * 百合動畫 (yuri anime) — the PURE half of the catalogue logic.
 *
 * This module is the single definition of the anime enum domains, filter/URL
 * state, search, sort and the one-click presets. It is deliberately import-light
 * (exactly one relative import, `./policy`, which is itself import-free and
 * `node:`-free) for two reasons:
 *
 *   1. The statically exported site filters IN THE BROWSER, so
 *      components/AnimeBrowser.tsx must be able to import `filterAndSortAnime`
 *      and the presets without pulling `node:fs` (which lib/anime.ts needs for
 *      its loader) into a client bundle. The logic is NOT copied there — it is
 *      imported from here, so the browser and the build-time pages can never
 *      disagree about what a filter means.
 *   2. scripts/verify-anime.mjs executes this code directly through Node's
 *      native TypeScript type-stripping, with only the `.ts` extension added to
 *      that one specifier.
 *
 * `lib/anime.ts` re-exports everything here, so `@/lib/anime` remains the public
 * entry point for server components.
 */

import { normalizeText } from './policy';

/* ========================================================================== *
 * §2  Enum domains (schemas/anime.schema.json — the authoritative tokens)
 * ========================================================================== */

export const ANIME_FORMAT_TOKENS = [
  'tv',
  'tv_short',
  'movie',
  'ova',
  'ona',
  'special',
  'music',
  'other',
] as const;

export const ADAPTATION_SOURCE_TOKENS = [
  'manga',
  'light_novel',
  'web_novel',
  'novel',
  'visual_novel',
  'game',
  'doujinshi',
  'anime',
  'original',
  'other',
  'unknown',
] as const;

export const ANIME_STATUS_TOKENS = [
  'airing',
  'finished',
  'announced',
  'cancelled',
  'hiatus',
  'unknown',
] as const;

export const ANIME_SEASON_TOKENS = ['winter', 'spring', 'summer', 'fall'] as const;

/**
 * 「輕小說改」的實際篩選範圍：輕小說／網路小說／小說，加上視覺小說與遊戲。
 * 使用者要求的四分類之一是「轻小说改」，但 schema 把它拆成多個 token，因此
 * 預設篩選必須一次涵蓋這一族；實際命中的 token 由資料決定（目前只有
 * light_novel / visual_novel / game）。
 */
export const LIGHT_NOVEL_FAMILY = ['light_novel', 'web_novel', 'novel', 'visual_novel', 'game'] as const;

export const ANIME_SORTS = [
  'air_date_desc',
  'air_date_asc',
  'title',
  'score_desc',
  'popularity_desc',
] as const;

export type AnimeSort = (typeof ANIME_SORTS)[number];

export const DEFAULT_ANIME_SORT: AnimeSort = 'air_date_desc';

const inDomain = (domain: readonly string[]) => (value: string) => domain.includes(value);

/* ========================================================================== *
 * §3  Filters — all state lives in the URL query string
 * ========================================================================== */

/** Permissive structural view of an entry, so the pure logic stays testable. */
export interface AnimeLike {
  id?: string | null;
  slug?: string | null;
  title_ja?: string | null;
  title_romaji?: string | null;
  title_en?: string | null;
  title_zh_tw?: string | null;
  title_zh_cn?: string | null;
  format?: string | null;
  adaptation_source?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  season?: string | null;
  season_year?: number | null;
  episode_count?: number | null;
  episode_duration_min?: number | null;
  studios?: readonly string[] | null;
  main_cast?: readonly { character?: string | null; voice_actor?: string | null }[] | null;
  average_score?: number | null;
  popularity?: number | null;
  last_checked?: string | null;
}

export interface AnimeFilters {
  q: string;
  /** adaptation_source — multi-select (OR within the dimension). */
  adaptation: string[];
  /** format — multi-select. */
  format: string[];
  /** status — multi-select. */
  status: string[];
  /** '' = any, 'unknown' = no season_year and no start_date, or a 'YYYY' token. */
  year: string;
  /** Exact match against studios[]; '' = any. */
  studio: string;
  sort: AnimeSort;
}

type QueryInput = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function toList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toYear(value: string | undefined): string {
  const token = (value ?? '').trim();
  if (token === 'unknown') return 'unknown';
  return /^[0-9]{4}$/.test(token) ? token : '';
}

function toAnimeSort(value: string | undefined): AnimeSort {
  const token = (value ?? '').trim();
  return (ANIME_SORTS as readonly string[]).includes(token) ? (token as AnimeSort) : DEFAULT_ANIME_SORT;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))].sort();
}

/**
 * A canonical filter object. Every argument is normalised (trimmed, de-duplicated,
 * sorted) so that two filter sets that mean the same thing serialise identically —
 * which is what makes the URL round-trip assertion in scripts/verify-anime.mjs
 * meaningful rather than accidental.
 */
export function makeAnimeFilters(partial: Partial<AnimeFilters> = {}): AnimeFilters {
  return {
    q: (partial.q ?? '').trim(),
    adaptation: sortedUnique(partial.adaptation ?? []),
    format: sortedUnique(partial.format ?? []),
    status: sortedUnique(partial.status ?? []),
    year: toYear(partial.year),
    studio: (partial.studio ?? '').trim(),
    sort: partial.sort ?? DEFAULT_ANIME_SORT,
  };
}

export const EMPTY_ANIME_FILTERS: AnimeFilters = makeAnimeFilters();

/**
 * Reads the URL query string into filters. Accepts both repeated keys
 * (`?format=tv&format=movie`, what the GET form produces) and comma lists
 * (`?format=tv,movie`, what a hand-written share link tends to use).
 * Unknown tokens are dropped, so a stale link degrades instead of throwing.
 */
export function parseAnimeFilters(input: QueryInput | undefined | null): AnimeFilters {
  const query = input ?? {};
  return makeAnimeFilters({
    q: (firstValue(query.q) ?? '').trim(),
    adaptation: toList(query.adaptation).filter(inDomain(ADAPTATION_SOURCE_TOKENS)),
    format: toList(query.format).filter(inDomain(ANIME_FORMAT_TOKENS)),
    status: toList(query.status).filter(inDomain(ANIME_STATUS_TOKENS)),
    year: firstValue(query.year) ?? '',
    studio: firstValue(query.studio) ?? '',
    sort: toAnimeSort(firstValue(query.sort)),
  });
}

/**
 * Serialises filters back into a shareable query string. Defaults are omitted so
 * the canonical URL stays short, and key order is fixed so the same filter set
 * always produces the same link.
 */
export function buildAnimeQueryString(filters: AnimeFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  for (const value of [...filters.adaptation].sort()) params.append('adaptation', value);
  for (const value of [...filters.format].sort()) params.append('format', value);
  for (const value of [...filters.status].sort()) params.append('status', value);
  if (filters.year) params.set('year', filters.year);
  if (filters.studio.trim()) params.set('studio', filters.studio.trim());
  if (filters.sort !== DEFAULT_ANIME_SORT) params.set('sort', filters.sort);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** How many filter dimensions are active — drives the "已套用 N 個條件" hint. */
export function countActiveAnimeFilters(filters: AnimeFilters): number {
  let n = 0;
  if (filters.q.trim()) n += 1;
  n += filters.adaptation.length + filters.format.length + filters.status.length;
  if (filters.year) n += 1;
  if (filters.studio.trim()) n += 1;
  if (filters.sort !== DEFAULT_ANIME_SORT) n += 1;
  return n;
}

/* ========================================================================== *
 * §4  One-click presets — the four categories the user named, plus announced
 * ========================================================================== */

export interface AnimePreset {
  id: string;
  label: string;
  description: string;
  filters: AnimeFilters;
}

export const ANIME_PRESETS: AnimePreset[] = [
  {
    id: 'manga',
    label: '漫改',
    description: 'adaptation_source = manga（漫畫改編）',
    filters: makeAnimeFilters({ adaptation: ['manga'] }),
  },
  {
    id: 'light_novel',
    label: '輕小說改',
    description: `adaptation_source ∈ ${LIGHT_NOVEL_FAMILY.join(' / ')}（實際命中的 token 由資料決定）`,
    filters: makeAnimeFilters({ adaptation: [...LIGHT_NOVEL_FAMILY] }),
  },
  {
    id: 'original_tv',
    label: '原創 TV 動畫',
    description: 'adaptation_source = original 且 format = tv（不含 OVA／ONA／劇場版等原創作品）',
    filters: makeAnimeFilters({ adaptation: ['original'], format: ['tv'] }),
  },
  {
    id: 'movie',
    label: '劇場版',
    description: 'format = movie（與改編類型無關，兩種來源的劇場版都會列出）',
    filters: makeAnimeFilters({ format: ['movie'] }),
  },
  {
    id: 'announced',
    label: '已宣布動畫化・未播出',
    description: 'status = announced（已宣布動畫化但尚未播出）',
    filters: makeAnimeFilters({ status: ['announced'] }),
  },
];

export const ANIME_PRESET_BY_ID: Record<string, AnimePreset> = Object.fromEntries(
  ANIME_PRESETS.map((preset) => [preset.id, preset]),
);

/** Shareable href for a preset (`/anime?adaptation=manga`). */
export function animePresetHref(preset: AnimePreset): string {
  return `/anime${buildAnimeQueryString(preset.filters)}`;
}

/* ========================================================================== *
 * §5  Search + filter + sort
 * ========================================================================== */

/**
 * Fields searched, per the requirement:
 *   title (ja / romaji / en, plus the always-null zh_tw / zh_cn so a future
 *   translation is searchable the day it lands), studio, voice actor name.
 * Character name, slug and id are included as a convenience for deep links and
 * for "which character did X voice" lookups.
 */
export function searchableAnimeText(entry: AnimeLike): string[] {
  const cast = entry.main_cast ?? [];
  return [
    entry.title_ja,
    entry.title_romaji,
    entry.title_en,
    entry.title_zh_tw,
    entry.title_zh_cn,
    entry.slug,
    entry.id,
    ...(entry.studios ?? []),
    ...cast.map((member) => member.voice_actor),
    ...cast.map((member) => member.character),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

export function matchesAnimeQuery(entry: AnimeLike, query: string): boolean {
  const needle = normalizeText(query);
  if (!needle) return true;
  const haystack = searchableAnimeText(entry).map(normalizeText);
  const tokens = needle.split(' ').filter(Boolean);
  return tokens.every((token) => haystack.some((field) => field.includes(token)));
}

/**
 * 年份口徑：`season_year` 優先，其次取 `start_date` 的年份。
 *
 * This deliberately matches data/anime_report.json's `by_year`, which the
 * data-quality page cross-checks field by field. 16 entries in the current
 * export have a season_year that differs from (or exists without) the calendar
 * year of start_date — e.g. a December OVA in the following winter season — so
 * the UI labels the filter as "季年份" and always shows the raw start_date next
 * to it rather than pretending the two are the same number.
 */
export function animeYear(entry: AnimeLike): number | null {
  if (typeof entry.season_year === 'number' && Number.isFinite(entry.season_year)) return entry.season_year;
  const start = entry.start_date;
  if (typeof start === 'string' && start.length >= 4 && /^[0-9]{4}/.test(start)) return Number(start.slice(0, 4));
  return null;
}

/** 'YYYY' or 'unknown' — the token the year filter matches against. */
export function animeYearToken(entry: AnimeLike): string {
  const year = animeYear(entry);
  return year === null ? 'unknown' : String(year);
}

export function matchesAnimeFilters(entry: AnimeLike, filters: AnimeFilters): boolean {
  if (filters.adaptation.length && !filters.adaptation.includes(entry.adaptation_source ?? '')) return false;
  if (filters.format.length && !filters.format.includes(entry.format ?? '')) return false;
  if (filters.status.length && !filters.status.includes(entry.status ?? '')) return false;
  if (filters.year && animeYearToken(entry) !== filters.year) return false;
  if (filters.studio.trim() && !(entry.studios ?? []).includes(filters.studio.trim())) return false;
  return true;
}

function titleKey(entry: AnimeLike): string {
  return entry.title_ja ?? entry.slug ?? entry.id ?? '';
}

function compareTitle(a: AnimeLike, b: AnimeLike): number {
  const left = titleKey(a);
  const right = titleKey(b);
  try {
    return left.localeCompare(right, 'ja');
  } catch {
    return left.localeCompare(right);
  }
}

function compareNumberDesc(a: number | null | undefined, b: number | null | undefined): number {
  const left = typeof a === 'number' && Number.isFinite(a) ? a : null;
  const right = typeof b === 'number' && Number.isFinite(b) ? b : null;
  if (left === null && right === null) return 0;
  if (left === null) return 1; // unknown always last
  if (right === null) return -1;
  return right - left;
}

function compareStartDate(a: AnimeLike, b: AnimeLike, direction: 'asc' | 'desc'): number {
  const left = a.start_date ?? '';
  const right = b.start_date ?? '';
  if (!left && !right) return 0;
  if (!left) return 1; // unknown always last, in both directions
  if (!right) return -1;
  if (left === right) return 0;
  const order = left < right ? -1 : 1;
  return direction === 'asc' ? order : -order;
}

/** Deterministic sort: every comparator falls back to the Japanese title. */
export function sortAnime<T extends AnimeLike>(entries: T[], sort: AnimeSort): T[] {
  const copy = [...entries];
  copy.sort((a, b) => {
    let primary = 0;
    if (sort === 'air_date_desc') primary = compareStartDate(a, b, 'desc');
    else if (sort === 'air_date_asc') primary = compareStartDate(a, b, 'asc');
    else if (sort === 'score_desc') primary = compareNumberDesc(a.average_score, b.average_score);
    else if (sort === 'popularity_desc') primary = compareNumberDesc(a.popularity, b.popularity);
    if (primary !== 0) return primary;
    return compareTitle(a, b);
  });
  return copy;
}

/** The single entry point the pages use: search → filter → sort, all pure. */
export function filterAndSortAnime<T extends AnimeLike>(entries: T[], filters: AnimeFilters): T[] {
  const matched = entries.filter(
    (entry) => matchesAnimeFilters(entry, filters) && matchesAnimeQuery(entry, filters.q),
  );
  return sortAnime(matched, filters.sort);
}

/* -------------------------------------------------------------------------- *
 * Options derived from the data (the UI never offers an empty option)
 * -------------------------------------------------------------------------- */

export interface TokenOption {
  token: string;
  count: number;
}

function tally(entries: readonly AnimeLike[], key: (entry: AnimeLike) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of entries) {
    const token = key(entry);
    out[token] = (out[token] ?? 0) + 1;
  }
  return out;
}

function optionsInDomain(
  entries: readonly AnimeLike[],
  domain: readonly string[],
  key: (entry: AnimeLike) => string,
): TokenOption[] {
  const counts = tally(entries, key);
  return domain
    .filter((token) => (counts[token] ?? 0) > 0)
    .map((token) => ({ token, count: counts[token] ?? 0 }));
}

export function adaptationOptions(entries: readonly AnimeLike[]): TokenOption[] {
  return optionsInDomain(entries, ADAPTATION_SOURCE_TOKENS, (e) => e.adaptation_source ?? 'unknown');
}

export function formatOptions(entries: readonly AnimeLike[]): TokenOption[] {
  return optionsInDomain(entries, ANIME_FORMAT_TOKENS, (e) => e.format ?? 'other');
}

export function statusOptions(entries: readonly AnimeLike[]): TokenOption[] {
  return optionsInDomain(entries, ANIME_STATUS_TOKENS, (e) => e.status ?? 'unknown');
}

/** Year tokens, numeric descending, with 'unknown' last. */
export function yearOptions(entries: readonly AnimeLike[]): TokenOption[] {
  const counts = tally(entries, (entry) => animeYearToken(entry));
  const numeric = Object.keys(counts)
    .filter((token) => token !== 'unknown')
    .sort((a, b) => Number(b) - Number(a))
    .map((token) => ({ token, count: counts[token] ?? 0 }));
  return counts.unknown ? [...numeric, { token: 'unknown', count: counts.unknown }] : numeric;
}

/** Distinct studio names, Japanese-locale alphabetical. */
export function studioOptions(entries: readonly AnimeLike[]): TokenOption[] {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    for (const studio of entry.studios ?? []) {
      counts[studio] = (counts[studio] ?? 0) + 1;
    }
  }
  return Object.keys(counts)
    .sort((a, b) => {
      try {
        return a.localeCompare(b, 'ja');
      } catch {
        return a.localeCompare(b);
      }
    })
    .map((token) => ({ token, count: counts[token] ?? 0 }));
}

/* ========================================================================== *
 * §8  Small display helper used by both the card and the detail page
 * ========================================================================== */

/** '2 季 24 集' style summary; every missing part becomes "unknown". */
export function animeRuntimeSummary(entry: AnimeLike): string {
  const parts: string[] = [];
  if (typeof entry.episode_count === 'number') parts.push(`${entry.episode_count} 集`);
  else parts.push('集數 unknown');
  if (typeof entry.episode_duration_min === 'number') parts.push(`每集 ${entry.episode_duration_min} 分鐘`);
  else parts.push('時長 unknown');
  return parts.join('・');
}
