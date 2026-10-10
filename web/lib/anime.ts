/**
 * 百合動畫 (yuri anime) catalogue — loader + provenance view models + aggregates.
 *
 * The browser-side half (enum domains, search, filters, URL query state, presets,
 * sort, display helper) lives in lib/anime-filters.ts, because the statically
 * exported /anime page filters IN THE BROWSER and a client component must not pull
 * this file's `node:fs` into its bundle. Everything from there is re-exported
 * below, so `@/lib/anime` stays the one public entry point for server components
 * and for scripts/verify-anime.mjs — and the filter semantics are defined exactly
 * once.
 *
 * Design constraints, copied deliberately from lib/data.ts + lib/policy.ts:
 *   - NO database. `data/anime.json` is read off disk at build time (the site is a
 *     static export: every page is pre-rendered, nothing runs on the host), and
 *     `data/anime_report.json` is read only for the data-quality cross-check.
 *   - NO React. Everything here is a pure function of the records (plus the two
 *     read-only file reads), so it is testable without a bundler.
 *
 * The module is written so that Node's native TypeScript type-stripping can
 * execute it directly (scripts/verify-anime.mjs does exactly that):
 *   - `import type` statements are used for every type-only import, which Node
 *     erases before module resolution;
 *   - the runtime relative imports are './anime-filters', './anime-labels' and
 *     './policy', all of which are themselves import-light, so the only adaptation
 *     the verify script needs is appending '.ts' to those specifiers (and staging
 *     the same adaptation for './anime-filters');
 *   - the single JSON import (./anime-fields.json) is substituted with the parsed
 *     file contents by the verify script, exactly as scripts/verify-provenance.mjs
 *     does for lib/provenance.ts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import animeFields from './anime-fields.json';
import { animeYearToken } from './anime-filters';
import {
  ADAPTATION_SOURCE_LABELS,
  ANIME_FORMAT_LABELS,
  ANIME_SEASON_LABELS,
  ANIME_STATUS_LABELS,
  BASIS_LABELS,
  labelOf,
} from './anime-labels';
import { UNKNOWN_TEXT, displayValue, formatDate, formatTimestamp, isBlank } from './policy';
import type {
  Anime,
  AnimeDatasetFile,
  AnimeFieldSource,
  AnimeLiveStats,
  AnimeReport,
} from './anime-types';
import type { FieldBasis, FieldView } from './types';

/* -------------------------------------------------------------------------- *
 * Re-exports: the pure catalogue logic (see lib/anime-filters.ts). Importing
 * `@/lib/anime` therefore keeps working for every server component, while the
 * browser components import the dependency-free module directly.
 * -------------------------------------------------------------------------- */

export {
  ADAPTATION_SOURCE_TOKENS,
  ANIME_FORMAT_TOKENS,
  ANIME_PRESET_BY_ID,
  ANIME_PRESETS,
  ANIME_SEASON_TOKENS,
  ANIME_SORTS,
  ANIME_STATUS_TOKENS,
  DEFAULT_ANIME_SORT,
  EMPTY_ANIME_FILTERS,
  LIGHT_NOVEL_FAMILY,
  adaptationOptions,
  animePresetHref,
  animeRuntimeSummary,
  animeYear,
  animeYearToken,
  buildAnimeQueryString,
  countActiveAnimeFilters,
  filterAndSortAnime,
  formatOptions,
  makeAnimeFilters,
  matchesAnimeFilters,
  matchesAnimeQuery,
  parseAnimeFilters,
  searchableAnimeText,
  sortAnime,
  statusOptions,
  studioOptions,
  yearOptions,
} from './anime-filters';
export type { AnimeFilters, AnimeLike, AnimePreset, AnimeSort, TokenOption } from './anime-filters';

/* ========================================================================== *
 * §1  Path resolution + loader
 * ========================================================================== */

const DATA_DIR = 'data';
const ANIME_FILE = 'anime.json';
const ANIME_REPORT_FILE = 'anime_report.json';

/**
 * Finds the repository root by walking up from the process cwd until a directory
 * contains `data/anime.json`.
 *
 * This is intentionally a *local* copy of lib/data.ts's resolver rather than an
 * import of it: lib/data.ts pulls in the `yaml` package and lib/provenance.ts's
 * JSON import, which would make this module un-runnable by Node's type-stripping
 * and therefore unverifiable by scripts/verify-anime.mjs. Keeping the anime
 * loader import-light is what buys the end-to-end verification.
 */
function resolveRepoRoot(): string {
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(current, DATA_DIR, ANIME_FILE))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(process.cwd(), '..');
}

let cachedRepoRoot: string | null = null;

export function getAnimeRepoRoot(): string {
  if (cachedRepoRoot === null) cachedRepoRoot = resolveRepoRoot();
  return cachedRepoRoot;
}

export function animeDataFilePath(fileName: string): string {
  return join(getAnimeRepoRoot(), DATA_DIR, fileName);
}

function readJsonFile<T>(absolutePath: string): T | null {
  try {
    if (!existsSync(absolutePath)) return null;
    return JSON.parse(readFileSync(absolutePath, 'utf8')) as T;
  } catch (error) {
    console.error(`[yuri-db] failed to read ${absolutePath}:`, error);
    return null;
  }
}

let cachedDataset: AnimeDatasetFile | null = null;

/** data/anime.json — throws only when the file is missing/corrupt (fatal for /anime). */
export function getAnimeDataset(): AnimeDatasetFile {
  if (cachedDataset === null) {
    const parsed = readJsonFile<AnimeDatasetFile>(animeDataFilePath(ANIME_FILE));
    if (!parsed || !Array.isArray(parsed.anime)) {
      throw new Error(
        `[yuri-db] ${animeDataFilePath(ANIME_FILE)} is missing or malformed. ` +
          'The web app reads the pipeline output directly; run the Phase 3 export first.',
      );
    }
    cachedDataset = parsed;
  }
  return cachedDataset;
}

export function getAnime(): Anime[] {
  return getAnimeDataset().anime;
}

export function getAnimeGeneratedAt(): string {
  return getAnimeDataset().generated_at;
}

/** Route params for app/anime/[slug]/page.tsx (pre-renders one page per entry). */
export function getAnimeSlugs(): string[] {
  return getAnime().map((entry) => entry.slug);
}

export function getAnimeBySlug(slug: string): Anime | undefined {
  return getAnime().find((entry) => entry.slug === slug);
}

/** related_work_id → slug, so a Work linkage can be resolved either way. */
export function getAnimeIdToSlugMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of getAnime()) {
    map.set(entry.id, entry.slug);
    map.set(entry.slug, entry.slug);
  }
  return map;
}

let cachedReport: AnimeReport | null = null;
let reportLoaded = false;

/** data/anime_report.json — optional; the data-quality page degrades gracefully. */
export function getAnimeReport(): AnimeReport | null {
  if (!reportLoaded) {
    const parsed = readJsonFile<AnimeReport>(animeDataFilePath(ANIME_REPORT_FILE));
    cachedReport = parsed && typeof parsed === 'object' ? parsed : null;
    reportLoaded = true;
  }
  return cachedReport;
}

/* ========================================================================== *
 * §6  Field inventory (lib/anime-fields.json) + provenance view models
 * ========================================================================== */

export interface AnimeFieldDescriptor {
  name: string;
  label: string;
  kind: string;
  group?: string;
}

interface AnimeFieldsFile {
  groups: { id: string; label: string }[];
  animeFields: AnimeFieldDescriptor[];
  nested: Record<string, AnimeFieldDescriptor[]>;
}

const FIELDS = animeFields as unknown as AnimeFieldsFile;

export const ANIME_FIELD_GROUPS = FIELDS.groups;
export const ANIME_FIELD_DESCRIPTORS: AnimeFieldDescriptor[] = FIELDS.animeFields;
export const ANIME_NESTED_FIELD_DESCRIPTORS: Record<string, AnimeFieldDescriptor[]> = FIELDS.nested;
export const ANIME_FIELD_NAMES: string[] = ANIME_FIELD_DESCRIPTORS.map((descriptor) => descriptor.name);

/** Label for any anime field name — top-level or nested. Falls back to the raw name. */
export function animeFieldLabel(name: string): string {
  const top = ANIME_FIELD_DESCRIPTORS.find((field) => field.name === name);
  if (top) return top.label;
  for (const list of Object.values(ANIME_NESTED_FIELD_DESCRIPTORS)) {
    const hit = list.find((field) => field.name === name);
    if (hit) return hit.label;
  }
  return name;
}

/** Per-field enum label maps, so an enum renders as Chinese + keeps its token. */
const ANIME_ENUM_LABELS: Record<string, Record<string, string>> = {
  format: ANIME_FORMAT_LABELS,
  adaptation_source: ADAPTATION_SOURCE_LABELS,
  status: ANIME_STATUS_LABELS,
  season: ANIME_SEASON_LABELS,
  basis: BASIS_LABELS,
};

function formatEnum(fieldName: string, raw: unknown): string {
  if (isBlank(raw)) return UNKNOWN_TEXT;
  const map = ANIME_ENUM_LABELS[fieldName];
  const token = String(raw);
  return map ? labelOf(map, token) : token;
}

function formatByKind(kind: string, raw: unknown): { value: string; token: string | null } {
  if (isBlank(raw)) return { value: UNKNOWN_TEXT, token: null };
  switch (kind) {
    case 'boolean':
      return { value: raw === true ? '是' : raw === false ? '否' : UNKNOWN_TEXT, token: null };
    case 'number':
      return { value: String(raw), token: null };
    case 'date':
      return { value: formatDate(typeof raw === 'string' ? raw : String(raw)), token: null };
    case 'timestamp':
      return { value: formatTimestamp(typeof raw === 'string' ? raw : String(raw)), token: null };
    case 'stringArray':
      return {
        value: Array.isArray(raw) ? raw.map((item) => String(item)).join('、') : displayValue(raw),
        token: null,
      };
    case 'url':
      return { value: typeof raw === 'string' ? raw : String(raw), token: null };
    case 'object': {
      const keys = raw && typeof raw === 'object' ? Object.keys(raw as object).length : 0;
      return { value: `（物件，${keys} 個欄位；詳見下方章節）`, token: null };
    }
    case 'objectArray': {
      const count = Array.isArray(raw) ? raw.length : 0;
      return { value: `（${count} 筆；詳見下方章節）`, token: null };
    }
    case 'confidenceMap': {
      const keys = raw && typeof raw === 'object' ? Object.keys(raw as object).length : 0;
      return { value: `（${keys} 個鍵有把握度值；詳見下方章節）`, token: null };
    }
    default:
      return { value: displayValue(raw), token: typeof raw === 'string' ? raw : null };
  }
}

function resolveAnimeSource(entry: Anime, fieldName: string): AnimeFieldSource | null {
  return entry.field_sources?.[fieldName] ?? null;
}

function buildAnimeView(entry: Anime, descriptor: AnimeFieldDescriptor): FieldView {
  const record = entry as unknown as Record<string, unknown>;
  const raw = record[descriptor.name];
  const isUnknown = isBlank(raw);
  const source = resolveAnimeSource(entry, descriptor.name);
  const confidence =
    typeof entry.field_confidence?.[descriptor.name] === 'number'
      ? entry.field_confidence[descriptor.name]
      : (source?.confidence ?? null);

  let value: string;
  let token: string | null = null;
  if (descriptor.kind === 'enum') {
    value = formatEnum(descriptor.name, raw);
    token = isUnknown ? null : String(raw);
  } else {
    const formatted = formatByKind(descriptor.kind, raw);
    value = formatted.value;
    token = formatted.token;
  }

  const basis = (source?.basis ?? null) as FieldBasis | null;
  const editorial = basis === 'editorial';

  return {
    field: descriptor.name,
    label: descriptor.label,
    value,
    isUnknown,
    raw,
    token,
    source: source as FieldView['source'],
    confidence,
    basis,
    editorial,
    // Same guarantee as lib/provenance.ts for Work: an editorial judgement can
    // never acquire a source link, whatever the record happens to carry.
    linkableSourceUrl: editorial ? null : (source?.source_url || null),
    state: isUnknown ? 'unknown' : source ? 'sourced' : 'unsourced',
  };
}

/** One FieldView per key of schemas/anime.schema.json → properties, in inventory order. */
export function buildAnimeFieldViews(entry: Anime): FieldView[] {
  return ANIME_FIELD_DESCRIPTORS.map((descriptor) => buildAnimeView(entry, descriptor));
}

export function animeFieldViewsByGroup(entry: Anime): { id: string; label: string; fields: FieldView[] }[] {
  const views = buildAnimeFieldViews(entry);
  return ANIME_FIELD_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    fields: views.filter((view) => ANIME_FIELD_DESCRIPTORS.find((d) => d.name === view.field)?.group === group.id),
  })).filter((group) => group.fields.length > 0);
}

/** Rows for a nested object (main_cast, sources, field_sources). */
export interface AnimeNestedRow {
  name: string;
  label: string;
  value: string;
  isUnknown: boolean;
  /** Present only for kind === "url". */
  href: string | null;
  enumText: string | null;
}

export function animeNestedRows(
  nestedName: string,
  object: Record<string, unknown> | null | undefined,
): AnimeNestedRow[] {
  const descriptors = ANIME_NESTED_FIELD_DESCRIPTORS[nestedName] ?? [];
  return descriptors.map((descriptor) => {
    const raw = object ? object[descriptor.name] : undefined;
    const isUnknown = isBlank(raw);
    const formatted = formatByKind(descriptor.kind, raw);
    const enumText = descriptor.kind === 'enum' ? formatEnum(descriptor.name, raw) : null;
    return {
      name: descriptor.name,
      label: descriptor.label,
      value: enumText ?? formatted.value,
      isUnknown,
      href: descriptor.kind === 'url' && !isUnknown ? String(raw) : null,
      enumText,
    };
  });
}

export interface AnimeProvenanceSummary {
  total: number;
  unknown: number;
  sourced: number;
  unsourced: number;
  editorial: number;
  official: number;
  officialTag: number;
  derived: number;
  thirdParty: number;
  withConfidence: number;
  averageConfidence: number | null;
}

export function summarizeAnimeProvenance(views: FieldView[]): AnimeProvenanceSummary {
  const confidences = views.map((view) => view.confidence).filter((c): c is number => typeof c === 'number');
  const count = (basis: FieldBasis) => views.filter((view) => view.basis === basis).length;
  return {
    total: views.length,
    unknown: views.filter((view) => view.state === 'unknown').length,
    sourced: views.filter((view) => view.state === 'sourced').length,
    unsourced: views.filter((view) => view.state === 'unsourced').length,
    editorial: count('editorial'),
    official: count('official'),
    officialTag: count('official_tag'),
    derived: count('derived'),
    thirdParty: count('third_party'),
    withConfidence: confidences.length,
    averageConfidence:
      confidences.length === 0 ? null : confidences.reduce((a, b) => a + b, 0) / confidences.length,
  };
}

/**
 * field_confidence keys that are NOT schema field names.
 *
 * The current export uses `studio` / `broadcast` / `cast`, which are pipeline
 * aliases, not fields of schemas/anime.schema.json. Mapping them onto
 * studios / start_date / main_cast would be an invention, so the detail page
 * lists them verbatim and says exactly that.
 */
export function animeConfidenceExtras(entry: Anime): { key: string; value: number }[] {
  return Object.entries(entry.field_confidence ?? {})
    .filter(([key]) => !ANIME_FIELD_NAMES.includes(key))
    .map(([key, value]) => ({ key, value }));
}

/** field_sources keys with no matching schema field (future-proofing). */
export function animeSourceExtras(entry: Anime): { key: string; source: AnimeFieldSource }[] {
  return Object.entries(entry.field_sources ?? {})
    .filter(([key]) => !ANIME_FIELD_NAMES.includes(key))
    .map(([key, source]) => ({ key, source }));
}

/* ========================================================================== *
 * §7  Live aggregates (shown next to the pipeline's anime_report.json)
 * ========================================================================== */

/**
 * Per-field completeness + provenance coverage, computed the same way
 * lib/data.ts does it for Work: "has a value" means non-null / non-empty /
 * non-empty array, and "has provenance" means the field_sources map carries the
 * field name (even when the value itself is null — a source can document a gap).
 */
export interface AnimeFieldCoverage {
  field: string;
  label: string;
  withValue: number;
  withProvenance: number;
  completeness: number;
  provenanceRatio: number;
}

export function animeFieldCoverage(entries: readonly Anime[]): AnimeFieldCoverage[] {
  const total = entries.length;
  return ANIME_FIELD_DESCRIPTORS.map((descriptor) => {
    let withValue = 0;
    let withProvenance = 0;
    for (const entry of entries) {
      const raw = (entry as unknown as Record<string, unknown>)[descriptor.name];
      if (!isBlank(raw)) withValue += 1;
      if ((entry.field_sources ?? {})[descriptor.name] !== undefined) withProvenance += 1;
    }
    return {
      field: descriptor.name,
      label: descriptor.label,
      withValue,
      withProvenance,
      completeness: total === 0 ? 0 : withValue / total,
      provenanceRatio: total === 0 ? 0 : withProvenance / total,
    };
  });
}

function tallyBy<T>(entries: readonly T[], key: (entry: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of entries) {
    const token = key(entry);
    out[token] = (out[token] ?? 0) + 1;
  }
  return out;
}

let cachedLiveStats: AnimeLiveStats | null = null;

export function getAnimeLiveStats(): AnimeLiveStats {
  if (cachedLiveStats) return cachedLiveStats;
  const anime = getAnime();
  const studios = new Set<string>();
  const voiceActors = new Set<string>();
  const byBasis: Record<string, number> = {};
  let castEntries = 0;
  let castEntriesWithoutVoiceActor = 0;
  let totalFieldSources = 0;
  let fullyThirdParty = 0;

  for (const entry of anime) {
    for (const studio of entry.studios ?? []) studios.add(studio);
    for (const member of entry.main_cast ?? []) {
      castEntries += 1;
      if (member.voice_actor) voiceActors.add(member.voice_actor);
      else castEntriesWithoutVoiceActor += 1;
    }
    const sources = Object.values(entry.field_sources ?? {});
    totalFieldSources += sources.length;
    for (const source of sources) byBasis[source.basis] = (byBasis[source.basis] ?? 0) + 1;
    if (sources.length > 0 && sources.every((source) => source.basis === 'third_party')) fullyThirdParty += 1;
  }

  cachedLiveStats = {
    total: anime.length,
    byFormat: tallyBy(anime, (entry) => entry.format),
    byAdaptationSource: tallyBy(anime, (entry) => entry.adaptation_source),
    byStatus: tallyBy(anime, (entry) => entry.status),
    bySeason: tallyBy(anime, (entry) => entry.season ?? 'unknown'),
    byYear: tallyBy(anime, (entry) => animeYearToken(entry)),
    withStudio: anime.filter((entry) => (entry.studios ?? []).length > 0).length,
    withCast: anime.filter((entry) => (entry.main_cast ?? []).length > 0).length,
    withStartDate: anime.filter((entry) => !isBlank(entry.start_date)).length,
    withEndDate: anime.filter((entry) => !isBlank(entry.end_date)).length,
    withCover: anime.filter((entry) => !isBlank(entry.cover_url)).length,
    announcedNotAired: anime.filter((entry) => entry.status === 'announced').length,
    movies: anime.filter((entry) => entry.format === 'movie').length,
    linkedWorks: anime.filter((entry) => !isBlank(entry.related_work_id) || !isBlank(entry.related_work_slug)).length,
    distinctStudios: studios.size,
    distinctVoiceActors: voiceActors.size,
    castEntries,
    castEntriesWithoutVoiceActor,
    totalSources: anime.reduce((n, entry) => n + (entry.sources?.length ?? 0), 0),
    totalFieldSources,
    schemaFieldCount: ANIME_FIELD_DESCRIPTORS.length,
    byBasis,
    fullyThirdParty,
  };
  return cachedLiveStats;
}

