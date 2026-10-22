/**
 * TypeScript mirrors of `schemas/work.schema.json` (JSON Schema 2020-12) plus the
 * shapes of the other runtime inputs:
 *   - data/works.json           → DatasetFile
 *   - data/dataset_report.json  → DatasetReport
 *   - data/change_log.json      → ChangeLog
 *   - sources.yaml              → SourcesFile
 *
 * Field names are copied verbatim from the schema on purpose: the schema is the
 * contract. Fields that the schema marks `["T","null"]` are modelled as `| null`;
 * fields the schema lists under `required` are non-optional.
 */

/* -------------------------------------------------------------------------- *
 * Enums (schema `enum` keywords)
 * -------------------------------------------------------------------------- */

export type MediaType = 'manga' | 'light_novel' | 'web_novel';
export type SerializationStatus = 'ongoing' | 'completed' | 'hiatus' | 'unknown';
export type YuriType = 'orthodox_yuri' | 'light_yuri' | 's_class' | 'gl' | 'micro_yuri' | 'uncertain';
export type ClassificationBasis = 'official_tag' | 'editorial';
export type AnimeStatus = 'none' | 'announced' | 'in_production' | 'airing' | 'finished' | 'movie';
export type PlatformKind = 'magazine' | 'web_platform' | 'web_novel_site' | 'label' | 'other' | null;
/**
 * anime_details.format —— 必须与 collectors/anime.py 能产出的取值一致。
 * 曾经只有 'tv'|'movie'|'ova'|'web'，而动画目录还会产出 ona/tv_short/special/
 * music/other；一旦某部作品匹配到这些形态，build_dataset.py 就会写出非法枚举值、
 * schema 校验失败、collect-news 作业整条变红（间歇性，取决于当次匹配结果）。
 */
export type AnimeFormat =
  | 'tv'
  | 'movie'
  | 'ova'
  | 'ona'
  | 'tv_short'
  | 'special'
  | 'music'
  | 'other'
  | null;
export type OfficialZhCnKind = 'print' | 'digital' | 'both' | 'none' | 'unknown';
export type UnofficialZhStatus = 'unknown' | 'manually_flagged';
/** A language/edition region. Used for volumes, ratings and covers alike. */
export type Region = 'ja' | 'zh_tw' | 'zh_cn';

export type RatingRegion = Region;

/**
 * Client-side projection of a Work, produced by web/scripts/build-slim.mjs.
 *
 * The statically exported list page cannot ask a server to filter, so the browser
 * receives this instead of the 4.7 MB `data/works.json`.
 *
 * Two deliberate substitutions keep it equivalent to the full record:
 *   - `avg_confidence` is precomputed with the REAL averageFieldConfidence(), so
 *     the card cannot disagree with the detail page;
 *   - `zh_tw_volumes` / `zh_cn_volumes` are replaced by a 1-element placeholder
 *     when the real array is non-empty, because workHasZh*Edition only tests
 *     `.length > 0`. The resulting boolean is therefore exact.
 */
export interface SlimWork {
  id: string;
  slug: string;
  title_ja: string;
  title_zh_tw: string | null;
  title_zh_cn: string | null;
  title_en: string | null;
  title_zh_tw_status: TitleStatus;
  title_zh_cn_status: TitleStatus;
  media_type: MediaType;
  serialization_status: SerializationStatus;
  publisher_ja: string | null;
  publisher_zh_tw: string | null;
  publisher_zh_cn: string | null;
  magazine_or_platform: string | null;
  magazine_or_platform_kind: PlatformKind;
  authors: string[];
  illustrators: string[];
  genres: string[];
  yuri_type: YuriType;
  classification_basis: ClassificationBasis;
  anime_status: AnimeStatus;
  start_date: string | null;
  last_checked: string;
  zh_tw_volumes: unknown[];
  zh_cn_volumes: unknown[];
  official_zh_cn: { exists: boolean };
  cover_url: string | null;
  cover_source_url: string | null;
  cover_region: Region | null;
  cover_display_allowed: boolean | null;
  cover_note: string | null;
  volume_count_ja: number | null;
  sources_count: number;
  avg_confidence: number | null;
  has_zh_tw: boolean;
  has_zh_cn: boolean;
}

export interface SlimWorksFile {
  generated_at: string;
  count: number;
  works: SlimWork[];
}

/**
 * 譯名狀態：區分「確認沒有官方版」與「還沒查」。
 * 刻意不用 "unknown" 當作值——那會與本專案用來表示「缺值」的哨兵字串
 * "unknown" 撞在一起，讓「值是 unknown」和「值不存在」無法區分。
 */
export type TitleStatus = 'official' | 'unchecked' | 'none_known';
export type ScoreScale = 5 | 10 | 100;
/**
 * field_sources.*.basis.
 *
 * `third_party` is in schemas/work.schema.json's basis enum and is the ONLY basis
 * used by the anime catalogue (schemas/anime.schema.json: every AniList-derived
 * field), so it must be representable in the shared FieldView model rather than
 * being collapsed into "plain".
 */
export type FieldBasis = 'official' | 'official_tag' | 'editorial' | 'derived' | 'third_party';

/* -------------------------------------------------------------------------- *
 * Nested objects
 * -------------------------------------------------------------------------- */

/** Not referenced by works.json today, but present in the schema + Prisma model. */
export interface AnimeDetails {
  studio: string | null;
  broadcast_date: string | null;
  broadcast_end: string | null;
  episode_count: number | null;
  format: AnimeFormat;
  official_url: string | null;
  source_url: string | null;
}

/** $defs.volumeJaList — the only volume list that may carry price + cover_url. */
export interface VolumeJa {
  volume: number;
  isbn: string | null;
  release_date: string | null;
  publisher: string | null;
  price: string | null;
  cover_url: string | null;
  source_url: string | null;
}

/** $defs.volumeZhList */
export interface VolumeZh {
  volume: number;
  isbn: string | null;
  release_date: string | null;
  publisher: string | null;
  translator: string | null;
  source_url: string | null;
}

export interface OfficialZhCn {
  exists: boolean;
  kind: OfficialZhCnKind;
  publisher: string | null;
  latest_volume: number | null;
  isbn: string | null;
  source_url: string | null;
}

/**
 * Schema D1: this object has *no* link/obtaining field by design, and `note` is
 * additionally pattern-constrained to reject URLs. The UI must never synthesise
 * a link for it.
 */
export interface UnofficialZh {
  status: UnofficialZhStatus;
  latest_chapter: string | null;
  last_seen: string | null;
  note: string | null;
  recorded_by: string | null;
  recorded_at: string | null;
}

/** Evaluation layer [A] — aggregate score only, never a review body. */
export interface Rating {
  source_id: string;
  region: RatingRegion;
  score_value: number;
  score_scale: ScoreScale;
  score_count: number | null;
  display_allowed: boolean;
  license_note: string | null;
  source_url: string;
  retrieved_at: string;
}

/** Evaluation layer [B] — review/ranking metadata only, no body. */
export interface ReviewMeta {
  source_id: string;
  outlet: string;
  reviewer: string | null;
  published_date: string | null;
  rank: number | null;
  points: number | null;
  source_url: string;
  retrieved_at: string;
}

export interface WorkSource {
  source_id: string | null;
  name: string;
  url: string;
  retrieved_at: string;
  confidence: number;
  note: string | null;
}

/** Only `basis` is required by the schema; everything else may be absent. */
export interface FieldSource {
  basis: FieldBasis;
  source_url?: string;
  retrieved_at?: string | null;
  confidence?: number | null;
  note?: string | null;
}

/* -------------------------------------------------------------------------- *
 * The Work record
 * -------------------------------------------------------------------------- */

export interface Work {
  id: string;
  slug: string;
  title_ja: string;
  title_zh_tw: string | null;
  title_zh_cn: string | null;
  title_en: string | null;

  /** official = 有官方譯名；none_known = 已查證目前無官方版；unknown = 尚未查證 */
  title_zh_tw_status: TitleStatus;
  title_zh_cn_status: TitleStatus;

  /**
   * 封面只存 URL，不鏡像檔案。`cover_display_allowed === false` 時 UI 只顯示
   * 外連，不嵌入 <img>。
   */
  cover_url: string | null;
  cover_source_url: string | null;
  cover_region: Region | null;
  cover_display_allowed: boolean | null;
  cover_note: string | null;

  media_type: MediaType;
  serialization_status: SerializationStatus;

  publisher_ja: string | null;
  publisher_zh_tw: string | null;
  publisher_zh_cn: string | null;
  magazine_or_platform: string | null;
  magazine_or_platform_kind: PlatformKind;
  magazine_or_platform_active: boolean | null;

  authors: string[];
  illustrators: string[];

  start_date: string | null;
  end_date: string | null;

  latest_chapter_label: string | null;
  chapter_count: number | null;

  volume_count_ja: number | null;
  volume_count_zh_tw: number | null;
  volume_count_zh_cn: number | null;

  genres: string[];
  genres_official: boolean | null;

  yuri_type: YuriType;
  classification_basis: ClassificationBasis;

  anime_status: AnimeStatus;
  anime_details: AnimeDetails | null;

  ja_volumes: VolumeJa[];
  zh_tw_volumes: VolumeZh[];
  zh_cn_volumes: VolumeZh[];

  official_zh_cn: OfficialZhCn;
  unofficial_zh: UnofficialZh;

  ratings: Rating[];
  review_meta: ReviewMeta[];

  sources: WorkSource[];
  field_sources: Record<string, FieldSource>;
  field_confidence: Record<string, number>;

  last_checked: string;
  /** Optional in the schema and absent from the current dataset export. */
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DatasetFile {
  generated_at: string;
  count: number;
  works: Work[];
}

/* -------------------------------------------------------------------------- *
 * data/dataset_report.json
 * -------------------------------------------------------------------------- */

export interface DatasetReport {
  generated_at: string;
  source_records: Record<string, number>;
  works_total: number;
  by_media_type: Record<string, number>;
  by_status: Record<string, number>;
  by_magazine: Record<string, number>;
  core_field_completeness: Record<string, number>;
  extended_field_completeness: Record<string, number>;
  works_with_zh_tw_volumes: number;
  cross_language_linked: number;
  pending_linkage: number;
  merges: unknown[];
  schema_errors: unknown[];
  raw_files: number;
}

/* -------------------------------------------------------------------------- *
 * data/change_log.json  (produced by the daily pipeline; may not exist yet)
 * -------------------------------------------------------------------------- */

export type ChangeType = 'created' | 'updated' | 'field_changed' | 'removed' | 'unchanged' | string;

export interface ChangeLogEntry {
  entity_type: string;
  entity_id: string;
  work_id: string;
  change_type: ChangeType;
  field_name: string | null;
  old_value: unknown;
  new_value: unknown;
  source_id: string | null;
  detected_at: string;
}

export interface ChangeLog {
  generated_at: string;
  total: number;
  latest_run_entries: number;
  entries: ChangeLogEntry[];
}

/* -------------------------------------------------------------------------- *
 * sources.yaml
 * -------------------------------------------------------------------------- */

/**
 * `sources:` entries. The file carries many more keys than the MVP renders
 * (`fields_available`, `robots_txt_finding`, `terms_finding`, `evidence_urls`, …);
 * they are tolerated through the index signature but not typed individually.
 */
export interface RegisteredSource {
  id: string;
  name: string;
  url: string;
  category: string;
  source_type?: string;
  method?: string;
  confidence?: string;
  verified_by?: string;
  status_2026?: string;
  reachable_from_dev_host?: boolean;
  review_text_available?: string;
  copyright_risk_for_reviews?: string;
  region?: string;
  [key: string]: unknown;
}

export interface SourcesFile {
  meta: Record<string, unknown>;
  /** 75 entries in the current file. */
  sources: RegisteredSource[];
  /** 19 entries in the current file; a separate model with review-specific keys. */
  review_sources: RegisteredSource[];
  field_source_map?: Record<string, unknown>;
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- *
 * Provenance view models used by the detail page
 * -------------------------------------------------------------------------- */

export type ProvenanceState =
  /** A value exists and the schema gives a basis for it. */
  | 'sourced'
  /** A value exists but no field_sources entry covers it. */
  | 'unsourced'
  /** No value: schema-null/empty. Rendered as "unknown". */
  | 'unknown';

export interface FieldView {
  field: string;
  label: string;
  /** Already formatted for display, or the literal "unknown". */
  value: string;
  isUnknown: boolean;
  /** The unformatted value, for badges/links. */
  raw: unknown;
  /** Token(s) used for a coloured enum badge, when applicable. */
  token: string | null;
  source: FieldSource | null;
  confidence: number | null;
  basis: FieldBasis | null;
  /** basis === "editorial" ⇒ no source link is rendered, even if a URL exists. */
  editorial: boolean;
  /**
   * The source URL the UI is allowed to link to. Always null when `editorial` is
   * true, so an editorial judgement can never acquire a source link.
   */
  linkableSourceUrl: string | null;
  state: ProvenanceState;
}
