/**
 * Display labels (繁體中文) for every enum in schemas/anime.schema.json.
 *
 * Zero imports, for the same reason as lib/policy.ts: Node must be able to
 * execute this file directly (via scripts/verify-anime.mjs) without a bundler.
 * Unknown values fall through to the raw token, so a future schema addition
 * degrades to "shows the raw token" instead of crashing.
 */

export const ANIME_FORMAT_LABELS: Record<string, string> = {
  tv: 'TV 動畫',
  tv_short: 'TV 短篇動畫',
  movie: '劇場版',
  ova: 'OVA（原創動畫錄影帶）',
  ona: '網路動畫（ONA）',
  special: '特別篇',
  music: '音樂影像',
  other: '其他形態',
};

/**
 * adaptation_source。使用者的四個分類對應：
 *   漫改        → manga
 *   輕小說改    → light_novel / web_novel / novel（另加 visual_novel / game 於預設篩選中）
 *   原創        → original
 *   劇場版      → 由 format === "movie" 決定，與改編類型無關
 */
export const ADAPTATION_SOURCE_LABELS: Record<string, string> = {
  manga: '漫畫改編（漫改）',
  light_novel: '輕小說改編',
  web_novel: '網路小說改編',
  novel: '小說改編',
  visual_novel: '視覺小說改編',
  game: '遊戲改編',
  doujinshi: '同人誌改編',
  anime: '動畫改編',
  original: '原創',
  other: '其他改編來源',
  unknown: '來源未知',
};

export const ANIME_STATUS_LABELS: Record<string, string> = {
  airing: '放送中',
  finished: '已完結',
  announced: '已宣布動畫化（尚未播出）',
  cancelled: '已取消',
  hiatus: '休止中',
  unknown: '狀態未知',
};

export const ANIME_SEASON_LABELS: Record<string, string> = {
  winter: '冬番（1 月）',
  spring: '春番（4 月）',
  summer: '夏番（7 月）',
  fall: '秋番（10 月）',
};

export const ANIME_SORT_LABELS: Record<string, string> = {
  air_date_desc: '開播時間（新→舊，未知排最後）',
  air_date_asc: '開播時間（舊→新，未知排最後）',
  title: '日文標題（あ→ん）',
  score_desc: 'AniList 平均分（高→低）',
  popularity_desc: 'AniList 人氣（高→低）',
};

/** field_sources.basis — the provenance vocabulary, incl. third_party. */
export const BASIS_LABELS: Record<string, string> = {
  official: '官方',
  official_tag: '官方標籤',
  editorial: '編輯判斷',
  derived: '推導',
  third_party: '第三方資料庫',
};

/**
 * 譯名狀態。anime schema 沒有 title_zh_*_status 欄位（不像 Work），因此一律以
 * 「未收錄」與原因說明呈現，不推測是「沒有中文版」還是「還沒查」。
 */
export const UNRECORDED_ZH_TITLE_NOTE =
  '本站動畫資料來自 AniList，該來源不提供官方繁中／簡中譯名，管線也未接入可查證的官方中文來源，因此 title_zh_tw / title_zh_cn 一律為 null。畫面上顯示「未收錄」代表「本站未收錄此譯名」，不代表「不存在中文版」。';

/** Looks a token up in a label map, falling back to the raw token. */
export function labelOf(map: Record<string, string>, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'unknown';
  return map[value] ?? value;
}

export const animeFormatLabel = (v: string | null | undefined): string => labelOf(ANIME_FORMAT_LABELS, v);
export const adaptationSourceLabel = (v: string | null | undefined): string => labelOf(ADAPTATION_SOURCE_LABELS, v);
export const animeStatusLabel = (v: string | null | undefined): string => labelOf(ANIME_STATUS_LABELS, v);
export const animeSeasonLabel = (v: string | null | undefined): string => labelOf(ANIME_SEASON_LABELS, v);
export const animeSortLabel = (v: string | null | undefined): string => labelOf(ANIME_SORT_LABELS, v);
export const basisLabel = (v: string | null | undefined): string => labelOf(BASIS_LABELS, v);
