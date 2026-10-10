/**
 * Server-side data access.
 *
 * Default runtime path: read the pipeline's own export files straight off disk.
 * No database, no ORM, no network — the site renders from:
 *
 *   ../data/works.json          (36 works)
 *   ../data/dataset_report.json (completeness stats)
 *   ../data/change_log.json     (optional; written by the daily pipeline)
 *   ../sources.yaml             (75 sources + 19 review sources)
 *
 * `lib/prisma.ts` exists for a future Postgres path but is never imported here,
 * so the app boots with zero infrastructure.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { WORK_FIELD_DESCRIPTORS } from './provenance';
import type {
  ChangeLog,
  DatasetFile,
  DatasetReport,
  RegisteredSource,
  SourcesFile,
  Work,
} from './types';

/* -------------------------------------------------------------------------- *
 * Path resolution
 * -------------------------------------------------------------------------- */

const DATA_DIR = 'data';
const WORKS_FILE = 'works.json';

/**
 * Finds the repository root by walking up from the process cwd until a directory
 * contains both `sources.yaml` and `data/works.json`.
 *
 * Works for `next dev` / `next build` (cwd = web/) and for a production server
 * started from either web/ or the repo root.
 */
function resolveRepoRoot(): string {
  const candidates: string[] = [];
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    candidates.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'sources.yaml')) && existsSync(join(candidate, DATA_DIR, WORKS_FILE))) {
      return candidate;
    }
  }
  // Fall back to "the parent of web/", which is correct for the standard layout.
  return resolve(process.cwd(), '..');
}

let cachedRepoRoot: string | null = null;

export function getRepoRoot(): string {
  if (cachedRepoRoot === null) cachedRepoRoot = resolveRepoRoot();
  return cachedRepoRoot;
}

export function dataFilePath(fileName: string): string {
  return join(getRepoRoot(), DATA_DIR, fileName);
}

/* -------------------------------------------------------------------------- *
 * JSON helpers
 * -------------------------------------------------------------------------- */

function readJsonFile<T>(absolutePath: string): T | null {
  try {
    if (!existsSync(absolutePath)) return null;
    return JSON.parse(readFileSync(absolutePath, 'utf8')) as T;
  } catch (error) {
    console.error(`[yuri-db] failed to read ${absolutePath}:`, error);
    return null;
  }
}

let cachedDataset: DatasetFile | null = null;

/** data/works.json — throws only if the dataset is missing/corrupt (fatal for the site). */
export function getDataset(): DatasetFile {
  if (cachedDataset === null) {
    const parsed = readJsonFile<DatasetFile>(dataFilePath(WORKS_FILE));
    if (!parsed || !Array.isArray(parsed.works)) {
      throw new Error(
        `[yuri-db] ${dataFilePath(WORKS_FILE)} is missing or malformed. ` +
          'The web app reads the pipeline output directly; run the Phase 3 export first.',
      );
    }
    cachedDataset = parsed;
  }
  return cachedDataset;
}

export function getWorks(): Work[] {
  return getDataset().works;
}

export function getDatasetGeneratedAt(): string {
  return getDataset().generated_at;
}

/** Route params for app/works/[slug]/page.tsx. */
export function getWorkSlugs(): string[] {
  return getWorks().map((work) => work.slug);
}

export function getWorkBySlug(slug: string): Work | undefined {
  return getWorks().find((work) => work.slug === slug);
}

/** work_id → slug, so change_log entries can link to the current URL. */
export function getWorkIdToSlugMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const work of getWorks()) {
    map.set(work.id, work.slug);
    // The pipeline sometimes records the slug itself as the entity id.
    map.set(work.slug, work.slug);
  }
  return map;
}

/* -------------------------------------------------------------------------- *
 * dataset_report.json
 * -------------------------------------------------------------------------- */

let cachedReport: DatasetReport | null = null;
let reportLoaded = false;

export function getDatasetReport(): DatasetReport | null {
  if (!reportLoaded) {
    cachedReport = readJsonFile<DatasetReport>(dataFilePath('dataset_report.json'));
    reportLoaded = true;
  }
  return cachedReport;
}

/* -------------------------------------------------------------------------- *
 * change_log.json (optional by design)
 * -------------------------------------------------------------------------- */

export interface ChangeLogResult {
  log: ChangeLog | null;
  /** Non-null when a file exists but could not be used. */
  error: string | null;
  path: string;
}

let cachedChangeLog: ChangeLogResult | null = null;

export function getChangeLog(): ChangeLogResult {
  if (cachedChangeLog === null) {
    const path = dataFilePath('change_log.json');
    if (!existsSync(path)) {
      cachedChangeLog = { log: null, error: null, path };
    } else {
      const parsed = readJsonFile<ChangeLog>(path);
      if (!parsed || !Array.isArray(parsed.entries)) {
        cachedChangeLog = { log: null, error: 'change_log.json 存在但格式無法解析。', path };
      } else {
        cachedChangeLog = { log: parsed, error: null, path };
      }
    }
  }
  return cachedChangeLog;
}

export function getChangeLogMtime(): string | null {
  try {
    const path = dataFilePath('change_log.json');
    if (!existsSync(path)) return null;
    return statSync(path).mtime.toISOString();
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- *
 * sources.yaml
 * -------------------------------------------------------------------------- */

export interface SourcesResult {
  data: SourcesFile | null;
  error: string | null;
  path: string;
}

let cachedSources: SourcesResult | null = null;

/**
 * Parses sources.yaml with the `yaml` package. The UI treats a parse failure as a
 * renderable error state rather than a crash: the Works pages do not depend on
 * this file, so only the Sources page is affected.
 */
export function getSourcesFile(): SourcesResult {
  if (cachedSources === null) {
    const path = join(getRepoRoot(), 'sources.yaml');
    if (!existsSync(path)) {
      cachedSources = { data: null, error: 'sources.yaml 不存在。', path };
    } else {
      try {
        const parsed = parseYaml(readFileSync(path, 'utf8')) as SourcesFile | null;
        if (!parsed || typeof parsed !== 'object') {
          cachedSources = { data: null, error: 'sources.yaml 解析結果不是物件。', path };
        } else {
          const data: SourcesFile = {
            ...parsed,
            meta: (parsed.meta ?? {}) as Record<string, unknown>,
            sources: Array.isArray(parsed.sources) ? parsed.sources : [],
            review_sources: Array.isArray(parsed.review_sources) ? parsed.review_sources : [],
          };
          cachedSources = { data, error: null, path };
        }
      } catch (error) {
        console.error('[yuri-db] failed to parse sources.yaml:', error);
        cachedSources = {
          data: null,
          error: error instanceof Error ? error.message : String(error),
          path,
        };
      }
    }
  }
  return cachedSources;
}

export function getRegisteredSources(): RegisteredSource[] {
  return getSourcesFile().data?.sources ?? [];
}

export function getReviewSources(): RegisteredSource[] {
  return getSourcesFile().data?.review_sources ?? [];
}

/** Every registered source (both sections), keyed by its stable id. */
export function getSourceIndex(): Map<string, RegisteredSource> {
  const map = new Map<string, RegisteredSource>();
  for (const source of [...getRegisteredSources(), ...getReviewSources()]) {
    if (source?.id) map.set(source.id, source);
  }
  return map;
}

/** Groups a source list by `category`, preserving a stable alphabetical order. */
export function groupSourcesByCategory(sources: RegisteredSource[]): { category: string; items: RegisteredSource[] }[] {
  const buckets = new Map<string, RegisteredSource[]>();
  for (const source of sources) {
    const key = typeof source.category === 'string' && source.category ? source.category : 'uncategorised';
    const list = buckets.get(key);
    if (list) list.push(source);
    else buckets.set(key, [source]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, items]) => ({ category, items }));
}

/* -------------------------------------------------------------------------- *
 * Live aggregates computed from works.json (shown next to the pipeline report)
 * -------------------------------------------------------------------------- */

export interface LiveStats {
  workCount: number;
  byMediaType: Record<string, number>;
  bySerializationStatus: Record<string, number>;
  byYuriType: Record<string, number>;
  byAnimeStatus: Record<string, number>;
  byClassificationBasis: Record<string, number>;
  byMagazine: Record<string, number>;
  /** field name → how many works have a non-empty value (same measure as the report). */
  fieldCompleteness: Record<string, number>;
  /** field name → how many works have a field_sources entry. */
  fieldsWithProvenance: Record<string, number>;
  totalWorkSources: number;
  totalRatings: number;
  totalReviewMeta: number;
  worksWithZhTwEdition: number;
  worksWithZhCnEdition: number;
  worksWithRatings: number;
  worksWithReviewMeta: number;
  worksWithAnimeDetails: number;
  totalRegisteredSources: number;
  totalReviewSources: number;
}

function tally(values: (string | null | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) {
    const key = value === null || value === undefined || value === '' ? 'unknown' : String(value);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function populated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

let cachedLiveStats: LiveStats | null = null;

export function getLiveStats(): LiveStats {
  if (cachedLiveStats) return cachedLiveStats;
  const works = getWorks();
  const total = works.length;

  const fieldCompleteness: Record<string, number> = {};
  const fieldsWithProvenance: Record<string, number> = {};
  for (const descriptor of WORK_FIELD_DESCRIPTORS) {
    const withValue = works.filter((w) => populated((w as unknown as Record<string, unknown>)[descriptor.name])).length;
    fieldCompleteness[descriptor.name] = total === 0 ? 0 : withValue / total;
    fieldsWithProvenance[descriptor.name] = works.filter(
      (w) => (w.field_sources ?? {})[descriptor.name] !== undefined,
    ).length;
  }

  cachedLiveStats = {
    workCount: total,
    byMediaType: tally(works.map((w) => w.media_type)),
    bySerializationStatus: tally(works.map((w) => w.serialization_status)),
    byYuriType: tally(works.map((w) => w.yuri_type)),
    byAnimeStatus: tally(works.map((w) => w.anime_status)),
    byClassificationBasis: tally(works.map((w) => w.classification_basis)),
    byMagazine: tally(works.map((w) => w.magazine_or_platform)),
    fieldCompleteness,
    fieldsWithProvenance,
    totalWorkSources: works.reduce((n, w) => n + (w.sources?.length ?? 0), 0),
    totalRatings: works.reduce((n, w) => n + (w.ratings?.length ?? 0), 0),
    totalReviewMeta: works.reduce((n, w) => n + (w.review_meta?.length ?? 0), 0),
    worksWithZhTwEdition: works.filter((w) => populated(w.title_zh_tw) || populated(w.zh_tw_volumes) || populated(w.publisher_zh_tw)).length,
    worksWithZhCnEdition: works.filter(
      (w) => populated(w.title_zh_cn) || populated(w.zh_cn_volumes) || populated(w.publisher_zh_cn) || w.official_zh_cn?.exists === true,
    ).length,
    worksWithRatings: works.filter((w) => (w.ratings?.length ?? 0) > 0).length,
    worksWithReviewMeta: works.filter((w) => (w.review_meta?.length ?? 0) > 0).length,
    worksWithAnimeDetails: works.filter((w) => w.anime_details !== null).length,
    totalRegisteredSources: getRegisteredSources().length,
    totalReviewSources: getReviewSources().length,
  };
  return cachedLiveStats;
}
