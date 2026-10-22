/**
 * Pure, dependency-free business rules for the yuri-db web MVP.
 *
 * This module deliberately has **zero imports** (not even `import type`) so that
 * it can be executed both by Next.js/webpack and directly by Node's native
 * TypeScript type-stripping (`node scripts/verify-policy.mjs`). That is how the
 * rating policy, the `unofficial_zh` rule and the filter/search logic are
 * verified against the real dataset without needing `npm install`.
 *
 * Rules encoded here come from:
 *   - docs/phase1-feasibility-report.md §5.2  (three-layer review model, P1–P5)
 *   - schemas/work.schema.json                (D1 / D2 invariants)
 */

/* ========================================================================== *
 * §5.2 review / rating display policy
 * ========================================================================== */

/** score_scale is an explicit content column — never infer it, never merge scales. */
export type ScoreScale = 5 | 10 | 100;

/** Human-readable rendering of each allowed scale. */
export const SCORE_SCALE_LABELS: Record<ScoreScale, string> = {
  5: '5 分制',
  10: '10 分制',
  100: '100 分制',
};

/** P3: scores from different sources/scales must never be averaged together. */
export const CROSS_SCALE_AVERAGE_IS_FORBIDDEN =
  '不同評分口徑（5 分制 / 10 分制 / 100 分制）不得合併平均計算（§5.2 P3）。';

export interface RatingLike {
  source_id?: string | null;
  region?: string | null;
  score_value?: number | null;
  score_scale?: number | null;
  score_count?: number | null;
  display_allowed?: boolean | null;
  license_note?: string | null;
  source_url?: string | null;
  retrieved_at?: string | null;
}

export interface RatingDisplay {
  /** false ⇒ render a link only, with no number anywhere (§5.2 P4). */
  showNumber: boolean;
  /** null when `showNumber` is false or the scale is not one of 5/10/100. */
  scoreText: string | null;
  /** e.g. "5 分制"; always shown even when the number is withheld. */
  scaleText: string;
  countText: string | null;
  /** 0..100 for a visual bar; null when the number may not be shown. */
  percent: number | null;
  outboundUrl: string;
  outboundLabel: string;
  regionText: string;
  /** Why the number is or is not shown — surfaced to the reader, not hidden. */
  policyNote: string;
  licenseNote: string | null;
  retrievedAt: string | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function scoreScaleLabel(scale: number | null | undefined): string {
  if (scale === 5 || scale === 10 || scale === 100) return SCORE_SCALE_LABELS[scale];
  return scale == null ? '口徑未知' : `${scale} 分制（未登錄口徑）`;
}

/** Formats the number for a given scale without ever changing its meaning. */
export function formatScoreValue(value: number | null | undefined, scale: number | null | undefined): string | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const rendered = scale === 100 ? String(Math.round(value)) : String(round1(value));
  return rendered;
}

export function formatScoreCount(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || Number.isNaN(count) || count < 0) return null;
  return `${count} 則評分`;
}

export const REGION_LABELS: Record<string, string> = {
  ja: '日文',
  zh_tw: '繁中',
  zh_cn: '簡中',
};

export function regionLabel(region: string | null | undefined): string {
  if (!region) return '地區未知';
  return REGION_LABELS[region] ?? region;
}

/**
 * Applies §5.2 to a single rating row.
 *
 * P2  scale is always displayed.
 * P4  display_allowed === false ⇒ link only, no number.
 * P5  source_url + retrieved_at travel with the value.
 */
export function formatRatingDisplay(rating: RatingLike): RatingDisplay {
  const scale = rating.score_scale ?? null;
  const scaleText = scoreScaleLabel(scale);
  const url = typeof rating.source_url === 'string' ? rating.source_url : '';
  const regionText = regionLabel(rating.region);
  const countText = formatScoreCount(rating.score_count ?? null);

  const isKnownScale = scale === 5 || scale === 10 || scale === 100;
  const allowed = rating.display_allowed === true;
  const formatted = formatScoreValue(rating.score_value ?? null, scale);

  if (!allowed) {
    // P4 — the source's terms or robots forbid showing the value.
    return {
      showNumber: false,
      scoreText: null,
      scaleText,
      countText: null,
      percent: null,
      outboundUrl: url,
      outboundLabel: '前往原站查看評分',
      regionText,
      policyNote: '此來源的條款／robots 不允許本站展示數值，僅提供外鏈（§5.2 P4）。',
      licenseNote: rating.license_note ?? null,
      retrievedAt: rating.retrieved_at ?? null,
    };
  }

  if (!isKnownScale || formatted === null) {
    // display is allowed but we cannot state a number honestly.
    const missing = !isKnownScale ? '評分口徑未登錄' : '無評分數值';
    return {
      showNumber: false,
      scoreText: null,
      scaleText,
      countText,
      percent: null,
      outboundUrl: url,
      outboundLabel: '前往原站查看評分',
      regionText,
      policyNote: `${missing}，故不顯示數字，僅提供外鏈。`,
      licenseNote: rating.license_note ?? null,
      retrievedAt: rating.retrieved_at ?? null,
    };
  }

  return {
    showNumber: true,
    scoreText: `${formatted} / ${scale}`,
    scaleText,
    countText,
    percent: ratingPercent(rating.score_value ?? null, scale),
    outboundUrl: url,
    outboundLabel: '查看原文／原站',
    regionText,
    policyNote: '僅顯示聚合分數與件數，評論正文不入庫、不轉載（§5.2 P1/P2）。',
    licenseNote: rating.license_note ?? null,
    retrievedAt: rating.retrieved_at ?? null,
  };
}

/**
 * value/scale as 0..100, rounded to one decimal.
 *
 * The rounding is not cosmetic: `4.2 / 5 * 100` is `84.00000000000001` in IEEE-754,
 * which would otherwise leak straight into a CSS width.
 */
export function ratingPercent(value: number | null | undefined, scale: number | null | undefined): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  if (scale !== 5 && scale !== 10 && scale !== 100) return null;
  const ratio = (value / scale) * 100;
  return Math.max(0, Math.min(100, Math.round(ratio * 10) / 10));
}

export interface RatingScaleGroup {
  scale: ScoreScale;
  scaleText: string;
  items: RatingLike[];
  /** Number of items in this group whose value may be displayed. */
  displayableCount: number;
}

/**
 * Groups ratings by scale. Deliberately does NOT compute a combined average:
 * returning one bucket per scale makes cross-scale averaging impossible for
 * any caller that only uses this function.
 */
export function groupRatingsByScale(ratings: RatingLike[]): RatingScaleGroup[] {
  const order: ScoreScale[] = [5, 10, 100];
  const groups: RatingScaleGroup[] = [];
  for (const scale of order) {
    const items = ratings.filter((r) => r.score_scale === scale);
    if (items.length === 0) continue;
    groups.push({
      scale,
      scaleText: SCORE_SCALE_LABELS[scale],
      items,
      displayableCount: items.filter((r) => r.display_allowed === true).length,
    });
  }
  return groups;
}

/** Ratings whose scale is unknown still get their own bucket rather than being merged. */
export function ungroupedRatings(ratings: RatingLike[]): RatingLike[] {
  return ratings.filter((r) => r.score_scale !== 5 && r.score_scale !== 10 && r.score_scale !== 100);
}

/* ========================================================================== *
 * D1 — unofficial_zh policy
 * ========================================================================== */

/** Fixed sentence required whenever `unofficial_zh.status === "unknown"`. */
export const UNOFFICIAL_ZH_UNKNOWN_SENTENCE =
  '本数据库只收录官方授权中文版信息。非官方翻译不在收录范围，因此不作标注。';

export const UNOFFICIAL_ZH_POLICY_NOTE =
  '非官方漢化僅允許人工登記，且資料結構中刻意不存在任何連結欄位（schema D1）。本頁不提供、也不顯示任何取得方式。';

export const UNOFFICIAL_ZH_MANUALLY_FLAGGED_NOTE =
  '此作品由人工確認存在非官方漢化，但依 D1 規範不提供任何連結或取得方式。';

export type UnofficialZhStatus = 'unknown' | 'manually_flagged';

export interface UnofficialZhLike {
  status?: string | null;
  latest_chapter?: string | null;
  last_seen?: string | null;
  note?: string | null;
  recorded_by?: string | null;
  recorded_at?: string | null;
}

export interface UnofficialZhDisplay {
  status: string;
  statusText: string;
  /** The fixed compliance sentence, or the manual-flag explanation. */
  explanation: string;
  /** Always false — no code path can produce a link for this section. */
  hasLink: false;
  /** Only ever populated when status === "manually_flagged" (schema D1). */
  latestChapter: string | null;
  lastSeen: string | null;
  recordedBy: string | null;
  recordedAt: string | null;
  humanNote: string | null;
}

export function formatUnofficialZh(u: UnofficialZhLike | null | undefined): UnofficialZhDisplay {
  const status = u?.status ?? 'unknown';
  const manuallyFlagged = status === 'manually_flagged';

  // D1: chapter info is only meaningful (and only legal) for manually_flagged rows.
  const latestChapter = manuallyFlagged ? (u?.latest_chapter ?? null) : null;
  const lastSeen = manuallyFlagged ? (u?.last_seen ?? null) : null;

  return {
    status,
    statusText: manuallyFlagged ? '人工標記存在' : '未標註',
    explanation: manuallyFlagged ? UNOFFICIAL_ZH_MANUALLY_FLAGGED_NOTE : UNOFFICIAL_ZH_UNKNOWN_SENTENCE,
    hasLink: false,
    latestChapter,
    lastSeen,
    recordedBy: manuallyFlagged ? (u?.recorded_by ?? null) : null,
    recordedAt: manuallyFlagged ? (u?.recorded_at ?? null) : null,
    humanNote: manuallyFlagged ? (u?.note ?? null) : null,
  };
}

/**
 * Defence in depth for D1: scans a rendered payload for anything that looks like
 * a link. Used by scripts/verify-policy.mjs and by the detail page's own guard.
 */
export function containsLinkLikeText(value: unknown): boolean {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return /(?:[hH][tT][tT][pP][sS]?:\/\/)|(?:[wW]{3}\.)|(?:[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/.test(text);
}

/* ========================================================================== *
 * Search + filters (all state lives in the URL query string)
 * ========================================================================== */

export const MEDIA_TYPES = ['manga', 'light_novel', 'web_novel'] as const;
export const SERIALIZATION_STATUSES = ['ongoing', 'completed', 'hiatus', 'unknown'] as const;
export const YURI_TYPES = ['orthodox_yuri', 'light_yuri', 's_class', 'gl', 'micro_yuri', 'uncertain'] as const;
export const ANIME_STATUSES = ['none', 'announced', 'in_production', 'airing', 'finished', 'movie'] as const;

/** Tri-state for "does a Chinese edition exist". */
export type EditionFilter = 'any' | 'yes' | 'no';

export const SORT_OPTIONS = ['title', 'recent'] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export interface WorkFilters {
  q: string;
  /**
   * Single creator name (author OR illustrator), matched by exact equality.
   * Kept as one string rather than a list because the UI is a text box: the
   * dataset has hundreds of distinct creators, so a checkbox list would be both
   * unusable and enormous.
   */
  author: string;
  status: string[];
  media: string[];
  yuri: string[];
  anime: string[];
  zhTw: EditionFilter;
  zhCn: EditionFilter;
  sort: SortOption;
}

/** Permissive structural view of a Work — keeps this module import-free. */export interface WorkLike {
  id?: string | null;
  slug?: string | null;
  title_ja?: string | null;
  title_zh_tw?: string | null;
  title_zh_cn?: string | null;
  title_en?: string | null;
  media_type?: string | null;
  serialization_status?: string | null;
  publisher_ja?: string | null;
  publisher_zh_tw?: string | null;
  publisher_zh_cn?: string | null;
  magazine_or_platform?: string | null;
  authors?: readonly string[] | null;
  illustrators?: readonly string[] | null;
  genres?: readonly string[] | null;
  yuri_type?: string | null;
  classification_basis?: string | null;
  anime_status?: string | null;
  zh_tw_volumes?: readonly unknown[] | null;
  zh_cn_volumes?: readonly unknown[] | null;
  official_zh_cn?: { exists?: boolean | null } | null;
  last_checked?: string | null;
  field_confidence?: Record<string, number> | null;
}

type QueryInput = Record<string, string | string[] | undefined>;

function firstValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function toList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  const raw = Array.isArray(v) ? v : [v];
  return raw
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toEdition(v: string | string[] | undefined): EditionFilter {
  const value = firstValue(v);
  return value === 'yes' || value === 'no' ? value : 'any';
}

function toSort(v: string | string[] | undefined): SortOption {
  return firstValue(v) === 'recent' ? 'recent' : 'title';
}

/**
 * Reads the URL query string into filters. Accepts both repeated keys
 * (`?status=a&status=b`, what an HTML form produces) and comma lists
 * (`?status=a,b`, what a hand-written share link tends to use).
 * Unknown values are dropped, so a stale link degrades instead of throwing.
 */
export function parseFilters(input: QueryInput | undefined | null): WorkFilters {
  const q = input ?? {};
  return {
    q: (firstValue(q.q) ?? '').trim(),
    author: (firstValue(q.author) ?? '').trim(),
    status: toList(q.status).filter((v) => (SERIALIZATION_STATUSES as readonly string[]).includes(v)),
    media: toList(q.media).filter((v) => (MEDIA_TYPES as readonly string[]).includes(v)),
    yuri: toList(q.yuri).filter((v) => (YURI_TYPES as readonly string[]).includes(v)),
    anime: toList(q.anime).filter((v) => (ANIME_STATUSES as readonly string[]).includes(v)),
    zhTw: toEdition(q.zh_tw),
    zhCn: toEdition(q.zh_cn),
    sort: toSort(q.sort),
  };
}

/**
 * Serialises filters back into a shareable query string. Defaults are omitted so
 * the canonical URL stays short, and key order is fixed so the same filter set
 * always produces the same link.
 */
export function buildQueryString(filters: WorkFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  // URLSearchParams percent-encodes the value, so CJK creator names (and names
  // containing &, #, +, …) survive the round-trip through `?author=`.
  if (filters.author.trim()) params.set('author', filters.author.trim());
  for (const value of [...filters.status].sort()) params.append('status', value);
  for (const value of [...filters.media].sort()) params.append('media', value);
  for (const value of [...filters.yuri].sort()) params.append('yuri', value);
  for (const value of [...filters.anime].sort()) params.append('anime', value);
  if (filters.zhTw !== 'any') params.set('zh_tw', filters.zhTw);
  if (filters.zhCn !== 'any') params.set('zh_cn', filters.zhCn);
  if (filters.sort !== 'title') params.set('sort', filters.sort);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Canonical in-app link to "every work by this creator".
 *
 * Returns an app-relative URL (`/?author=…`), NOT a site-absolute one: callers
 * must render it with `next/link`, which prepends `NEXT_BASE_PATH`. Hand-writing
 * the base path here would double it on GitHub Pages and break local dev.
 * `encodeURIComponent` handles CJK, spaces, `&`, `#` and `+`.
 */
export function authorFilterHref(author: string): string {
  const name = author.trim();
  return name ? `/?author=${encodeURIComponent(name)}` : '/';
}

/** How many filter dimensions are active — drives the "已套用 N 個條件" hint. */
export function countActiveFilters(filters: WorkFilters): number {
  let n = 0;
  if (filters.q.trim()) n += 1;
  if (filters.author.trim()) n += 1;
  n += filters.status.length + filters.media.length + filters.yuri.length + filters.anime.length;
  if (filters.zhTw !== 'any') n += 1;
  if (filters.zhCn !== 'any') n += 1;
  if (filters.sort !== 'title') n += 1;
  return n;
}

/* ---- edition detection (drives the 繁中 / 簡中 filters) -------------------- */

export function workHasZhTwEdition(work: WorkLike): boolean {
  if (work.title_zh_tw != null && work.title_zh_tw !== '') return true;
  if (work.publisher_zh_tw != null && work.publisher_zh_tw !== '') return true;
  return (work.zh_tw_volumes?.length ?? 0) > 0;
}

export function workHasZhCnEdition(work: WorkLike): boolean {
  if (work.title_zh_cn != null && work.title_zh_cn !== '') return true;
  if (work.publisher_zh_cn != null && work.publisher_zh_cn !== '') return true;
  if ((work.zh_cn_volumes?.length ?? 0) > 0) return true;
  return work.official_zh_cn?.exists === true;
}

/* ---- search -------------------------------------------------------------- */

/** NFKC + lowercase + collapse whitespace; keeps CJK intact. */
export function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Fields searched, per the Phase 4 requirement:
 * title (ja / zh_tw / zh_cn / en), author, publisher, magazine/platform.
 * Illustrator, slug and id are included as a convenience for deep links.
 */
export function searchableText(work: WorkLike): string[] {
  return [
    work.title_ja,
    work.title_zh_tw,
    work.title_zh_cn,
    work.title_en,
    work.slug,
    work.id,
    work.publisher_ja,
    work.publisher_zh_tw,
    work.publisher_zh_cn,
    work.magazine_or_platform,
    ...(work.authors ?? []),
    ...(work.illustrators ?? []),
    ...(work.genres ?? []),
  ]
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}

export function matchesQuery(work: WorkLike, query: string): boolean {
  const needle = normalizeText(query);
  if (!needle) return true;
  const haystack = searchableText(work).map(normalizeText);
  // every whitespace-separated token must appear somewhere (AND semantics)
  const tokens = needle.split(' ').filter(Boolean);
  return tokens.every((token) => haystack.some((field) => field.includes(token)));
}

/* ---- filtering ----------------------------------------------------------- */

/**
 * Exact creator match across BOTH `authors` and `illustrators`.
 *
 * Deliberately uses `Array.prototype.includes` (exact equality) rather than a
 * substring test: `?author=入間` must not silently return every 入間人間 work,
 * because the filter is presented to the reader as "this person's works".
 * A blank name means "no creator filter" and matches everything.
 */
export function matchesCreator(work: WorkLike, name: string): boolean {
  const needle = name.trim();
  if (!needle) return true;
  return (work.authors ?? []).includes(needle) || (work.illustrators ?? []).includes(needle);
}

function matchesEdition(work: WorkLike, filter: EditionFilter, has: (w: WorkLike) => boolean): boolean {
  if (filter === 'any') return true;
  const exists = has(work);
  return filter === 'yes' ? exists : !exists;
}

export function matchesFilters(work: WorkLike, filters: WorkFilters): boolean {
  if (!matchesCreator(work, filters.author)) return false;
  if (filters.status.length && !filters.status.includes(work.serialization_status ?? '')) return false;
  if (filters.media.length && !filters.media.includes(work.media_type ?? '')) return false;
  if (filters.yuri.length && !filters.yuri.includes(work.yuri_type ?? '')) return false;
  if (filters.anime.length && !filters.anime.includes(work.anime_status ?? '')) return false;
  if (!matchesEdition(work, filters.zhTw, workHasZhTwEdition)) return false;
  if (!matchesEdition(work, filters.zhCn, workHasZhCnEdition)) return false;
  return true;
}

function averageConfidence(work: WorkLike): number {
  const values = Object.values(work.field_confidence ?? {}).filter((n) => typeof n === 'number');
  if (values.length === 0) return -1;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function sortWorks<T extends WorkLike>(works: T[], sort: SortOption): T[] {
  const copy = [...works];
  if (sort === 'recent') {
    copy.sort((a, b) => String(b.last_checked ?? '').localeCompare(String(a.last_checked ?? '')));
    return copy;
  }
  copy.sort((a, b) => {
    const titleA = a.title_ja ?? a.slug ?? '';
    const titleB = b.title_ja ?? b.slug ?? '';
    try {
      return titleA.localeCompare(titleB, 'ja');
    } catch {
      return titleA.localeCompare(titleB);
    }
  });
  return copy;
}

/** The single entry point the pages use: search → filter → sort, all pure. */
export function filterAndSortWorks<T extends WorkLike>(works: T[], filters: WorkFilters): T[] {
  const matched = works.filter((w) => matchesFilters(w, filters) && matchesQuery(w, filters.q));
  return sortWorks(matched, filters.sort);
}

/* ========================================================================== *
 * Display helpers shared by several pages
 * ========================================================================== */

/** A null / missing value is rendered as "unknown" — never hidden. */
export const UNKNOWN_TEXT = 'unknown';

export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function displayValue(value: unknown): string {
  if (isBlank(value)) return UNKNOWN_TEXT;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((v) => String(v)).join('、');
  return String(value);
}

export function confidencePercent(confidence: number | null | undefined): number | null {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) return null;
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}

export function confidenceText(confidence: number | null | undefined): string {
  const percent = confidencePercent(confidence);
  return percent === null ? UNKNOWN_TEXT : `${percent}%`;
}

/** confidence bands used for colour-coding provenance. */
export function confidenceBand(confidence: number | null | undefined): 'high' | 'medium' | 'low' | 'unknown' {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) return 'unknown';
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

/** ISO timestamp → `YYYY-MM-DD HH:mm UTC`; never throws on odd input. */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return UNKNOWN_TEXT;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function formatDate(value: string | null | undefined): string {
  return value && value.trim() ? value : UNKNOWN_TEXT;
}

/** "3 天前" style relative note for fresh/stale data badges. */
export function relativeAge(value: string | null | undefined, now: number = Date.now()): string | null {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return '今日';
  if (days === 1) return '1 天前';
  return `${days} 天前`;
}
