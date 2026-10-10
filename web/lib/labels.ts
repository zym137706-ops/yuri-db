/**
 * Display labels (繁體中文) for every enum in schemas/work.schema.json plus a
 * label for every provenance key.
 *
 * Zero imports, same reason as lib/policy.ts: Node can execute it directly for
 * verification. Unknown values fall through to the raw string so that a future
 * schema addition degrades to "shows the raw token" instead of crashing.
 */

export const MEDIA_TYPE_LABELS: Record<string, string> = {
  manga: '漫畫',
  light_novel: '輕小說',
  web_novel: '網路小說',
};

export const SERIALIZATION_STATUS_LABELS: Record<string, string> = {
  ongoing: '連載中',
  completed: '已完結',
  hiatus: '休載中',
  unknown: '未知',
};

export const YURI_TYPE_LABELS: Record<string, string> = {
  orthodox_yuri: '正統百合',
  light_yuri: '輕百合',
  s_class: 'S 級',
  gl: 'GL',
  micro_yuri: '微百合',
  uncertain: '未判定',
};

export const CLASSIFICATION_BASIS_LABELS: Record<string, string> = {
  official_tag: '官方標籤',
  editorial: '編輯判斷',
};

export const ANIME_STATUS_LABELS: Record<string, string> = {
  none: '無動畫',
  announced: '已公告',
  in_production: '製作中',
  airing: '放送中',
  finished: '已完結',
  movie: '劇場版',
};

export const PLATFORM_KIND_LABELS: Record<string, string> = {
  magazine: '雜誌',
  web_platform: '網路平台',
  web_novel_site: '網路小說站',
  label: '書系／レーベル',
  other: '其他',
};

export const OFFICIAL_ZH_CN_KIND_LABELS: Record<string, string> = {
  print: '實體書（有 ISBN）',
  digital: '數位授權（無 ISBN）',
  both: '實體＋數位',
  none: '無',
  unknown: '未知',
};

export const UNOFFICIAL_ZH_STATUS_LABELS: Record<string, string> = {
  unknown: '未標註',
  manually_flagged: '人工標記存在',
};

export const ANIME_FORMAT_LABELS: Record<string, string> = {
  tv: '電視',
  movie: '劇場版',
  ova: 'OVA',
  web: '網路放送',
};

/** field_sources.basis — the provenance vocabulary. */
export const BASIS_LABELS: Record<string, string> = {
  official: '官方',
  official_tag: '官方標籤',
  editorial: '編輯判斷',
  derived: '推導',
  third_party: '第三方資料庫',
};

/** sources.yaml confidence vocabulary. */
export const SOURCE_CONFIDENCE_LABELS: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

/** sources.yaml status_2026 vocabulary (free text in the file, so partial). */
export const STATUS_2026_LABELS: Record<string, string> = {
  active: '運作中',
  discontinued: '已終止',
  unknown: '未知',
};

export const METHOD_LABELS: Record<string, string> = {
  official_api: '官方 API',
  bulk_download: '批量下載',
  sitemap_crawl: 'Sitemap 爬取',
  html_crawl: 'HTML 爬取',
  rss: 'RSS',
  manual_curation: '人工整理',
  do_not_collect: '不採集',
};

export const CATEGORY_LABELS: Record<string, string> = {
  ja_bibliography: '日文書目／ISBN／書影',
  ja_serialization: '日文連載平台',
  zh_tw_edition: '繁中官方授權版',
  zh_cn_edition: '簡中官方授權版',
  web_novel: '網路小說',
  ln_label: '輕小說書系',
  retailer: '零售商',
  library: '圖書館',
  aggregator: '聚合站',
  isbn_registry: 'ISBN 註冊機構',
  anime_news: '動畫／新聞媒體',
};

export const REVIEW_TEXT_AVAILABLE_LABELS: Record<string, string> = {
  full_text: '有全文（本站不轉載）',
  excerpt_only: '僅節錄（本站不轉載）',
  aggregate_only: '僅聚合分數',
  none: '無評論內容',
};

export const COPYRIGHT_RISK_LABELS: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export const REGION_LABELS: Record<string, string> = {
  ja: '日文',
  zh_tw: '繁中',
  zh_cn: '簡中',
};

/**
 * 譯名狀態。刻意區分「已查證沒有官方版」與「還沒查」——這兩者在資料庫裡
 * 都是 title_zh_* = null，若 UI 不區分，讀者會把「沒查」誤讀成「沒有」。
 */
export const TITLE_STATUS_LABELS: Record<string, string> = {
  official: '官方譯名',
  none_known: '目前無官方版',
  unchecked: '尚未查證',
};

/**
 * Per-field labels are NOT defined here on purpose. The single authority for the
 * Work field inventory *and* its labels is lib/schema-fields.json, which
 * scripts/assert-data-contract.mjs checks against schemas/work.schema.json.
 * lib/provenance.ts exports `fieldLabel()` reading that file for both top-level
 * and nested field names.
 */

/** Looks a token up in a label map, falling back to the raw token. */
export function labelOf(map: Record<string, string>, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'unknown';
  return map[value] ?? value;
}

export const mediaTypeLabel = (v: string | null | undefined): string => labelOf(MEDIA_TYPE_LABELS, v);
export const serializationStatusLabel = (v: string | null | undefined): string => labelOf(SERIALIZATION_STATUS_LABELS, v);
export const yuriTypeLabel = (v: string | null | undefined): string => labelOf(YURI_TYPE_LABELS, v);
export const classificationBasisLabel = (v: string | null | undefined): string => labelOf(CLASSIFICATION_BASIS_LABELS, v);
export const animeStatusLabel = (v: string | null | undefined): string => labelOf(ANIME_STATUS_LABELS, v);
export const officialZhCnKindLabel = (v: string | null | undefined): string => labelOf(OFFICIAL_ZH_CN_KIND_LABELS, v);
export const basisLabel = (v: string | null | undefined): string => labelOf(BASIS_LABELS, v);
export const methodLabel = (v: string | null | undefined): string => labelOf(METHOD_LABELS, v);
export const categoryLabel = (v: string | null | undefined): string => labelOf(CATEGORY_LABELS, v);
export const regionLabel = (v: string | null | undefined): string => labelOf(REGION_LABELS, v);
export const titleStatusLabel = (v: string | null | undefined): string => labelOf(TITLE_STATUS_LABELS, v);
export const reviewTextAvailableLabel = (v: string | null | undefined): string =>
  labelOf(REVIEW_TEXT_AVAILABLE_LABELS, v);
export const copyrightRiskLabel = (v: string | null | undefined): string => labelOf(COPYRIGHT_RISK_LABELS, v);
export const sourceConfidenceLabel = (v: string | null | undefined): string => labelOf(SOURCE_CONFIDENCE_LABELS, v);
export const status2026Label = (v: string | null | undefined): string => labelOf(STATUS_2026_LABELS, v);
