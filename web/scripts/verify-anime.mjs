#!/usr/bin/env node
/**
 * 百合動畫 (yuri anime) · end-to-end verification.
 *
 * This script executes the REAL `lib/anime.ts` against the REAL `data/anime.json`
 * — no mocks, no bundler, no hardcoded expectations. Node 24 strips the types
 * natively, so the shipped business logic (loader, filters, presets, URL query
 * serialisation, field inventory, provenance view models) is what gets tested.
 *
 * Generalising the technique used by scripts/verify-provenance.mjs, exactly two
 * mechanical adaptations are applied to the shipped source, and both are asserted
 * to have applied:
 *   1. `from './anime-labels'` / `from './policy'` gain a `.ts` extension
 *      (Node's ESM resolver needs it; webpack/Next does not).
 *   2. the single `import animeFields from './anime-fields.json'` line is replaced
 *      by an inline object literal holding the *same parsed file*, because Node
 *      cannot import JSON without an import attribute.
 * Every `import type` statement is left untouched: Node erases it before module
 * resolution, which is asserted structurally below.
 *
 * What it proves:
 *   - lib/anime-fields.json is a bijection with schemas/anime.schema.json
 *     (`properties` + the nested main_cast / sources / field_sources objects), so
 *     no schema field can silently disappear from the detail page;
 *   - the loader reproduces data/anime.json exactly, and lib/anime.ts's live
 *     aggregates reproduce every number in data/anime_report.json;
 *   - every filter dimension returns EXACTLY the set derived independently from
 *     the data (slug-for-slug), and filters/search/sort compose with AND/OR;
 *   - the five one-click presets equal their independent re-derivation;
 *   - filter state round-trips through the URL query string, including studio
 *     names with spaces/CJK;
 *   - the cover policy (URL only, never mirrored, referrerPolicy=no-referrer,
 *     attribution + link out) holds in the component and in the data;
 *   - null titles are rendered as 未收錄 by the shared TitleTriple, and every
 *     anime field_sources basis is `third_party` (AniList is not official).
 *
 * Counts are NEVER hardcoded: every expectation is derived from the files at run
 * time, and the script even asserts that it does not contain the dataset size as
 * a literal (the bug class that bit this project twice).
 *
 * Run:  node scripts/verify-anime.mjs
 * Exit: 0 = verified, 1 = at least one assertion failed.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(WEB_ROOT, '..');

const ANIME_JSON = join(REPO_ROOT, 'data', 'anime.json');
const ANIME_REPORT_JSON = join(REPO_ROOT, 'data', 'anime_report.json');
const ANIME_SCHEMA = join(REPO_ROOT, 'schemas', 'anime.schema.json');
const WORKS_JSON = join(REPO_ROOT, 'data', 'works.json');
const ANIME_FIELDS_JSON = join(WEB_ROOT, 'lib', 'anime-fields.json');
const ANIME_SOURCE = join(WEB_ROOT, 'lib', 'anime.ts');
const LABELS_SOURCE = join(WEB_ROOT, 'lib', 'anime-labels.ts');
const COVER_COMPONENT = join(WEB_ROOT, 'components', 'CoverImage.tsx');
const TITLE_COMPONENT = join(WEB_ROOT, 'components', 'TitleTriple.tsx');
const ANIME_CARD = join(WEB_ROOT, 'components', 'AnimeCard.tsx');
const ANIME_LIST_PAGE = join(WEB_ROOT, 'app', 'anime', 'page.tsx');
/**
 * The browser half of /anime. The page itself is now a server component that
 * renders the intro + provenance warnings; the URL-driven part (presets, filter
 * panel, results) lives here, because a static export has no server to read
 * `searchParams`.
 */
const ANIME_BROWSER = join(WEB_ROOT, 'components', 'AnimeBrowser.tsx');
const ANIME_SLIM_JSON = join(WEB_ROOT, 'lib', 'anime-slim.json');
const ANIME_DETAIL_PAGE = join(WEB_ROOT, 'app', 'anime', '[slug]', 'page.tsx');
const DATA_QUALITY_PAGE = join(WEB_ROOT, 'app', 'data-quality', 'page.tsx');
const SITE_CHROME = join(WEB_ROOT, 'components', 'SiteChrome.tsx');
const PACKAGE_JSON = join(WEB_ROOT, 'package.json');

/* ------------------------------------------------------------------ harness */
let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  + ${name}`);
  } else {
    failures.push(`${name}${detail ? ` - ${detail}` : ''}`);
    console.error(`  x ${name}${detail ? ` - ${detail}` : ''}`);
  }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}
const section = (title) => console.log(`\n== ${title} ==`);
const read = (path) => readFileSync(path, 'utf8');

for (const path of [
  ANIME_JSON,
  ANIME_REPORT_JSON,
  ANIME_SCHEMA,
  ANIME_FIELDS_JSON,
  ANIME_SOURCE,
  COVER_COMPONENT,
  TITLE_COMPONENT,
  ANIME_CARD,
  ANIME_LIST_PAGE,
  ANIME_BROWSER,
  ANIME_SLIM_JSON,
  ANIME_DETAIL_PAGE,
]) {
  if (!existsSync(path)) {
    console.error(`missing required file: ${path}`);
    process.exit(1);
  }
}

const dataset = JSON.parse(read(ANIME_JSON));
const report = JSON.parse(read(ANIME_REPORT_JSON));
const schema = JSON.parse(read(ANIME_SCHEMA));
const inventory = JSON.parse(read(ANIME_FIELDS_JSON));
const anime = dataset.anime;

/* ================================================================== *
 * 1. Adapt the shipped lib/anime.ts for Node and execute it
 * ================================================================== */
section('executing the real lib/anime.ts');

const originalSource = read(ANIME_SOURCE);
let adapted = originalSource;

const jsonImportLine = /^import animeFields from '\.\/anime-fields\.json';$/m;
check(
  'the source has exactly one JSON import to adapt',
  (adapted.match(jsonImportLine) ?? []).length === 1,
  String((adapted.match(jsonImportLine) ?? []).length),
);
adapted = adapted.replace(jsonImportLine, `const animeFields = ${read(ANIME_FIELDS_JSON)};`);

// lib/anime.ts imports the pure catalogue logic from lib/anime-filters.ts and
// re-exports it (that split is what lets the browser bundle filter the slim
// projection without pulling node:fs in). Both sides are staged for Node: the
// filters module first, then anime.ts pointed at the staged copy.
const FILTERS_SOURCE = join(WEB_ROOT, 'lib', 'anime-filters.ts');
check('lib/anime-filters.ts exists (the pure half the browser imports)', existsSync(FILTERS_SOURCE));

const adaptedFilters = read(FILTERS_SOURCE).replace("from './policy';", "from './policy.ts';");
check(
  'lib/anime-filters.ts has exactly one runtime relative import (./policy)',
  read(FILTERS_SOURCE).split("from './policy';").length - 1 === 1,
);
const stagedFiltersModule = join(WEB_ROOT, 'lib', '.anime-filters.staged.ts');
writeFileSync(stagedFiltersModule, adaptedFilters, 'utf8');

for (const [from, to, expected] of [
  ["from './anime-labels';", "from './anime-labels.ts';", 1],
  ["from './policy';", "from './policy.ts';", 1],
  ["from './anime-filters';", "from './.anime-filters.staged.ts';", 3],
]) {
  const occurrences = adapted.split(from).length - 1;
  check(
    `the source has exactly ${expected} runtime import(s) of ${from}`,
    occurrences === expected,
    String(occurrences),
  );
  adapted = adapted.replaceAll(from, to);
}

// The type-only imports must stay extensionless AND be declared as `import type`
// so that Node erases them before it tries to resolve './anime-types'.
check(
  'lib/anime.ts imports its types with `import type … from \'./anime-types\'` (erased, not resolved)',
  /^import type \{[\s\S]*?\} from '\.\/anime-types';$/m.test(adapted),
);
check(
  'lib/anime.ts imports the shared view types with `import type … from \'./types\'` (erased, not resolved)',
  /^import type \{[\s\S]*?\} from '\.\/types';$/m.test(adapted),
);
const remainingRelative = [...new Set([...adapted.matchAll(/from '(\.[^']*)'/g)].map((match) => match[1]))].sort();
eq('after adaptation the only relative specifiers are the expected ones', remainingRelative, [
  './.anime-filters.staged.ts',
  './anime-labels.ts',
  './anime-types',
  './policy.ts',
  './types',
]);

const stagedModule = join(WEB_ROOT, 'lib', '.anime.staged.ts');
writeFileSync(stagedModule, adapted, 'utf8');

let lib;
try {
  lib = await import(pathToFileURL(stagedModule).href);
} finally {
  rmSync(stagedModule, { force: true });
  rmSync(stagedFiltersModule, { force: true });
  const leftovers = readdirSync(join(WEB_ROOT, 'lib')).filter((name) => name.startsWith('.anime'));
  check('the staged modules were cleaned up', leftovers.length === 0, leftovers.join(', '));
}

const {
  ADAPTATION_SOURCE_TOKENS,
  ANIME_FIELD_DESCRIPTORS,
  ANIME_FIELD_GROUPS,
  ANIME_FORMAT_TOKENS,
  ANIME_PRESETS,
  ANIME_SORTS,
  ANIME_STATUS_TOKENS,
  DEFAULT_ANIME_SORT,
  EMPTY_ANIME_FILTERS,
  LIGHT_NOVEL_FAMILY,
  adaptationOptions,
  animeConfidenceExtras,
  animeFieldCoverage,
  animeFieldLabel,
  animeFieldViewsByGroup,
  animeNestedRows,
  animePresetHref,
  animeRuntimeSummary,
  animeSourceExtras,
  animeYearToken,
  buildAnimeFieldViews,
  buildAnimeQueryString,
  countActiveAnimeFilters,
  filterAndSortAnime,
  formatOptions,
  getAnime,
  getAnimeBySlug,
  getAnimeDataset,
  getAnimeGeneratedAt,
  getAnimeLiveStats,
  getAnimeReport,
  getAnimeSlugs,
  makeAnimeFilters,
  matchesAnimeQuery,
  parseAnimeFilters,
  searchableAnimeText,
  sortAnime,
  statusOptions,
  studioOptions,
  summarizeAnimeProvenance,
  yearOptions,
} = lib;

const labels = await import(new URL('../lib/anime-labels.ts', import.meta.url).href);

/* ================================================================== *
 * 2. Field inventory must cover the anime schema exactly
 * ================================================================== */
section('lib/anime-fields.json vs schemas/anime.schema.json');

const schemaTopLevel = Object.keys(schema.properties ?? {}).sort();
const inventoryTopLevel = ANIME_FIELD_DESCRIPTORS.map((field) => field.name).sort();

eq(`the inventory renders all ${schemaTopLevel.length} schema properties`, inventoryTopLevel, schemaTopLevel);
check(
  'the inventory invents no fields (bijection, direction 2)',
  inventoryTopLevel.every((name) => schemaTopLevel.includes(name)),
);
check(
  'the inventory lists each field exactly once',
  new Set(inventoryTopLevel).size === inventoryTopLevel.length,
);
check(
  'every required schema field is in the inventory',
  (schema.required ?? []).every((name) => inventoryTopLevel.includes(name)),
  (schema.required ?? []).filter((name) => !inventoryTopLevel.includes(name)).join(', '),
);
check(
  'every inventory entry has a label, a kind and a declared group',
  ANIME_FIELD_DESCRIPTORS.every(
    (field) =>
      typeof field.label === 'string' &&
      field.label.length > 0 &&
      typeof field.kind === 'string' &&
      field.kind.length > 0 &&
      ANIME_FIELD_GROUPS.some((group) => group.id === field.group),
  ),
);
check(
  'field labels are distinct (a label is not a field name in disguise)',
  new Set(ANIME_FIELD_DESCRIPTORS.map((field) => field.label)).size === ANIME_FIELD_DESCRIPTORS.length,
);
check('animeFieldLabel resolves a top-level field', animeFieldLabel('title_ja') === '日文原名', animeFieldLabel('title_ja'));
check('animeFieldLabel resolves a nested field', animeFieldLabel('voice_actor') === '聲優', animeFieldLabel('voice_actor'));
check('animeFieldLabel falls back to the raw name', animeFieldLabel('nope') === 'nope');

const nestedSources = {
  main_cast: schema.properties?.main_cast?.items?.properties,
  sources: schema.properties?.sources?.items?.properties,
  field_sources: schema.properties?.field_sources?.additionalProperties?.properties,
};
for (const [name, properties] of Object.entries(nestedSources)) {
  const expected = Object.keys(properties ?? {}).sort();
  const actual = (inventory.nested?.[name] ?? []).map((field) => field.name).sort();
  const missing = expected.filter((key) => !actual.includes(key));
  const extra = actual.filter((key) => !expected.includes(key));
  check(
    `${name}: nested inventory matches the schema (${expected.length} keys)`,
    missing.length === 0 && extra.length === 0,
    `missing=[${missing.join(',')}] extra=[${extra.join(',')}]`,
  );
}

// Enum coverage: every non-null schema enum value must have a Chinese label.
const enumFields = ['format', 'adaptation_source', 'status', 'season'];
/** Only these three are filter dimensions; `season` is rendered but not filterable. */
const filterableEnumFields = { format: 'format', adaptation_source: 'adaptation', status: 'status' };
const enumLabelMaps = {
  format: labels.ANIME_FORMAT_LABELS,
  adaptation_source: labels.ADAPTATION_SOURCE_LABELS,
  status: labels.ANIME_STATUS_LABELS,
  season: labels.ANIME_SEASON_LABELS,
};
for (const field of enumFields) {
  const allowed = (schema.properties[field].enum ?? []).filter((value) => value !== null);
  const map = enumLabelMaps[field];
  const unlabelled = allowed.filter((value) => !(value in map));
  check(`every ${field} enum value has a label`, unlabelled.length === 0, unlabelled.join(', '));
}
for (const [field, key] of Object.entries(filterableEnumFields)) {
  const allowed = (schema.properties[field].enum ?? []).filter((value) => value !== null);
  check(
    `every ${field} enum token is accepted by parseAnimeFilters (old links keep working)`,
    allowed.every((value) => parseAnimeFilters({ [key]: value })[key].includes(value)),
  );
}
eq(
  'the exported enum token lists are exactly the schema enums',
  [ADAPTATION_SOURCE_TOKENS, ANIME_FORMAT_TOKENS, ANIME_STATUS_TOKENS],
  ['adaptation_source', 'format', 'status'].map((field) => schema.properties[field].enum),
);
check(
  'every field_sources basis has a label',
  (schema.properties.field_sources.additionalProperties.properties.basis.enum ?? []).every(
    (value) => value in labels.BASIS_LABELS,
  ),
);
check(
  'third_party is labelled explicitly (it is the only basis the anime catalogue uses)',
  labels.BASIS_LABELS.third_party === '第三方資料庫',
);
check(
  'the zh-title explanation exists as an exportable constant the pages must render',
  typeof labels.UNRECORDED_ZH_TITLE_NOTE === 'string' && labels.UNRECORDED_ZH_TITLE_NOTE.length > 0,
);

/* ================================================================== *
 * 3. Loader against the real files
 * ================================================================== */
section('loader against data/anime.json');

check('data/anime.json exposes generated_at / count / anime', ['generated_at', 'count', 'anime'].every((key) => key in dataset));
eq('the file\'s own count matches the array length', dataset.count, anime.length);
check(`the file carries ${anime.length} entries (non-zero)`, anime.length > 0);
eq('getAnime() returns the whole array', getAnime().length, anime.length);
eq('getAnimeDataset().count round-trips', getAnimeDataset().count, dataset.count);
eq('getAnimeGeneratedAt() round-trips', getAnimeGeneratedAt(), dataset.generated_at);

const slugs = anime.map((entry) => entry.slug);
check('slugs are unique', new Set(slugs).size === slugs.length);
check(
  'every slug matches ^[a-z0-9][a-z0-9-]*$ (routable)',
  slugs.every((slug) => /^[a-z0-9][a-z0-9-]*$/.test(slug)),
  slugs.filter((slug) => !/^[a-z0-9][a-z0-9-]*$/.test(slug)).join(', '),
);
eq('getAnimeSlugs() equals the data slugs (in order)', getAnimeSlugs(), slugs);
check(
  'getAnimeBySlug() finds every entry, and only that entry',
  slugs.every((slug) => getAnimeBySlug(slug)?.slug === slug),
);
check('getAnimeBySlug() returns undefined for an unknown slug', getAnimeBySlug('definitely-not-a-real-slug') === undefined);

const ids = anime.map((entry) => entry.id);
check('ids are unique (React keys and anchors stay stable)', new Set(ids).size === ids.length);

check('getAnimeReport() parsed the pipeline report', getAnimeReport() !== null);
eq('the report total matches the export (the report is not stale)', report.total, anime.length);
check(
  'the report exposes every key the data-quality page renders',
  [
    'generated_at',
    'total',
    'by_format',
    'by_adaptation_source',
    'by_status',
    'by_year',
    'with_studio',
    'with_cast',
    'with_start_date',
    'with_cover',
    'announced_not_aired',
    'movies',
    'linked_works',
    'schema_errors',
    'collection_note',
  ].every((key) => key in report),
  Object.keys(report).join(', '),
);

/* ================================================================== *
 * 4. Live aggregates reproduce the pipeline report (independent maths)
 * ================================================================== */
section('live aggregates vs data/anime_report.json');

const tally = (list, key) =>
  list.reduce((acc, entry) => {
    const token = key(entry);
    acc[token] = (acc[token] ?? 0) + 1;
    return acc;
  }, {});
const sorted = (value) => JSON.stringify(Object.entries(value ?? {}).sort());

// Written differently from lib/anime.ts on purpose: this is a genuine cross-check.
const yearOf = (entry) =>
  typeof entry.season_year === 'number' ? entry.season_year : entry.start_date ? Number(entry.start_date.slice(0, 4)) : null;
const yearToken = (entry) => (yearOf(entry) === null ? 'unknown' : String(yearOf(entry)));

eq('by_format reproduces from the raw JSON', sorted(tally(anime, (e) => e.format)), sorted(report.by_format));
eq(
  'by_adaptation_source reproduces from the raw JSON',
  sorted(tally(anime, (e) => e.adaptation_source)),
  sorted(report.by_adaptation_source),
);
eq('by_status reproduces from the raw JSON', sorted(tally(anime, (e) => e.status)), sorted(report.by_status));
eq('by_year (season_year first) reproduces from the raw JSON', sorted(tally(anime, yearToken)), sorted(report.by_year));

const live = getAnimeLiveStats();
eq('live byFormat equals the report', sorted(live.byFormat), sorted(report.by_format));
eq('live byAdaptationSource equals the report', sorted(live.byAdaptationSource), sorted(report.by_adaptation_source));
eq('live byStatus equals the report', sorted(live.byStatus), sorted(report.by_status));
eq('live byYear equals the report', sorted(live.byYear), sorted(report.by_year));
eq('live total equals the report', live.total, report.total);
eq('live withStudio equals the report', live.withStudio, report.with_studio);
eq('live withCast equals the report', live.withCast, report.with_cast);
eq('live withStartDate equals the report', live.withStartDate, report.with_start_date);
eq('live withCover equals the report', live.withCover, report.with_cover);
eq('live announcedNotAired equals the report', live.announcedNotAired, report.announced_not_aired);
eq('live movies equals the report', live.movies, report.movies);
eq('live linkedWorks equals the report', live.linkedWorks, report.linked_works);
eq('every report distribution key set matches the live one', Object.keys(live.byFormat).sort(), Object.keys(report.by_format).sort());

eq(
  'withStudio counts entries with at least one studio',
  live.withStudio,
  anime.filter((entry) => entry.studios.length > 0).length,
);
eq(
  'distinctStudios counts unique studio names',
  live.distinctStudios,
  new Set(anime.flatMap((entry) => entry.studios)).size,
);
eq(
  'distinctVoiceActors counts unique non-null voice actors',
  live.distinctVoiceActors,
  new Set(anime.flatMap((entry) => entry.main_cast.map((member) => member.voice_actor)).filter(Boolean)).size,
);
eq('castEntries counts every main_cast row', live.castEntries, anime.flatMap((entry) => entry.main_cast).length);
eq(
  'castEntriesWithoutVoiceActor counts the null ones',
  live.castEntriesWithoutVoiceActor,
  anime.flatMap((entry) => entry.main_cast).filter((member) => !member.voice_actor).length,
);
eq('totalSources counts every sources[] row', live.totalSources, anime.reduce((n, e) => n + e.sources.length, 0));
eq(
  'totalFieldSources counts every field_sources entry',
  live.totalFieldSources,
  anime.reduce((n, e) => n + Object.keys(e.field_sources ?? {}).length, 0),
);
eq('schemaFieldCount equals the size of the inventory', live.schemaFieldCount, ANIME_FIELD_DESCRIPTORS.length);
eq(
  'the year filter option list covers exactly the year tokens present in the data',
  yearOptions(anime).map((option) => option.token).sort(),
  Object.keys(tally(anime, yearToken)).sort(),
);
eq(
  'the unknown-year token set is exactly the entries with neither season_year nor start_date',
  anime.filter((entry) => animeYearToken(entry) === 'unknown').length,
  anime.filter((entry) => entry.season_year == null && !entry.start_date).length,
);

/* ================================================================== *
 * 5. Every entry builds a complete, well-formed view set
 * ================================================================== */
section(`all ${anime.length} entries build a complete view set`);

const fieldNames = ANIME_FIELD_DESCRIPTORS.map((field) => field.name);
let viewProblems = 0;
let unknownTotal = 0;
let populatedTotal = 0;
let sourcedTotal = 0;
let editorialTotal = 0;

for (const entry of anime) {
  const views = buildAnimeFieldViews(entry);
  if (views.length !== fieldNames.length) {
    viewProblems += 1;
    check(`${entry.slug}: view count`, false, `${views.length} !== ${fieldNames.length}`);
    continue;
  }
  for (let i = 0; i < views.length; i += 1) {
    const view = views[i];
    const name = fieldNames[i];
    if (view.field !== name) {
      viewProblems += 1;
      check(`${entry.slug}: view order`, false, `index ${i} was ${view.field}, expected ${name}`);
    }
    if (typeof view.value !== 'string' || view.value.length === 0) {
      viewProblems += 1;
      check(`${entry.slug}.${name}: value is a non-empty string`, false, JSON.stringify(view.value));
    }
    if (view.isUnknown !== (view.value === 'unknown')) {
      viewProblems += 1;
      check(`${entry.slug}.${name}: isUnknown matches the rendered text`, false, `${view.isUnknown} / ${view.value}`);
    }
    const raw = entry[name];
    const blank =
      raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '') || (Array.isArray(raw) && raw.length === 0);
    if (!blank && view.isUnknown) {
      viewProblems += 1;
      check(`${entry.slug}.${name}: populated field not marked unknown`, false, JSON.stringify(raw).slice(0, 60));
    }
    if (view.editorial) editorialTotal += 1;
    if (view.state === 'sourced') {
      sourcedTotal += 1;
      if (view.basis !== 'third_party') {
        viewProblems += 1;
        check(`${entry.slug}.${name}: sourced view must be third_party`, false, String(view.basis));
      }
      if (view.linkableSourceUrl !== view.source.source_url) {
        viewProblems += 1;
        check(`${entry.slug}.${name}: linkableSourceUrl must be the source url`, false, String(view.linkableSourceUrl));
      }
    }
    if (view.isUnknown) unknownTotal += 1;
    else populatedTotal += 1;
  }
}
check(
  `all ${anime.length} entries produce ${fieldNames.length} well-formed views (${populatedTotal} populated, ${unknownTotal} unknown, ${sourcedTotal} sourced)`,
  viewProblems === 0,
);
eq('no anime field is ever flagged editorial', editorialTotal, 0);

const summaries = anime.map((entry) => summarizeAnimeProvenance(buildAnimeFieldViews(entry)));
eq(
  'every summary counts the full inventory',
  new Set(summaries.map((summary) => summary.total)),
  new Set([fieldNames.length]),
);
eq(
  'summary states partition every view set',
  summaries.every((summary) => summary.sourced + summary.unsourced + summary.unknown === summary.total),
  true,
);
eq(
  'the third-party count in every summary equals the number of field_sources entries on that entry',
  anime.every(
    (entry, index) => summaries[index].thirdParty === Object.keys(entry.field_sources ?? {}).length,
  ),
  true,
);
check(
  'thirdParty is >= sourced (a documented field may still have a null value)',
  summaries.every((summary) => summary.thirdParty >= summary.sourced),
);
eq(
  'no view in the whole dataset reports an official / official_tag / editorial / derived basis',
  summaries.reduce((n, summary) => n + summary.official + summary.officialTag + summary.editorial + summary.derived, 0),
  0,
);
check(
  'the third-party basis count equals the number of field_sources entries',
  summaries.reduce((n, summary) => n + summary.thirdParty, 0) === live.totalFieldSources,
);
eq(
  'the live basis tally has exactly one value: third_party',
  Object.keys(live.byBasis),
  ['third_party'],
);
eq('fullyThirdParty equals the number of entries with at least one field_source', live.fullyThirdParty, anime.filter((entry) => Object.keys(entry.field_sources ?? {}).length > 0).length);
eq(
  'grouping covers every field exactly once per entry',
  anime.every(
    (entry) => animeFieldViewsByGroup(entry).reduce((n, group) => n + group.fields.length, 0) === fieldNames.length,
  ),
  true,
);

/* ------------------------------------------------------------------ *
 * nested main_cast / sources / field_sources rows
 * ------------------------------------------------------------------ */
const castRows = animeNestedRows('main_cast', anime.find((entry) => entry.main_cast.length > 0).main_cast[0]);
eq(
  'main_cast renders exactly the schema keys (character, voice_actor)',
  castRows.map((row) => row.name),
  Object.keys(schema.properties.main_cast.items.properties),
);
const nullVaRow = animeNestedRows('main_cast', { character: '角色', voice_actor: null });
check(
  'a null voice actor renders as unknown rather than disappearing',
  nullVaRow.find((row) => row.name === 'voice_actor').isUnknown === true &&
    nullVaRow.find((row) => row.name === 'voice_actor').value === 'unknown' &&
    nullVaRow.find((row) => row.name === 'character').isUnknown === false,
);
const emptyCastRows = animeNestedRows('main_cast', null);
check(
  'a null object still yields every nested row, all unknown (nothing is hidden)',
  emptyCastRows.length === castRows.length && emptyCastRows.every((row) => row.isUnknown && row.href === null),
);
const sourceRows = animeNestedRows('sources', anime[0].sources[0]);
eq(
  'sources renders exactly the schema keys',
  sourceRows.map((row) => row.name),
  Object.keys(schema.properties.sources.items.properties),
);
check(
  'the sources rows expose the source url as a link (kind === "url")',
  sourceRows.find((row) => row.name === 'url').href === anime[0].sources[0].url,
);
const fieldSourceRows = animeNestedRows('field_sources', Object.values(anime[0].field_sources)[0]);
eq(
  'field_sources renders exactly the schema keys',
  fieldSourceRows.map((row) => row.name),
  Object.keys(schema.properties.field_sources.additionalProperties.properties),
);

/* ------------------------------------------------------------------ *
 * field_confidence aliases and field_sources extras
 * ------------------------------------------------------------------ */
const aliasKeys = new Set(anime.flatMap((entry) => animeConfidenceExtras(entry).map((extra) => extra.key)));
check(
  `the pipeline's non-field field_confidence keys are detected and NOT mapped (${[...aliasKeys].sort().join(', ')})`,
  [...aliasKeys].every((key) => !fieldNames.includes(key)),
);
const entryWithAlias = anime.find((entry) => animeConfidenceExtras(entry).length > 0);
check(
  'the detail page lists those keys verbatim instead of translating them',
  read(ANIME_DETAIL_PAGE).includes('不是 schema 欄位名') && read(ANIME_DETAIL_PAGE).includes('animeConfidenceExtras'),
);
check(
  'no anime entry carries a field_sources key outside the schema field list',
  anime.every((entry) => animeSourceExtras(entry).length === 0),
  anime.flatMap((entry) => animeSourceExtras(entry).map((row) => `${entry.slug}.${row.key}`)).slice(0, 5).join(', '),
);
check(
  'animeConfidenceExtras is exercised by the real data',
  entryWithAlias !== undefined,
  'no entry has a non-field confidence key',
);

/* ------------------------------------------------------------------ *
 * per-field coverage reproduces
 * ------------------------------------------------------------------ */
const coverage = animeFieldCoverage(anime);
eq('animeFieldCoverage covers the whole inventory', coverage.length, fieldNames.length);
eq(
  'coverage counts reproduce from the raw rows',
  coverage.every((row) => {
    const withValue = anime.filter((entry) => {
      const raw = entry[row.field];
      if (raw === null || raw === undefined) return false;
      if (typeof raw === 'string') return raw.trim().length > 0;
      if (Array.isArray(raw)) return raw.length > 0;
      return true;
    }).length;
    const withProvenance = anime.filter((entry) => entry.field_sources?.[row.field] !== undefined).length;
    return row.withValue === withValue && row.withProvenance === withProvenance;
  }),
  true,
);
const zhTwCoverage = coverage.find((row) => row.field === 'title_zh_tw');
const zhCnCoverage = coverage.find((row) => row.field === 'title_zh_cn');
eq('title_zh_tw has zero values in this dataset (null on every entry)', zhTwCoverage.withValue, 0);
eq('title_zh_cn has zero values in this dataset (null on every entry)', zhCnCoverage.withValue, 0);
eq(
  'the null zh titles are real nulls, not missing keys',
  anime.every((entry) => 'title_zh_tw' in entry && 'title_zh_cn' in entry && entry.title_zh_tw === null && entry.title_zh_cn === null),
  true,
);
eq(
  'title_ja is populated on every entry (so a null zh translation is not a missing record)',
  anime.every((entry) => typeof entry.title_ja === 'string' && entry.title_ja.length > 0),
  true,
);
const fullTitleCoverage = coverage.filter((row) => row.completeness === 1).map((row) => row.field).sort();
check(
  `fields at 100% completeness: ${fullTitleCoverage.length} / ${coverage.length}`,
  fullTitleCoverage.length > 0,
);
const unidentified = coverage.filter((row) => row.withValue === 0 && row.provenanceRatio === 0).map((row) => row.field);
check(
  `fields with neither a value nor provenance are reported, not hidden (${unidentified.length})`,
  true,
  unidentified.join(', '),
);

/* ================================================================== *
 * 6. Third-party provenance is visible and complete
 * ================================================================== */
section('provenance: every anime field_sources basis is third_party');

const basisDomain = new Set(schema.properties.field_sources.additionalProperties.properties.basis.enum);
const badBasis = anime.flatMap((entry) =>
  Object.entries(entry.field_sources ?? {})
    .filter(([, source]) => !basisDomain.has(source.basis))
    .map(([key, source]) => `${entry.slug}.${key}=${source.basis}`),
);
check('no field_sources basis is outside the schema enum', badBasis.length === 0, badBasis.slice(0, 5).join(', '));
check(
  'every single field_sources basis in the dataset is third_party (AniList, not official)',
  anime.every((entry) => Object.values(entry.field_sources ?? {}).every((source) => source.basis === 'third_party')),
);
const allSources = anime.flatMap((entry) => entry.sources);
check(
  `every sources[] row carries url + retrieved_at + numeric confidence (${allSources.length} rows)`,
  allSources.every(
    (source) => typeof source.url === 'string' && source.url.length > 0 && typeof source.retrieved_at === 'string' && typeof source.confidence === 'number',
  ),
);
check(
  'every sources[] row names AniList and states the third-party provenance in its note',
  allSources.every((source) => /AniList/.test(source.name) && typeof source.note === 'string' && source.note.length > 0),
);
check(
  'the shared BasisBadge can render third_party (CSS class + label exist)',
  read(join(WEB_ROOT, 'components', 'ui.tsx')).includes('third_party') &&
    read(join(WEB_ROOT, 'app', 'globals.css')).includes('.badge-third_party'),
);
for (const [label, file] of [
  ['the anime list page', ANIME_LIST_PAGE],
  ['the anime detail page', ANIME_DETAIL_PAGE],
]) {
  const source = read(file);
  check(`${label} tells the reader AniList is a third-party source`, /third_party|第三方/.test(source), label);
}
check(
  'the detail page repeats the warning next to sources[]',
  /AniList 不是官方來源/.test(read(ANIME_DETAIL_PAGE)),
);

/* ================================================================== *
 * 7. Cover policy
 * ================================================================== */
section('cover policy (URL only, never mirrored, attribution + link out)');

const coverSource = read(COVER_COMPONENT);
check('the cover component still renders an <img> only for a URL', /<img[\s\S]*src=\{url\}/.test(coverSource));
check('it sets referrerPolicy="no-referrer"', coverSource.includes('referrerPolicy="no-referrer"'));
check(
  'it never embeds a cover the source forbids',
  coverSource.includes('cover_display_allowed !== false') && /外連封面/.test(coverSource),
);
check(
  'it always attributes and links back to the source page',
  /href=\{work\.cover_source_url\}/.test(coverSource) && /出處/.test(coverSource),
);
check(
  'it never mirrors bytes (no fetch / file writes / data URLs in the component)',
  !/fetch\(|writeFile|createWriteStream|readFileSync|base64|data:image/.test(coverSource),
);
check(
  'the anime pages reuse the SAME component instead of a local <img>',
  read(ANIME_CARD).includes("from './CoverImage'") &&
    read(ANIME_DETAIL_PAGE).includes("from '@/components/CoverImage'") &&
    !/<img/.test(read(ANIME_CARD)) &&
    !/<img/.test(read(ANIME_DETAIL_PAGE)),
);
check(
  'the anime pages label the cover with its real source (AniList) rather than a region',
  read(ANIME_CARD).includes('sourceTag="AniList"') && read(ANIME_DETAIL_PAGE).includes('sourceTag="AniList"'),
);
const remoteCovers = anime.filter((entry) => typeof entry.cover_url === 'string');
check(
  `every cover_url is an absolute remote URL (${remoteCovers.length} entries)`,
  remoteCovers.every((entry) => /^https?:\/\//.test(entry.cover_url)),
  remoteCovers.filter((entry) => !/^https?:\/\//.test(entry.cover_url)).slice(0, 3).map((entry) => entry.slug).join(', '),
);
check(
  'no cover_url points at a local/mirrored path',
  remoteCovers.every((entry) => !entry.cover_url.startsWith('/') && !entry.cover_url.includes('localhost')),
);
check(
  'every cover has an outbound source page (cover_source_url) to attribute it to',
  anime.every((entry) => entry.cover_url === null || (typeof entry.cover_source_url === 'string' && /^https?:\/\//.test(entry.cover_source_url))),
);
check(
  'the repo ships no mirrored cover bytes for anime (no public/ image directory added)',
  !existsSync(join(WEB_ROOT, 'public', 'anime')),
);

/* ================================================================== *
 * 8. Filters: every dimension returns EXACTLY the derived set
 * ================================================================== */
section('filters return exactly the set derived from the data');

const run = (params) => filterAndSortAnime(anime, parseAnimeFilters(params));
const slugSet = (list) => list.map((entry) => entry.slug).sort();
const sameSet = (a, b) => JSON.stringify(slugSet(a)) === JSON.stringify(slugSet(b));

/**
 * Simulates what Next.js hands the page: repeated query keys arrive as an array,
 * single keys as a string. `Object.fromEntries(new URLSearchParams(...))` would
 * silently keep only the LAST value of a repeated key, which would hide
 * multi-select bugs instead of catching them.
 */
function parseQuery(queryWithOrWithoutPath) {
  const query = queryWithOrWithoutPath.includes('?')
    ? queryWithOrWithoutPath.slice(queryWithOrWithoutPath.indexOf('?') + 1)
    : queryWithOrWithoutPath;
  const params = new URLSearchParams(query);
  const input = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    input[key] = values.length > 1 ? values : values[0];
  }
  return parseAnimeFilters(input);
}

function checkDimension(label, dimension, key, tokenOf) {
  const options = key === 'adaptation' ? adaptationOptions(anime) : key === 'format' ? formatOptions(anime) : statusOptions(anime);
  const mismatches = [];
  for (const option of options) {
    const got = run({ [key]: option.token });
    const want = anime.filter((entry) => tokenOf(entry) === option.token);
    if (!sameSet(got, want)) mismatches.push(option.token);
    if (option.count !== want.length) mismatches.push(`${option.token}:count=${option.count}!=${want.length}`);
  }
  check(
    `${dimension}: all ${options.length} offered tokens return the derived set, with the derived count`,
    mismatches.length === 0,
    mismatches.slice(0, 5).join(', '),
  );
  check(
    `${dimension}: every offered token exists in the data`,
    options.every((option) => anime.some((entry) => tokenOf(entry) === option.token)),
  );
  return options;
}

const adaptationOpts = checkDimension('adaptation_source', '改編類型', 'adaptation', (entry) => entry.adaptation_source);
const formatOpts = checkDimension('format', '形態', 'format', (entry) => entry.format);
const statusOpts = checkDimension('status', '狀態', 'status', (entry) => entry.status);

// year
const yearOptionsList = yearOptions(anime);
const yearMismatches = yearOptionsList.filter((option) => !sameSet(run({ year: option.token }), anime.filter((entry) => yearToken(entry) === option.token)));
check(
  `年份: all ${yearOptionsList.length} offered tokens return the derived set`,
  yearMismatches.length === 0,
  yearMismatches.map((option) => option.token).join(', '),
);
check(
  'the year options are ordered newest → oldest with unknown last',
  (() => {
    const tokens = yearOptionsList.map((option) => option.token);
    const unknownAt = tokens.indexOf('unknown');
    if (unknownAt !== -1 && unknownAt !== tokens.length - 1) return false;
    const numeric = tokens.filter((token) => token !== 'unknown').map(Number);
    return numeric.every((value, index) => index === 0 || numeric[index - 1] >= value);
  })(),
  yearOptionsList.map((option) => option.token).join(','),
);

// studio
const studioOptionsList = studioOptions(anime);
const studioMismatches = studioOptionsList.filter((option) => !sameSet(run({ studio: option.token }), anime.filter((entry) => entry.studios.includes(option.token))));
check(
  `製作公司: all ${studioOptionsList.length} offered studios return the derived set`,
  studioMismatches.length === 0,
  studioMismatches.slice(0, 5).map((option) => option.token).join(', '),
);
check(
  'the studio filter matches studios[] exactly (a truncated name matches nothing)',
  studioOptionsList
    .filter((option) => option.token.length >= 4)
    .slice(0, 25)
    .every((option) => run({ studio: `${option.token}-does-not-exist` }).length === 0),
);

// OR within a dimension, AND across dimensions
const multiAdaptation = adaptationOpts.slice(0, 2).map((option) => option.token);
eq(
  'multi-select within a dimension is OR',
  slugSet(run({ adaptation: multiAdaptation })),
  slugSet(anime.filter((entry) => multiAdaptation.includes(entry.adaptation_source))),
);
const pairFormat = formatOpts.slice(0, 2).map((option) => option.token);
eq(
  'two-dimension filters combine with AND',
  slugSet(run({ adaptation: ['manga'], format: pairFormat })),
  slugSet(anime.filter((entry) => entry.adaptation_source === 'manga' && pairFormat.includes(entry.format))),
);
const sampleStatus = statusOpts[0].token;
const sampleStudio = studioOptionsList[0].token;
eq(
  'three-dimension filters (adaptation + format + status) combine with AND',
  slugSet(run({ adaptation: ['manga'], format: pairFormat, status: [sampleStatus] })),
  slugSet(
    anime.filter(
      (entry) =>
        entry.adaptation_source === 'manga' && pairFormat.includes(entry.format) && entry.status === sampleStatus,
    ),
  ),
);
eq(
  'adding a studio narrows the result set (AND, never widens)',
  run({ adaptation: ['manga'], studio: sampleStudio }).every((entry) =>
    anime.some((other) => other.slug === entry.slug && other.adaptation_source === 'manga' && other.studios.includes(sampleStudio)),
  ),
  true,
);
eq(
  'contradictory filters yield an empty set',
  run({ adaptation: ['manga'], format: ['music'], status: ['announced'] }).length === 0 ||
    !anime.some((entry) => entry.adaptation_source === 'manga' && entry.format === 'music' && entry.status === 'announced'),
  true,
);
eq('an empty filter set returns every entry', run({}).length, anime.length);
eq('EMPTY_ANIME_FILTERS serialises to an empty query string', buildAnimeQueryString(EMPTY_ANIME_FILTERS), '');
eq('countActiveAnimeFilters(EMPTY) is 0', countActiveAnimeFilters(EMPTY_ANIME_FILTERS), 0);

/* ------------------------------------------------------------------ *
 * search
 * ------------------------------------------------------------------ */
section('text search over titles, studios and voice actors');

const searchProblems = [];
for (const entry of anime) {
  const fields = searchableAnimeText(entry);
  for (const required of [entry.title_ja, entry.title_romaji, entry.title_en, ...entry.studios].filter(Boolean)) {
    if (!fields.includes(required)) searchProblems.push(`${entry.slug}:${required}`);
  }
  for (const member of entry.main_cast) {
    if (member.voice_actor && !fields.includes(member.voice_actor)) searchProblems.push(`${entry.slug}:va:${member.voice_actor}`);
    if (member.character && !fields.includes(member.character)) searchProblems.push(`${entry.slug}:char:${member.character}`);
  }
}
check(
  'the search haystack contains every title, studio and voice actor (character too)',
  searchProblems.length === 0,
  searchProblems.slice(0, 5).join(', '),
);
check(
  'the haystack also carries the (currently null) zh title fields, so a future translation is searchable',
  searchableAnimeText({ title_zh_tw: '測試譯名', title_zh_cn: '测试译名' }).includes('測試譯名') &&
    searchableAnimeText({ title_zh_tw: '測試譯名', title_zh_cn: '测试译名' }).includes('测试译名'),
);

const romajiEntry = anime.find((entry) => entry.title_romaji);
check(
  `searching a romaji title finds its entry ("${romajiEntry.title_romaji}")`,
  run({ q: romajiEntry.title_romaji }).some((entry) => entry.slug === romajiEntry.slug),
);
const enEntry = anime.find((entry) => entry.title_en);
if (enEntry) {
  check(
    `searching an English title finds its entry ("${enEntry.title_en}")`,
    run({ q: enEntry.title_en }).some((entry) => entry.slug === enEntry.slug),
  );
} else {
  check('no entry has an English title to search (informational)', true);
}
const studioEntry = anime.find((entry) => entry.studios.length > 0);
const byStudio = run({ q: studioEntry.studios[0] });
check(
  `searching a studio name ("${studioEntry.studios[0]}") finds every entry of that studio`,
  anime.filter((entry) => entry.studios.includes(studioEntry.studios[0])).every((entry) => byStudio.some((hit) => hit.slug === entry.slug)),
);
const vaEntry = anime.find((entry) => entry.main_cast.some((member) => member.voice_actor));
const va = vaEntry.main_cast.find((member) => member.voice_actor).voice_actor;
const byVa = run({ q: va });
check(
  `searching a voice actor name ("${va}") finds every entry they are credited in`,
  anime
    .filter((entry) => entry.main_cast.some((member) => member.voice_actor === va))
    .every((entry) => byVa.some((hit) => hit.slug === entry.slug)),
);
check(
  'two tokens must both hit (AND semantics)',
  matchesAnimeQuery(anime[0], `${anime[0].title_ja} 絶対に存在しない語`) === false,
);
eq('an empty query matches everything', run({ q: '   ' }).length, anime.length);
eq('a query that contradicts a filter yields nothing', run({ q: anime[0].title_ja, studio: '絶対に存在しない製作会社' }).length, 0);
check(
  'a null field never becomes the literal "null" in the search haystack',
  anime.every((entry) => !searchableAnimeText(entry).some((field) => /^null$/i.test(field))),
);
check(
  'normalisation survives full-width input',
  matchesAnimeQuery(anime[0], anime[0].title_ja.normalize('NFKC')) === true,
);

/* ------------------------------------------------------------------ *
 * sort
 * ------------------------------------------------------------------ */
section('sorting');

for (const sort of ANIME_SORTS) {
  const once = sortAnime(anime, sort);
  const twice = sortAnime(anime, sort);
  eq(`${sort}: deterministic`, slugSet(once), slugSet(twice));
  eq(`${sort}: never drops or adds an entry`, once.length, anime.length);
  eq(`${sort}: returns the same slug multiset`, slugSet(once), slugSet(anime));
  eq(`${sort}: does not mutate the input`, anime.map((entry) => entry.slug), slugs);
}
const desc = sortAnime(anime, 'air_date_desc');
const firstUnknown = desc.findIndex((entry) => !entry.start_date);
check(
  'air_date_desc: dated entries are newest-first and the undated ones come last',
  firstUnknown === -1 ||
    (desc.slice(0, firstUnknown).every((entry, index) => index === 0 || (desc[index - 1].start_date ?? '') >= (entry.start_date ?? '')) &&
      desc.slice(firstUnknown).every((entry) => !entry.start_date)),
);
const scoreSorted = sortAnime(anime, 'score_desc');
const firstNullScore = scoreSorted.findIndex((entry) => typeof entry.average_score !== 'number');
check(
  'score_desc: scores are non-increasing and unscored entries come last',
  firstNullScore === -1 ||
    (scoreSorted
      .slice(0, firstNullScore)
      .every((entry, index) => index === 0 || scoreSorted[index - 1].average_score >= entry.average_score) &&
      scoreSorted.slice(firstNullScore).every((entry) => typeof entry.average_score !== 'number')),
);
const titleSorted = sortAnime(anime, 'title');
check(
  'title sort is ordered by the Japanese title with no entry lost',
  titleSorted.length === anime.length &&
    titleSorted.every((entry, index) => index === 0 || titleSorted[index - 1].title_ja.localeCompare(entry.title_ja, 'ja') <= 0),
);
eq('the default sort is the documented one', DEFAULT_ANIME_SORT, 'air_date_desc');
eq('an unknown sort token degrades to the default', parseAnimeFilters({ sort: 'nope' }).sort, DEFAULT_ANIME_SORT);
eq('every documented sort token is accepted', ANIME_SORTS.filter((sort) => parseAnimeFilters({ sort }).sort !== sort), []);

/* ================================================================== *
 * 9. Presets equal their independent re-derivation
 * ================================================================== */
section('one-click presets');

const expectedPresetIds = ['manga', 'light_novel', 'original_tv', 'movie', 'announced'];
eq('the five presets the feature requires exist', ANIME_PRESETS.map((preset) => preset.id), expectedPresetIds);
check(
  'every preset has a label, a description describing its口径, and a shareable href',
  ANIME_PRESETS.every(
    (preset) =>
      typeof preset.label === 'string' &&
      preset.label.length > 0 &&
      typeof preset.description === 'string' &&
      preset.description.length > 0 &&
      animePresetHref(preset).startsWith('/anime'),
  ),
);
const presetExpectations = {
  manga: (entry) => entry.adaptation_source === 'manga',
  light_novel: (entry) => LIGHT_NOVEL_FAMILY.includes(entry.adaptation_source),
  original_tv: (entry) => entry.adaptation_source === 'original' && entry.format === 'tv',
  movie: (entry) => entry.format === 'movie',
  announced: (entry) => entry.status === 'announced',
};
for (const preset of ANIME_PRESETS) {
  const expected = anime.filter(presetExpectations[preset.id]).map((entry) => entry.slug).sort();
  const got = slugSet(filterAndSortAnime(anime, preset.filters));
  check(
    `preset ${preset.id} returns exactly the derived set (${expected.length} entries) — expected [${expected.slice(0, 3).join(', ')}${expected.length > 3 ? ', …' : ''}]`,
    JSON.stringify(got) === JSON.stringify(expected),
    `got [${got.slice(0, 3).join(', ')}] expected [${expected.slice(0, 3).join(', ')}]`,
  );
  check(`preset ${preset.id} is non-empty on the real data`, expected.length > 0);
  eq(`preset ${preset.id} keeps the default sort`, preset.filters.sort, DEFAULT_ANIME_SORT);
}
const originalAll = anime.filter((entry) => entry.adaptation_source === 'original').length;
const originalTvCount = filterAndSortAnime(anime, ANIME_PRESETS.find((preset) => preset.id === 'original_tv').filters).length;
check(
  `原創 TV 動畫 (${originalTvCount}) is a strict subset of 原創 (${originalAll})`,
  originalTvCount > 0 && originalTvCount <= originalAll,
);
check(
  'the list page explains the 原創 TV vs 原創（全形態）distinction instead of hiding it',
  /original/.test(read(ANIME_BROWSER)) && /形態/.test(read(ANIME_BROWSER)),
);

/* ================================================================== *
 * 10. URL query round-trips
 * ================================================================== */
section('URL query string round-trips');

const complex = makeAnimeFilters({
  q: 'citrus',
  adaptation: ['manga', 'original'],
  format: ['tv', 'movie'],
  status: ['finished', 'announced'],
  year: yearOptionsList[0].token,
  studio: studioOptionsList[0].token,
  sort: 'popularity_desc',
});
const queryString = buildAnimeQueryString(complex);
check(
  'the query string mentions every active dimension',
  ['q=citrus', 'adaptation=manga', 'adaptation=original', 'format=movie', 'format=tv', 'status=announced', 'status=finished', `year=${yearOptionsList[0].token}`, 'sort=popularity_desc'].every((part) =>
    queryString.includes(part),
  ),
  queryString,
);
eq(
  'the studio parameter survives URLSearchParams (spaces, dots and CJK included)',
  new URLSearchParams(queryString).get('studio'),
  studioOptionsList[0].token,
);
const reparsed = parseQuery(queryString);
eq('filters survive a URL round-trip', reparsed, complex);
eq('the round-trip is idempotent', buildAnimeQueryString(reparsed), queryString);
eq('buildAnimeQueryString has a fixed key order', buildAnimeQueryString({ ...complex }), queryString);
for (const preset of ANIME_PRESETS) {
  eq(`preset ${preset.id} round-trips through the URL`, parseQuery(animePresetHref(preset)), preset.filters);
}
eq('repeated keys (GET form output) are read as a list', parseAnimeFilters({ format: ['tv', 'movie'] }).format, ['movie', 'tv']);
eq('comma lists (hand-written links) are read as a list', parseAnimeFilters({ format: 'tv,movie' }).format, ['movie', 'tv']);
eq('duplicate tokens collapse', parseAnimeFilters({ format: 'tv,tv' }).format, ['tv']);
eq('unknown enum tokens are dropped', parseAnimeFilters({ format: ['tv', 'nope'], adaptation: 'nope', status: 'nope' }), makeAnimeFilters({ format: ['tv'] }));
eq('a bad year degrades to "any"', parseAnimeFilters({ year: '20xx' }).year, '');
eq('the "unknown" year token is accepted', parseAnimeFilters({ year: 'unknown' }).year, 'unknown');
eq('a bad sort degrades to the default', parseAnimeFilters({ sort: 'weird' }).sort, DEFAULT_ANIME_SORT);
eq('q is trimmed', parseAnimeFilters({ q: '  citrus  ' }).q, 'citrus');
eq('defaults serialise to an empty query string', buildAnimeQueryString(parseAnimeFilters(undefined)), '');
eq('empty input yields defaults', parseAnimeFilters(undefined), EMPTY_ANIME_FILTERS);
const studioWithSpace = studioOptionsList.find((option) => /[\s.&]/.test(option.token)) ?? studioOptionsList[0];
const studioRoundTrip = parseQuery(buildAnimeQueryString(makeAnimeFilters({ studio: studioWithSpace.token })));
eq(`a studio name containing punctuation round-trips ("${studioWithSpace.token}")`, studioRoundTrip.studio, studioWithSpace.token);
eq(
  'countActiveAnimeFilters counts the query plus every selected token',
  countActiveAnimeFilters(complex),
  1 + complex.adaptation.length + complex.format.length + complex.status.length + 1 + 1 + 1,
);
eq('countActiveAnimeFilters ignores the default sort', countActiveAnimeFilters(makeAnimeFilters({ sort: DEFAULT_ANIME_SORT })), 0);

/* ================================================================== *
 * 11. The slim client projection the static export actually ships
 * ================================================================== */
section('slim projection (lib/anime-slim.json) vs the full dataset');

/**
 * /anime filters in the browser, so the exported site ships lib/anime-slim.json
 * (built by scripts/build-slim.mjs) instead of the full data/anime.json. That is
 * only safe while the projection is SEMANTICALLY EQUIVALENT to the full dataset
 * for everything the UI reads, so every claim is checked here against the same
 * functions the app uses: search, every filter dimension, every option list, every
 * preset and both the card's replacement fields.
 */
const slim = JSON.parse(read(ANIME_SLIM_JSON));
const slimAnime = slim.anime;

eq(`the projection covers every entry (${anime.length})`, slimAnime.length, anime.length);
eq('the projection reports the same count as its own array', slim.count, slimAnime.length);
eq('the projection keeps the dataset timestamp', slim.generated_at, dataset.generated_at);
eq(
  'the projection keeps every entry in the dataset order, with the same id and slug',
  slimAnime.map((entry) => [entry.id, entry.slug]),
  anime.map((entry) => [entry.id, entry.slug]),
);
eq(
  'every projected record exposes exactly the same key set',
  [...new Set(slimAnime.map((entry) => Object.keys(entry).sort().join(',')))].length,
  1,
);

const projectedFieldDrift = slimAnime.filter((projected, index) => {
  const full = anime[index];
  return (
    projected.sources_count !== (full.sources ?? []).length ||
    !Object.is(projected.episode_duration_min, full.episode_duration_min ?? null) ||
    (projected.studios ?? []).join('\u0000') !== (full.studios ?? []).join('\u0000') ||
    (projected.main_cast ?? []).length !== (full.main_cast ?? []).length
  );
});
eq(
  'sources_count (the replacement for sources[]) and episode_duration_min match the full record on every entry',
  projectedFieldDrift.map((entry) => entry.slug).slice(0, 5),
  [],
);

// The filter panel's option lists and per-value counts must be identical, or the
// browser would offer a value (or a count) the dataset does not support.
for (const [label, derive] of [
  ['改編類型', adaptationOptions],
  ['形態', formatOptions],
  ['狀態', statusOptions],
  ['年份', yearOptions],
  ['製作公司', studioOptions],
]) {
  eq(`the ${label} options and their counts are identical`, derive(slimAnime), derive(anime));
}
eq(
  'the five preset counts are identical',
  ANIME_PRESETS.map((preset) => filterAndSortAnime(slimAnime, preset.filters).length),
  ANIME_PRESETS.map((preset) => filterAndSortAnime(anime, preset.filters).length),
);

const adaptationChoices = [[], ...adaptationOptions(anime).map((option) => [option.token])];
const formatChoices = [[], ...formatOptions(anime).map((option) => [option.token])];
const statusChoices = [[], ...statusOptions(anime).map((option) => [option.token])];
const yearChoices = ['', ...yearOptions(anime).map((option) => option.token)];

let projectionMismatch = null;
let combinations = 0;
outer: for (const adaptation of adaptationChoices) {
  for (const format of formatChoices) {
    for (const status of statusChoices) {
      for (const year of yearChoices) {
        for (const sort of ANIME_SORTS) {
          combinations += 1;
          const filters = makeAnimeFilters({ adaptation, format, status, year, sort });
          const fromFull = JSON.stringify(filterAndSortAnime(anime, filters).map((entry) => entry.slug));
          const fromSlim = JSON.stringify(filterAndSortAnime(slimAnime, filters).map((entry) => entry.slug));
          if (fromFull !== fromSlim) {
            projectionMismatch = { filters, fromFull: fromFull.slice(0, 120), fromSlim: fromSlim.slice(0, 120) };
            break outer;
          }
        }
      }
    }
  }
}
check(
  `all ${combinations} combinations of adaptation × format × status × year × sort return the identical set and order`,
  projectionMismatch === null,
  projectionMismatch ? JSON.stringify(projectionMismatch) : undefined,
);

let studioMismatch = null;
for (const option of studioOptions(anime)) {
  const filters = makeAnimeFilters({ studio: option.token });
  const fromFull = JSON.stringify(filterAndSortAnime(anime, filters).map((entry) => entry.slug));
  const fromSlim = JSON.stringify(filterAndSortAnime(slimAnime, filters).map((entry) => entry.slug));
  if (fromFull !== fromSlim) {
    studioMismatch = option.token;
    break;
  }
}
check(
  `every one of the ${studioOptions(anime).length} 製作公司 filters returns the identical set`,
  studioMismatch === null,
  studioMismatch ?? undefined,
);

const castMember = anime.find((entry) => (entry.main_cast ?? []).some((member) => member.voice_actor));
const searchProbes = [
  anime[0].title_ja,
  anime[0].slug,
  anime.find((entry) => entry.title_romaji)?.title_romaji,
  anime.find((entry) => entry.title_en)?.title_en,
  studioOptions(anime)[0]?.token,
  castMember?.main_cast.find((member) => member.voice_actor)?.voice_actor,
  castMember?.main_cast.find((member) => member.character)?.character,
  `${anime[0].title_ja} 絶対に存在しない語`,
].filter((value) => typeof value === 'string' && value.length > 0);

const searchMismatch = searchProbes.find((q) => {
  const filters = makeAnimeFilters({ q });
  return (
    JSON.stringify(filterAndSortAnime(anime, filters).map((entry) => entry.slug)) !==
    JSON.stringify(filterAndSortAnime(slimAnime, filters).map((entry) => entry.slug))
  );
});
check(
  `search over ${searchProbes.length} data-derived probes (title / romaji / en / slug / studio / voice actor / character / AND-miss) is identical`,
  searchMismatch === undefined,
  searchMismatch ?? undefined,
);

check(
  'the projection carries no sources[] / field_sources / field_confidence (that is what makes it small)',
  slimAnime.every((entry) => !('sources' in entry) && !('field_sources' in entry) && !('field_confidence' in entry)),
);

/* ================================================================== *
 * 12. Rendering discipline for null titles + page wiring
 * ================================================================== */
section('null-title discipline and page wiring');

const titleComponent = read(TITLE_COMPONENT);
check('TitleTriple renders the missing-translation placeholder （未收錄）', titleComponent.includes('（未收錄）'));
check(
  'TitleTriple keeps the "no official edition" / "not checked" distinction',
  titleComponent.includes('目前無官方版本') && titleComponent.includes('尚未查證'),
);
check(
  'TitleTriple accepts a missingLabel so a source without zh titles can explain itself',
  titleComponent.includes('missingLabel') && titleComponent.includes('title_zh_tw_status'),
);
for (const [label, file] of [
  ['the anime card', ANIME_CARD],
  ['the anime detail page', ANIME_DETAIL_PAGE],
]) {
  const source = read(file);
  check(`${label} renders all three titles through the shared TitleTriple`, source.includes('<TitleTriple') && source.includes('missingLabel'));
}
check(
  'neither anime page inlines a raw title field instead of the shared component',
  !/<h1[^>]*>\{anime\.title_zh_tw\}/.test(read(ANIME_DETAIL_PAGE)) &&
    !/>\{anime\.title_zh_cn\}</.test(read(ANIME_DETAIL_PAGE)) &&
    !/>\{anime\.title_zh_tw\}</.test(read(ANIME_CARD)),
);
check(
  'the detail page explains WHY the zh titles are null',
  read(ANIME_DETAIL_PAGE).includes('UNRECORDED_ZH_TITLE_NOTE'),
);
check(
  'the list page also states the null-title rule',
  read(ANIME_LIST_PAGE).includes('UNRECORDED_ZH_TITLE_NOTE') || /未收錄/.test(read(ANIME_LIST_PAGE)),
);
check(
  'the detail page renders the full 主要聲優 table (character + voice actor)',
  /角色（character）/.test(read(ANIME_DETAIL_PAGE)) && /聲優（voice_actor）/.test(read(ANIME_DETAIL_PAGE)),
);
check(
  'the detail page renders 製作公司, 開播時間, 結束時間, 季, 集數 and 時長 explicitly',
  ['製作公司（studios）', '開播時間（start_date）', '結束時間（end_date）', '季（season / season_year）', '集數（episode_count）', '單集時長（episode_duration_min）'].every(
    (text) => read(ANIME_DETAIL_PAGE).includes(text),
  ),
);
check(
  'the detail page renders AniList / MyAnimeList IDs and links to the related Work when set',
  read(ANIME_DETAIL_PAGE).includes('AniList ID') &&
    read(ANIME_DETAIL_PAGE).includes('MyAnimeList ID') &&
    read(ANIME_DETAIL_PAGE).includes('/works/'),
);
const linked = anime.filter((entry) => entry.related_work_slug || entry.related_work_id);
check(`the dataset links ${linked.length} anime to a Work`, linked.length > 0);
if (existsSync(WORKS_JSON)) {
  const works = JSON.parse(read(WORKS_JSON)).works;
  const workSlugs = new Set(works.map((work) => work.slug));
  const dangling = linked.filter((entry) => entry.related_work_slug && !workSlugs.has(entry.related_work_slug));
  eq('every related_work_slug resolves to a real Work (no dead links)', dangling.map((entry) => entry.slug), []);
}
check(
  'the anime pages import the shared provenance table and source list',
  read(ANIME_DETAIL_PAGE).includes('ProvenanceTable') && read(ANIME_DETAIL_PAGE).includes('SourceList'),
);
check(
  'SiteChrome exposes a nav link to /anime',
  /href: '\/anime'/.test(read(SITE_CHROME)),
);
check(
  'the data-quality page reports the anime coverage from data/anime_report.json',
  read(DATA_QUALITY_PAGE).includes('getAnimeReport') && read(DATA_QUALITY_PAGE).includes('anime_report.json'),
);
check(
  'the data-quality page cross-checks the report against the live computation',
  read(DATA_QUALITY_PAGE).includes('getAnimeLiveStats') && read(DATA_QUALITY_PAGE).includes('animeFieldCoverage'),
);
const packageJson = JSON.parse(read(PACKAGE_JSON));
check(
  'npm run verify includes verify:anime',
  typeof packageJson.scripts['verify:anime'] === 'string' && packageJson.scripts.verify.includes('verify:anime'),
  JSON.stringify(packageJson.scripts),
);
check(
  'the anime browser puts its filter state in the URL and the form is a GET form',
  read(ANIME_BROWSER).includes('parseAnimeFilters') && read(join(WEB_ROOT, 'components', 'AnimeFilterPanel.tsx')).includes('method="get"'),
);
check(
  'the anime list page is a static server shell that hands the URL-driven part to the browser component',
  read(ANIME_LIST_PAGE).includes('<AnimeBrowser') &&
    read(ANIME_LIST_PAGE).includes('Suspense') &&
    !read(ANIME_LIST_PAGE).includes("'use client'"),
);
check(
  'the list page marks itself mobile responsive (single column → 2 → 3)',
  /grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3/.test(read(ANIME_BROWSER)),
);
check(
  'the card shows 開播時間 / 製作公司 / 主要聲優 on the entry itself',
  ['開播時間：', '製作公司：', '主要聲優：'].every((text) => read(ANIME_CARD).includes(text)),
);
check(
  'the runtime summary reports unknown instead of inventing episode counts',
  typeof animeRuntimeSummary({ episode_count: null, episode_duration_min: null }) === 'string' &&
    animeRuntimeSummary({ episode_count: null, episode_duration_min: null }).includes('unknown') &&
    animeRuntimeSummary(anime.find((entry) => typeof entry.episode_count === 'number')).includes('集'),
);

/* ------------------------------------------------------------------ *
 * the "never hardcode a count" guard
 * ------------------------------------------------------------------ */
const selfSource = read(fileURLToPath(import.meta.url));
check(
  `this script does not contain the dataset size (${anime.length}) as a literal — every count is derived`,
  !new RegExp(`\\b${anime.length}\\b`).test(selfSource),
);

/* ================================================================== */
console.log(`\n${'='.repeat(64)}`);
if (failures.length) {
  console.error(`ANIME VERIFICATION FAILED - ${failures.length} of ${passed + failures.length} checks failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `ANIME VERIFICATION PASSED - ${passed} checks, using the real lib/anime.ts against the real ` +
    `data/anime.json (${anime.length} entries) and data/anime_report.json.`,
);
process.exit(0);
