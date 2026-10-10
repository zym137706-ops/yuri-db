/**
 * TypeScript mirrors of `schemas/anime.schema.json` (JSON Schema 2020-12) plus the
 * shapes of the two runtime inputs:
 *   - data/anime.json        → AnimeDatasetFile
 *   - data/anime_report.json → AnimeReport
 *
 * Same discipline as lib/types.ts (the Work mirror): field names are copied
 * verbatim from the schema, `["T", "null"]` becomes `| null`, and the schema's
 * `required` list becomes non-optional properties.
 *
 * IMPORTANT — this module is type-only. It is imported as
 * `import type { … } from './anime-types'` so that Node's native TypeScript
 * type-stripping erases the statement entirely; that is what lets
 * scripts/verify-anime.mjs execute the real lib/anime.ts without a bundler.
 * Never add a runtime value (or a non-`type` import) to this file.
 */

/* -------------------------------------------------------------------------- *
 * Enums (schema `enum` keywords — the authoritative domains)
 * -------------------------------------------------------------------------- */

export type AnimeFormat =
  | 'tv'
  | 'tv_short'
  | 'movie'
  | 'ova'
  | 'ona'
  | 'special'
  | 'music'
  | 'other';

export type AdaptationSource =
  | 'manga'
  | 'light_novel'
  | 'web_novel'
  | 'novel'
  | 'visual_novel'
  | 'game'
  | 'doujinshi'
  | 'anime'
  | 'original'
  | 'other'
  | 'unknown';

export type AnimeStatus = 'airing' | 'finished' | 'announced' | 'cancelled' | 'hiatus' | 'unknown';

export type AnimeSeason = 'winter' | 'spring' | 'summer' | 'fall';

/** field_sources.*.basis (mirrors schemas/anime.schema.json). */
export type AnimeFieldBasis = 'official' | 'official_tag' | 'editorial' | 'derived' | 'third_party';

/* -------------------------------------------------------------------------- *
 * Nested objects
 * -------------------------------------------------------------------------- */

/** main_cast[] — one row per MAIN-character credit. `voice_actor` can be null. */
export interface AnimeCastMember {
  character: string;
  voice_actor: string | null;
}

/** sources[] — record-level provenance. Identical shape to WorkSource on purpose. */
export interface AnimeSource {
  source_id: string | null;
  name: string;
  url: string;
  retrieved_at: string;
  confidence: number;
  note: string | null;
}

/** field_sources.* — only `basis` is required by the schema. */
export interface AnimeFieldSource {
  basis: AnimeFieldBasis;
  source_url?: string;
  retrieved_at?: string | null;
  confidence?: number | null;
  note?: string | null;
}

/* -------------------------------------------------------------------------- *
 * The Anime record
 * -------------------------------------------------------------------------- */

export interface Anime {
  id: string;
  slug: string;

  anilist_id: number | null;
  mal_id: number | null;

  title_ja: string;
  title_romaji: string | null;
  title_en: string | null;
  /**
   * 繁中／簡中官方譯名。在本資料集內「全部為 null」——不是因為沒有中文版，
   * 而是來源（AniList）不提供、且管線尚未接入可查證的官方中文來源。
   * schema 對這兩欄的說明即為「目前來源不可達，多為 null」。
   * 因此它們必須一律渲染（顯示「未收錄」），不得隱藏。
   */
  title_zh_tw: string | null;
  title_zh_cn: string | null;

  format: AnimeFormat;
  adaptation_source: AdaptationSource;
  status: AnimeStatus;

  start_date: string | null;
  end_date: string | null;
  season: AnimeSeason | null;
  season_year: number | null;

  episode_count: number | null;
  episode_duration_min: number | null;

  studios: string[];
  main_cast: AnimeCastMember[];

  average_score: number | null;
  popularity: number | null;
  yuri_tag_rank: number | null;
  is_adult: boolean | null;
  country_of_origin: string | null;

  cover_url: string | null;
  cover_source_url: string | null;
  source_url: string;

  related_work_id: string | null;
  related_work_slug: string | null;

  sources: AnimeSource[];
  field_sources: Record<string, AnimeFieldSource>;
  field_confidence: Record<string, number>;

  last_checked: string;
}

export interface AnimeDatasetFile {
  generated_at: string;
  count: number;
  anime: Anime[];
}

/**
 * Client-side projection of an Anime entry, produced by web/scripts/build-slim.mjs.
 *
 * The statically exported /anime page cannot ask a server to filter, so the
 * browser receives this instead of the full `data/anime.json`. It carries exactly
 * the fields the list UI reads (search, every filter dimension, sort, the card and
 * the cover policy) plus `sources_count`, so the card never has to touch
 * `sources[]`. A full `Anime` record satisfies this interface, which keeps the
 * card usable from a server component too — the projection is a strict subset, not
 * a different record.
 */
export interface SlimAnime {
  id: string;
  slug: string;
  title_ja: string;
  title_romaji: string | null;
  title_en: string | null;
  title_zh_tw: string | null;
  title_zh_cn: string | null;
  format: AnimeFormat;
  adaptation_source: AdaptationSource;
  status: AnimeStatus;
  start_date: string | null;
  season: AnimeSeason | null;
  season_year: number | null;
  episode_count: number | null;
  /** Kept so the card's 集數／時長 summary shows the recorded duration, not "unknown". */
  episode_duration_min: number | null;
  studios: string[];
  main_cast: AnimeCastMember[];
  cover_url: string | null;
  cover_source_url: string | null;
  related_work_slug: string | null;
  yuri_tag_rank: number | null;
  country_of_origin: string | null;
  average_score: number | null;
  popularity: number | null;
  /** Precomputed by scripts/build-slim.mjs: `(anime.sources ?? []).length`. */
  sources_count: number;
}

export interface SlimAnimeFile {
  generated_at: string;
  count: number;
  anime: SlimAnime[];
}

/* -------------------------------------------------------------------------- *
 * data/anime_report.json
 * -------------------------------------------------------------------------- */

export interface AnimeReportDropped {
  adult?: number;
  non_jp?: number;
  low_rank?: number;
  no_title?: number;
  [key: string]: number | undefined;
}

export interface AnimeReport {
  generated_at: string;
  total: number;
  by_format: Record<string, number>;
  by_adaptation_source: Record<string, number>;
  by_status: Record<string, number>;
  by_year: Record<string, number>;
  with_studio: number;
  with_cast: number;
  with_start_date: number;
  with_cover: number;
  announced_not_aired: number;
  movies: number;
  linked_works: number;
  schema_errors: unknown[];
  collection_note: string;
  raw_fetched: number;
  dropped: AnimeReportDropped;
}

/* -------------------------------------------------------------------------- *
 * Aggregate computed by lib/anime.ts from data/anime.json (live, not the report)
 * -------------------------------------------------------------------------- */

export interface AnimeLiveStats {
  total: number;
  byFormat: Record<string, number>;
  byAdaptationSource: Record<string, number>;
  byStatus: Record<string, number>;
  bySeason: Record<string, number>;
  /** Same definition as data/anime_report.json `by_year` (season_year first). */
  byYear: Record<string, number>;
  withStudio: number;
  withCast: number;
  withStartDate: number;
  withEndDate: number;
  withCover: number;
  announcedNotAired: number;
  movies: number;
  linkedWorks: number;
  distinctStudios: number;
  distinctVoiceActors: number;
  castEntries: number;
  castEntriesWithoutVoiceActor: number;
  totalSources: number;
  totalFieldSources: number;
  /** field inventory size — the number of schema fields the detail page renders. */
  schemaFieldCount: number;
  /** basis → occurrences across every field_sources entry. */
  byBasis: Record<string, number>;
  /** How many entries have every field_sources basis === "third_party". */
  fullyThirdParty: number;
}
