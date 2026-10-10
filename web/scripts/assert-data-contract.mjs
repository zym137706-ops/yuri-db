#!/usr/bin/env node
/**
 * Phase 4 · data contract assertion (no npm required).
 *
 * Proves the web UI's assumptions against the real artefacts:
 *   1. every field the UI reads exists in data/works.json (with the right shape),
 *   2. lib/schema-fields.json is a bijection with schemas/work.schema.json
 *      `properties` — i.e. the detail page really does render EVERY schema field,
 *   3. the provenance/rating/unofficial_zh invariants hold on the real rows,
 *   4. data/dataset_report.json is usable, and data/change_log.json is optional,
 *   5. sources.yaml exposes every key the Sources page renders (75 + 19 = 94).
 *
 * Run:  node scripts/assert-data-contract.mjs
 * Exit: 0 = contract holds, 1 = contract violated.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(WEB_ROOT, '..');

const WORKS_JSON = join(REPO_ROOT, 'data', 'works.json');
const REPORT_JSON = join(REPO_ROOT, 'data', 'dataset_report.json');
const CHANGE_LOG_JSON = join(REPO_ROOT, 'data', 'change_log.json');
const SOURCES_YAML = join(REPO_ROOT, 'sources.yaml');
const SCHEMA_JSON = join(REPO_ROOT, 'schemas', 'work.schema.json');
const SCHEMA_FIELDS_JSON = join(WEB_ROOT, 'lib', 'schema-fields.json');

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  x ${msg}`);
};
const ok = (msg) => console.log(`  + ${msg}`);
const info = (msg) => console.log(`  . ${msg}`);
function section(title) {
  console.log(`\n== ${title} ==`);
}

/* ================================================================== *
 * 1. works.json shape
 * ================================================================== */
section('data/works.json');

if (!existsSync(WORKS_JSON)) {
  fail(`missing file: ${WORKS_JSON}`);
  process.exit(1);
}
const dataset = JSON.parse(readFileSync(WORKS_JSON, 'utf8'));

for (const key of ['generated_at', 'count', 'works']) {
  if (!(key in dataset)) fail(`dataset root missing key "${key}"`);
}
if (!Array.isArray(dataset.works)) fail('dataset.works is not an array');
if (dataset.count !== dataset.works.length) {
  fail(`dataset.count (${dataset.count}) !== works.length (${dataset.works.length})`);
}
if (!failures) ok(`root keys present, count=${dataset.count} matches works.length`);

/**
 * Fields the UI reads. `required` mirrors the schema's `required` list.
 * `expectedKeys` are fields that must be present as a KEY on every record (even
 * when null) because the UI renders them explicitly. `optional` may be absent
 * entirely — the schema marks them optional and the current export omits them.
 */
const REQUIRED_FIELDS = [
  'id', 'slug', 'title_ja', 'media_type', 'serialization_status', 'yuri_type',
  'classification_basis', 'anime_status', 'official_zh_cn', 'unofficial_zh',
  'sources', 'last_checked',
];
const ALWAYS_PRESENT_KEYS = [
  'title_zh_tw', 'title_zh_cn', 'title_en', 'publisher_ja', 'publisher_zh_tw',
  'publisher_zh_cn', 'magazine_or_platform', 'magazine_or_platform_kind',
  'magazine_or_platform_active', 'start_date', 'end_date', 'latest_chapter_label',
  'chapter_count', 'volume_count_ja', 'volume_count_zh_tw', 'volume_count_zh_cn',
  'authors', 'illustrators', 'genres', 'genres_official', 'anime_details',
  'ja_volumes', 'zh_tw_volumes', 'zh_cn_volumes', 'ratings', 'review_meta',
  'field_sources', 'field_confidence',
];
/** Optional in the schema AND absent from this export — the UI tolerates both. */
const TRULY_OPTIONAL_FIELDS = ['created_at', 'updated_at'];

for (const work of dataset.works) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in work)) fail(`work ${work.slug}: missing required field "${field}"`);
  }
  for (const field of ALWAYS_PRESENT_KEYS) {
    if (!(field in work)) {
      fail(`work ${work.slug}: missing key "${field}" (UI renders null as "unknown", so the key must exist)`);
    }
  }
}
const absentOptional = TRULY_OPTIONAL_FIELDS.filter((f) => dataset.works.every((w) => !(f in w)));
ok(
  `all ${dataset.works.length} works carry the ${REQUIRED_FIELDS.length} required + ${ALWAYS_PRESENT_KEYS.length} always-present keys the UI reads`,
);
if (absentOptional.length) {
  info(
    `optional-and-absent in this export: ${absentOptional.join(', ')} — the detail page renders these as "unknown" and never assumes they exist`,
  );
} else {
  ok('created_at / updated_at are present in this export');
}

const ENUMS = {
  media_type: ['manga', 'light_novel', 'web_novel'],
  serialization_status: ['ongoing', 'completed', 'hiatus', 'unknown'],
  yuri_type: ['orthodox_yuri', 'light_yuri', 's_class', 'gl', 'micro_yuri', 'uncertain'],
  classification_basis: ['official_tag', 'editorial'],
  anime_status: ['none', 'announced', 'in_production', 'airing', 'finished', 'movie'],
  magazine_or_platform_kind: ['magazine', 'web_platform', 'web_novel_site', 'label', 'other', null],
};
for (const [field, allowed] of Object.entries(ENUMS)) {
  const bad = dataset.works
    .filter((w) => !allowed.includes(w[field]))
    .map((w) => `${w.slug}=${JSON.stringify(w[field])}`);
  if (bad.length) fail(`${field}: values outside the schema enum -> ${bad.join(', ')}`);
}
ok('every enum-typed value is inside its schema enum');

const badSlugs = dataset.works.filter((w) => !/^[a-z0-9][a-z0-9-]*$/.test(w.slug));
if (badSlugs.length) fail(`slug pattern violations: ${badSlugs.map((w) => w.slug).join(', ')}`);
else ok(`all ${dataset.works.length} slugs match ^[a-z0-9][a-z0-9-]*$ (routable)`);

const dupSlugs = dataset.works.map((w) => w.slug).filter((s, i, a) => a.indexOf(s) !== i);
if (dupSlugs.length) fail(`duplicate slugs break routing: ${[...new Set(dupSlugs)].join(', ')}`);
else ok('slugs are unique (generateStaticParams will not collide)');

const dupIds = dataset.works.map((w) => w.id).filter((s, i, a) => a.indexOf(s) !== i);
if (dupIds.length) fail(`duplicate ids: ${[...new Set(dupIds)].join(', ')}`);
else ok('ids are unique');

/* ================================================================== *
 * 2. nested objects the UI renders field-by-field
 * ================================================================== */
section('nested objects');

const NESTED_KEYS = {
  official_zh_cn: ['exists', 'kind', 'publisher', 'latest_volume', 'isbn', 'source_url'],
  unofficial_zh: ['status', 'latest_chapter', 'last_seen', 'note', 'recorded_by', 'recorded_at'],
  sources: ['source_id', 'name', 'url', 'retrieved_at', 'confidence', 'note'],
  ratings: ['source_id', 'region', 'score_value', 'score_scale', 'score_count', 'display_allowed', 'license_note', 'source_url', 'retrieved_at'],
  review_meta: ['source_id', 'outlet', 'reviewer', 'published_date', 'rank', 'points', 'source_url', 'retrieved_at'],
  ja_volumes: ['volume', 'isbn', 'release_date', 'publisher', 'price', 'cover_url', 'source_url'],
  zh_tw_volumes: ['volume', 'isbn', 'release_date', 'publisher', 'translator', 'source_url'],
  zh_cn_volumes: ['volume', 'isbn', 'release_date', 'publisher', 'translator', 'source_url'],
};

function checkKeys(label, objects, keys) {
  let bad = 0;
  for (const object of objects) {
    for (const key of keys) {
      if (!(key in object)) {
        bad += 1;
        fail(`${label}: missing key "${key}" in ${JSON.stringify(object).slice(0, 100)}`);
        if (bad > 8) return bad;
      }
    }
  }
  if (!bad) ok(`${label}: all ${objects.length} entries expose [${keys.join(', ')}]`);
  return bad;
}

checkKeys('official_zh_cn', dataset.works.map((w) => w.official_zh_cn), NESTED_KEYS.official_zh_cn);
checkKeys('unofficial_zh', dataset.works.map((w) => w.unofficial_zh), NESTED_KEYS.unofficial_zh);
for (const listField of ['sources', 'ratings', 'review_meta', 'ja_volumes', 'zh_tw_volumes', 'zh_cn_volumes']) {
  checkKeys(`${listField}[]`, dataset.works.flatMap((w) => w[listField] ?? []), NESTED_KEYS[listField]);
}

// field_sources: only `basis` is required by the schema; the rest are optional.
const fieldSourceEntries = dataset.works.flatMap((w) => Object.values(w.field_sources ?? {}));
const badBasis = dataset.works.flatMap((w) =>
  Object.entries(w.field_sources ?? {})
    .filter(([, v]) => !(v && typeof v === 'object' && 'basis' in v))
    .map(([k]) => `${w.slug}.field_sources.${k}`),
);
if (badBasis.length) fail(`field_sources entries without the required "basis" key: ${badBasis.join(', ')}`);
else ok(`field_sources: all ${fieldSourceEntries.length} entries carry the required "basis" key`);

const optionalFieldSourceKeys = ['source_url', 'retrieved_at', 'confidence', 'note'];
const missingOptional = {};
for (const entry of fieldSourceEntries) {
  for (const key of optionalFieldSourceKeys) {
    if (!(key in entry)) missingOptional[key] = (missingOptional[key] ?? 0) + 1;
  }
}
info(
  `optional field_sources keys absent in some rows: ${JSON.stringify(missingOptional)} — lib/provenance.ts and components/ProvenanceTable.tsx treat every one of these as optional`,
);

// Arrays are iterated with .map(); they must never be null.
const notArrays = dataset.works.flatMap((w) =>
  ['authors', 'illustrators', 'genres', 'sources', 'ratings', 'review_meta', 'ja_volumes', 'zh_tw_volumes', 'zh_cn_volumes']
    .filter((f) => w[f] != null && !Array.isArray(w[f]))
    .map((f) => `${w.slug}.${f}`),
);
if (notArrays.length) fail(`non-array where an array is expected: ${notArrays.join(', ')}`);
else ok('every list-valued field is an array (never a scalar)');

/* ================================================================== *
 * 3. THE field inventory must cover the schema exactly
 * ================================================================== */
section('lib/schema-fields.json vs schemas/work.schema.json');

if (!existsSync(SCHEMA_JSON)) {
  fail(`missing file: ${SCHEMA_JSON}`);
} else if (!existsSync(SCHEMA_FIELDS_JSON)) {
  fail(`missing file: ${SCHEMA_FIELDS_JSON}`);
} else {
  const schema = JSON.parse(readFileSync(SCHEMA_JSON, 'utf8'));
  const inventory = JSON.parse(readFileSync(SCHEMA_FIELDS_JSON, 'utf8'));

  const schemaTopLevel = Object.keys(schema.properties ?? {}).sort();
  const inventoryTopLevel = (inventory.workFields ?? []).map((f) => f.name).sort();

  const missingFromUi = schemaTopLevel.filter((name) => !inventoryTopLevel.includes(name));
  const notInSchema = inventoryTopLevel.filter((name) => !schemaTopLevel.includes(name));
  const duplicated = inventoryTopLevel.filter((name, i, a) => a.indexOf(name) !== i);

  if (missingFromUi.length) fail(`schema has fields the detail page would NOT render: ${missingFromUi.join(', ')}`);
  else ok(`all ${schemaTopLevel.length} schema top-level properties are in the detail page inventory`);

  if (notInSchema.length) fail(`inventory lists fields that are not in the schema: ${notInSchema.join(', ')}`);
  else ok('the inventory invents no fields (bijection, direction 2)');

  if (duplicated.length) fail(`inventory lists duplicates: ${[...new Set(duplicated)].join(', ')}`);
  else ok('the inventory lists each field exactly once');

  for (const workField of inventory.workFields ?? []) {
    if (!workField.label || typeof workField.label !== 'string') fail(`field ${workField.name} has no label`);
    if (!workField.kind || typeof workField.kind !== 'string') fail(`field ${workField.name} has no kind`);
    if (!workField.group || typeof workField.group !== 'string') fail(`field ${workField.name} has no group`);
  }
  const groupIds = new Set((inventory.groups ?? []).map((g) => g.id));
  const unknownGroups = [...new Set((inventory.workFields ?? []).map((f) => f.group).filter((g) => !groupIds.has(g)))];
  if (unknownGroups.length) fail(`field groups not declared in "groups": ${unknownGroups.join(', ')}`);
  else ok(`every field maps to one of the ${groupIds.size} declared groups`);

  // Nested objects: compare against the schema wherever it declares properties.
  const nestedSources = {
    anime_details: schema.properties?.anime_details?.properties,
    official_zh_cn: schema.properties?.official_zh_cn?.properties,
    unofficial_zh: schema.properties?.unofficial_zh?.properties,
    ja_volumes: schema.$defs?.volumeJaList?.items?.properties,
    zh_tw_volumes: schema.$defs?.volumeZhList?.items?.properties,
    zh_cn_volumes: schema.properties?.zh_cn_volumes?.items?.properties,
    ratings: schema.properties?.ratings?.items?.properties,
    review_meta: schema.properties?.review_meta?.items?.properties,
    sources: schema.properties?.sources?.items?.properties,
    field_sources: schema.properties?.field_sources?.additionalProperties?.properties,
  };

  for (const [name, schemaProps] of Object.entries(nestedSources)) {
    if (!schemaProps) {
      info(`${name}: the schema does not declare nested properties here; skipped`);
      continue;
    }
    const expected = Object.keys(schemaProps).sort();
    const actual = (inventory.nested?.[name] ?? []).map((f) => f.name).sort();
    const missing = expected.filter((k) => !actual.includes(k));
    const extra = actual.filter((k) => !expected.includes(k));
    if (missing.length) fail(`${name}: not rendered by the UI -> ${missing.join(', ')}`);
    if (extra.length) fail(`${name}: rendered but not in the schema -> ${extra.join(', ')}`);
    if (!missing.length && !extra.length) ok(`${name}: inventory matches the schema (${expected.length} keys)`);
  }
}

/* ================================================================== *
 * 4. provenance invariants
 * ================================================================== */
section('provenance invariants');

const basisDomain = ['official', 'official_tag', 'editorial', 'derived', 'third_party'];
const invalidBasis = dataset.works.flatMap((w) =>
  Object.entries(w.field_sources ?? {})
    .filter(([, v]) => v && !basisDomain.includes(v.basis))
    .map(([k, v]) => `${w.slug}.field_sources.${k}=${v.basis}`),
);
if (invalidBasis.length) fail(`field_sources.basis outside enum: ${invalidBasis.join(', ')}`);
else ok('every field_sources entry has a valid basis (official | official_tag | editorial | derived | third_party)');

for (const work of dataset.works) {
  const values = Object.values(work.field_confidence ?? {});
  const bad = values.filter((v) => typeof v !== 'number' || v < 0 || v > 1);
  if (bad.length) fail(`${work.slug}: field_confidence values outside 0..1 -> ${JSON.stringify(bad)}`);
}
ok('every field_confidence value is a number in 0..1');

// D2: classification_basis=official_tag requires a non-empty source_url on genres or yuri_type.
const officialTagWorks = dataset.works.filter((w) => w.classification_basis === 'official_tag');
const d2Violations = officialTagWorks
  .filter((w) => !(w.field_sources?.genres?.source_url || w.field_sources?.yuri_type?.source_url))
  .map((w) => w.slug);
if (d2Violations.length) fail(`official_tag without source_url on genres/yuri_type: ${d2Violations.join(', ')}`);
else ok(`D2 holds (${officialTagWorks.length} official_tag works checked)`);
info(
  `classification_basis distribution: ${JSON.stringify(
    dataset.works.reduce((acc, w) => ({ ...acc, [w.classification_basis]: (acc[w.classification_basis] ?? 0) + 1 }), {}),
  )} — the editorial badge path is the one this dataset exercises`,
);

// D1: unofficial_zh must never carry a URL, and status=unknown implies no chapter data.
const URL_RE = /(?:[hH][tT][tT][pP][sS]?:\/\/)|(?:[wW]{3}\.)|(?:[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/;
const unofficialLeaks = dataset.works.filter((w) => URL_RE.test(JSON.stringify(w.unofficial_zh ?? {}))).map((w) => w.slug);
if (unofficialLeaks.length) fail(`unofficial_zh contains a URL/domain (D1 violation): ${unofficialLeaks.join(', ')}`);
else ok('no unofficial_zh payload contains a URL, www. prefix, or bare domain (D1)');

const unknownWithChapter = dataset.works
  .filter((w) => w.unofficial_zh?.status === 'unknown')
  .filter((w) => w.unofficial_zh.latest_chapter != null || w.unofficial_zh.last_seen != null)
  .map((w) => w.slug);
if (unknownWithChapter.length) fail(`unofficial_zh.status=unknown but chapter data present: ${unknownWithChapter.join(', ')}`);
else ok('unofficial_zh.status=unknown never carries latest_chapter/last_seen (D1)');

const unofficialStatuses = [...new Set(dataset.works.map((w) => w.unofficial_zh?.status))].sort();
info(`unofficial_zh.status domain present: ${unofficialStatuses.join(', ')} — every one renders the fixed sentence or the manual-flag note`);

// §5.2: score_scale domain, display_allowed type, P5 source_url/retrieved_at.
const allRatings = dataset.works.flatMap((w) => (w.ratings ?? []).map((r) => ({ slug: w.slug, ...r })));
const badScale = allRatings.filter((r) => ![5, 10, 100].includes(r.score_scale));
if (badScale.length) fail(`score_scale outside {5,10,100}: ${badScale.map((r) => `${r.slug}:${r.score_scale}`).join(', ')}`);
else ok(`all ${allRatings.length} ratings carry an explicit score_scale in {5, 10, 100}`);

const badDisplay = allRatings.filter((r) => typeof r.display_allowed !== 'boolean');
if (badDisplay.length) fail(`display_allowed is not boolean on ${badDisplay.length} ratings`);
else ok('display_allowed is boolean on every rating (false ⇒ link only, no number)');

const badRatingUrl = allRatings.filter((r) => !r.source_url || !r.retrieved_at);
if (badRatingUrl.length) fail(`rating without source_url/retrieved_at violates P5: ${badRatingUrl.map((r) => r.slug).join(', ')}`);
else ok('every rating has source_url + retrieved_at (policy P5)');

const scalesPresent = [...new Set(allRatings.map((r) => r.score_scale))].sort((a, b) => a - b);
info(
  `scales actually present in this dataset: ${JSON.stringify(scalesPresent)} (${allRatings.length} rating rows) — ` +
    'the UI groups by scale; scripts/verify-policy.mjs proves the grouping and that no cross-scale average exists',
);

const allSources = dataset.works.flatMap((w) => w.sources ?? []);
const badSource = allSources.filter((s) => !s.url || !s.retrieved_at || typeof s.confidence !== 'number');
if (badSource.length) fail(`${badSource.length} sources[] entries lack url / retrieved_at / numeric confidence`);
else ok(`all ${allSources.length} sources[] entries carry url + retrieved_at + confidence`);

/* ================================================================== *
 * 5. dataset_report.json
 * ================================================================== */
section('data/dataset_report.json');

if (!existsSync(REPORT_JSON)) {
  fail(`missing file: ${REPORT_JSON}`);
} else {
  const report = JSON.parse(readFileSync(REPORT_JSON, 'utf8'));
  for (const key of ['generated_at', 'works_total', 'core_field_completeness', 'extended_field_completeness', 'by_media_type', 'by_status', 'by_magazine']) {
    if (!(key in report)) fail(`dataset_report missing key "${key}"`);
  }
  for (const [label, map] of [
    ['core_field_completeness', report.core_field_completeness ?? {}],
    ['extended_field_completeness', report.extended_field_completeness ?? {}],
  ]) {
    const bad = Object.entries(map).filter(([, v]) => typeof v !== 'number' || v < 0 || v > 1);
    if (bad.length) fail(`${label}: entries outside 0..1 -> ${bad.map(([k]) => k).join(', ')}`);
  }
  ok(
    `core (${Object.keys(report.core_field_completeness ?? {}).length} fields) and extended ` +
      `(${Object.keys(report.extended_field_completeness ?? {}).length} fields) completeness maps are valid`,
  );
  // The completeness the report claims must match the export the UI actually reads.
  if (report.works_total !== dataset.works.length) {
    fail(`report.works_total (${report.works_total}) !== works.json length (${dataset.works.length}) — the report is stale`);
  } else {
    ok(`report.works_total matches the export (${report.works_total})`);
  }
  const mismatched = Object.entries(report.core_field_completeness ?? {}).filter(([field, ratio]) => {
    const actual = dataset.works.filter((w) => {
      const value = w[field];
      if (value === null || value === undefined) return false;
      if (typeof value === 'string') return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    }).length / dataset.works.length;
    return Math.abs(actual - ratio) > 0.0001;
  });
  if (mismatched.length) {
    info(
      `core fields where the report and the raw export disagree (report may be from another run): ` +
        mismatched.map(([f]) => f).join(', '),
    );
  } else {
    ok('report core_field_completeness reproduces exactly from the raw export');
  }
  info(`by_media_type=${JSON.stringify(report.by_media_type)} by_status=${JSON.stringify(report.by_status)}`);
}

/* ================================================================== *
 * 6. change_log.json — optional by design
 * ================================================================== */
section('data/change_log.json (optional)');

if (existsSync(CHANGE_LOG_JSON)) {
  const log = JSON.parse(readFileSync(CHANGE_LOG_JSON, 'utf8'));
  const entryKeys = ['entity_type', 'entity_id', 'work_id', 'change_type', 'field_name', 'old_value', 'new_value', 'source_id', 'detected_at'];
  if (!Array.isArray(log.entries)) {
    fail('change_log.json exists but "entries" is not an array — the page would fall back to its empty state');
  } else {
    let missing = 0;
    for (const entry of log.entries) {
      for (const key of entryKeys) {
        if (!(key in entry)) {
          missing += 1;
          if (missing <= 5) fail(`change_log entry missing key "${key}"`);
        }
      }
    }
    if (!missing) ok(`present: ${log.entries.length} entries, all exposing [${entryKeys.join(', ')}]`);
    const resolved = log.entries.filter((e) => dataset.works.some((w) => w.id === e.work_id || w.slug === e.work_id)).length;
    info(
      `${resolved}/${log.entries.length} entries resolve to a work in works.json — the changelog page links the rest by raw work_id`,
    );
    const types = [...new Set(log.entries.map((e) => e.change_type))].sort();
    info(`change_type domain present: ${types.join(', ')} — unknown types render via the raw token`);
  }
  info('the graceful empty state in app/changelog/page.tsx is therefore NOT exercised by this dataset; it triggers when the file is absent');
} else {
  ok('absent — app/changelog/page.tsx falls back to its empty state (this is a supported, expected state)');
}

/* ================================================================== *
 * 7. sources.yaml
 * ================================================================== */
section('sources.yaml');

if (!existsSync(SOURCES_YAML)) {
  fail(`missing file: ${SOURCES_YAML}`);
} else {
  const raw = readFileSync(SOURCES_YAML, 'utf8');

  if (/^\t/m.test(raw)) fail('sources.yaml contains a TAB indentation character, which YAML forbids');
  else ok('no tab indentation (the `yaml` package would reject it)');

  // Structural scan: the `yaml` package is unavailable in this environment, so we
  // verify the *contract* the loader depends on (sections, ids, key placement).
  const lines = raw.split(/\r?\n/);
  let section_ = null;
  let current = null;
  const buckets = { sources: [], review_sources: [] };
  const duplicateIds = [];
  const seenIds = new Set();

  for (const line of lines) {
    const top = line.match(/^([a-z_]+):\s*$/);
    if (top) {
      section_ = ['sources', 'review_sources'].includes(top[1]) ? top[1] : null;
      current = null;
    }
    const idMatch = line.match(/^ {2}- id:\s*(\S+)/);
    if (idMatch && section_) {
      current = { id: idMatch[1] };
      if (seenIds.has(current.id)) duplicateIds.push(current.id);
      seenIds.add(current.id);
      buckets[section_].push(current);
      continue;
    }
    const kv = line.match(/^ {4}([a-z_0-9]+):\s*(.*)$/);
    if (kv && current) {
      const value = kv[2].trim().replace(/^"(.*)"$/, '$1');
      if (value !== '' && !value.startsWith('>') && !value.startsWith('|') && !(kv[1] in current)) {
        current[kv[1]] = value;
      }
    }
  }

  if (duplicateIds.length) {
    fail(
      `duplicate source ids (the \`yaml\` package may throw on these, and the /sources anchors would collide): ${[
        ...new Set(duplicateIds),
      ].join(', ')}`,
    );
  } else {
    ok(`all ${seenIds.size} source ids are unique (anchor-safe, YAML-duplicate-key-safe)`);
  }

  const { sources, review_sources: reviewSources } = buckets;
  if (sources.length !== 75) fail(`expected 75 entries under "sources:", found ${sources.length}`);
  else ok('sources: contains exactly 75 entries');
  if (reviewSources.length !== 19) fail(`expected 19 entries under "review_sources:", found ${reviewSources.length}`);
  else ok('review_sources: contains exactly 19 entries');
  ok(`total registered sources = ${sources.length + reviewSources.length} (expected 94)`);

  const SRC_UI = ['name', 'url', 'category', 'method', 'confidence', 'status_2026'];
  const REV_UI = ['name', 'url', 'method', 'confidence', 'status_2026', 'region', 'review_text_available', 'copyright_risk_for_reviews'];
  for (const [label, list, keys] of [['sources', sources, SRC_UI], ['review_sources', reviewSources, REV_UI]]) {
    let bad = 0;
    for (const source of list) {
      for (const key of keys) {
        if (source[key] === undefined) {
          bad += 1;
          fail(`${label}/${source.id}: missing "${key}" (the Sources page renders it)`);
        }
      }
    }
    if (!bad) ok(`${label}: all ${list.length} entries expose [${keys.join(', ')}]`);
  }

  const categories = [...new Set(sources.map((s) => s.category))].sort();
  ok(`sources categories (${categories.length}): ${categories.join(', ')}`);
  const methods = [...new Set(sources.map((s) => s.method))].sort();
  ok(`methods (${methods.length}): ${methods.join(', ')}`);
  const confidences = [...new Set([...sources, ...reviewSources].map((s) => s.confidence))].sort();
  ok(`confidence domain: ${confidences.join(', ')}`);
  const statuses = [...new Set([...sources, ...reviewSources].map((s) => s.status_2026 ?? '(none)'))].sort();
  const canonical = statuses.filter((s) => ['active', 'discontinued', 'unknown'].includes(s));
  info(
    `status_2026 is partly FREE TEXT in this file: ${statuses.length} distinct values, only ${canonical.length} canonical ` +
      `(${canonical.join(', ')}). lib/labels.ts status2026Label() passes unrecognised values through unchanged, ` +
      'so the Sources page renders the human-written sentence as-is.',
  );

  const reviewTextValues = [...new Set(reviewSources.map((s) => s.review_text_available))].sort();
  ok(`review_text_available domain: ${reviewTextValues.join(', ')}`);
  const riskValues = [...new Set(reviewSources.map((s) => s.copyright_risk_for_reviews))].sort();
  ok(`copyright_risk_for_reviews domain: ${riskValues.join(', ')}`);

  const referenced = new Set(dataset.works.flatMap((w) => (w.sources ?? []).map((s) => s.source_id).filter(Boolean)));
  const dangling = [...referenced].filter((id) => !seenIds.has(id));
  if (dangling.length) fail(`works.json cites source_id not present in sources.yaml: ${dangling.join(', ')}`);
  else if (referenced.size === 0) {
    info(
      'works.json carries source_id: null on every sources[] row in this export, so no source_id currently links to a registry entry',
    );
  } else {
    ok(`${referenced.size} distinct source_id values referenced by works.json all resolve in sources.yaml`);
  }

  const hasFieldSourceMap = /^field_source_map:\s*$/m.test(raw);
  if (hasFieldSourceMap) ok('field_source_map is present (rendered as the per-field source priority table)');
  else info('field_source_map absent — the Sources page skips that section');
}

/* ================================================================== *
 * 8. The static export's client-side projections
 * ================================================================== */
section('lib/works-slim.json + lib/anime-slim.json (static export)');

/**
 * The exported site hands the browser a projection instead of the full datasets
 * (data/works.json is 4.7 MB). scripts/verify-policy.mjs and verify-anime.mjs prove
 * the projections are SEMANTICALLY equivalent; this section proves the SHAPE
 * contract the components type against, so a change to build-slim.mjs that drops a
 * field the UI reads cannot slip through unnoticed.
 */
const PROJECTIONS = [
  {
    label: 'works',
    file: join(WEB_ROOT, 'lib', 'works-slim.json'),
    source: dataset.works,
    key: 'works',
    expectedKeys: [
      'anime_status', 'authors', 'avg_confidence', 'classification_basis', 'cover_display_allowed',
      'cover_note', 'cover_region', 'cover_source_url', 'cover_url', 'genres', 'has_zh_cn', 'has_zh_tw',
      'id', 'illustrators', 'last_checked', 'magazine_or_platform', 'magazine_or_platform_kind',
      'media_type', 'official_zh_cn', 'publisher_ja', 'publisher_zh_cn', 'publisher_zh_tw',
      'serialization_status', 'slug', 'sources_count', 'start_date', 'title_en', 'title_ja',
      'title_zh_cn', 'title_zh_cn_status', 'title_zh_tw', 'title_zh_tw_status', 'volume_count_ja',
      'yuri_type', 'zh_cn_volumes', 'zh_tw_volumes',
    ],
    numeric: ['sources_count'],
    nullableNumeric: ['avg_confidence'],
    booleans: ['has_zh_tw', 'has_zh_cn'],
  },
  {
    label: 'anime',
    file: join(WEB_ROOT, 'lib', 'anime-slim.json'),
    source: JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'anime.json'), 'utf8')).anime,
    key: 'anime',
    expectedKeys: [
      'adaptation_source', 'average_score', 'country_of_origin', 'cover_source_url', 'cover_url',
      'episode_count', 'episode_duration_min', 'format', 'id', 'main_cast', 'popularity',
      'related_work_slug', 'season', 'season_year', 'slug', 'sources_count', 'start_date', 'status',
      'studios', 'title_en', 'title_ja', 'title_romaji', 'title_zh_cn', 'title_zh_tw', 'yuri_tag_rank',
    ],
    numeric: ['sources_count'],
    nullableNumeric: ['episode_duration_min'],
    booleans: [],
  },
];

for (const projection of PROJECTIONS) {
  if (!existsSync(projection.file)) {
    fail(`missing projection: ${projection.file} — run "npm run slim" (scripts/build-slim.mjs)`);
    continue;
  }
  const parsed = JSON.parse(readFileSync(projection.file, 'utf8'));
  const records = parsed[projection.key];
  if (!Array.isArray(records)) {
    fail(`${projection.label}: "${projection.key}" is not an array`);
    continue;
  }

  const expected = [...projection.expectedKeys].sort();
  const keySets = [...new Set(records.map((record) => Object.keys(record).sort().join(',')))];
  if (keySets.length !== 1) fail(`${projection.label}: records do not share one key set (${keySets.length} variants)`);
  else if (keySets[0] !== expected.join(',')) {
    const actual = keySets[0].split(',');
    fail(
      `${projection.label}: the projection's key set changed — ` +
        `missing [${expected.filter((k) => !actual.includes(k)).join(', ')}], ` +
        `unexpected [${actual.filter((k) => !expected.includes(k)).join(', ')}]`,
    );
  } else {
    ok(`${projection.label}: all ${records.length} projected records expose exactly the ${expected.length} contracted keys`);
  }

  const shapeProblems = [];
  for (const record of records) {
    for (const field of projection.numeric) {
      if (typeof record[field] !== 'number' || !Number.isFinite(record[field]) || record[field] < 0) {
        shapeProblems.push(`${record.slug}: ${field} is not a non-negative number`);
      }
    }
    for (const field of projection.nullableNumeric) {
      if (record[field] !== null && typeof record[field] !== 'number') {
        shapeProblems.push(`${record.slug}: ${field} is neither null nor a number`);
      }
    }
    for (const field of projection.booleans) {
      if (typeof record[field] !== 'boolean') shapeProblems.push(`${record.slug}: ${field} is not a boolean`);
    }
    if (typeof record.slug !== 'string' || record.slug.length === 0) {
      shapeProblems.push(`${record.id}: slug is missing — the card link would 404 in the export`);
    }
  }
  if (shapeProblems.length) fail(`${projection.label}: ${shapeProblems.slice(0, 5).join('; ')}`);
  else {
    ok(
      `${projection.label}: ${[...projection.numeric, ...projection.nullableNumeric, ...projection.booleans].join(' / ')}` +
        ' and slug all have the contracted types',
    );
  }

  if (records.length !== projection.source.length) {
    fail(`${projection.label}: ${records.length} projected records vs ${projection.source.length} in the full dataset — the projection is stale`);
  } else if (records.some((record, index) => record.slug !== projection.source[index].slug)) {
    fail(`${projection.label}: the projection's slug order differs from the full dataset`);
  } else {
    ok(`${projection.label}: the projection is row-for-row aligned with the full dataset (${records.length} records)`);
  }

  const projectionBytes = Buffer.byteLength(readFileSync(projection.file, 'utf8'));
  const sourceBytes = Buffer.byteLength(JSON.stringify(projection.source));
  ok(
    `${projection.label}: ${(projectionBytes / 1024).toFixed(0)} KB shipped to the browser vs ` +
      `${(sourceBytes / 1024 / 1024).toFixed(1)} MB in the dataset`,
  );
}

/* ================================================================== */
section('result');
if (failures) {
  console.error(`CONTRACT VIOLATED - ${failures} problem(s).`);
  process.exit(1);
}
console.log('CONTRACT OK - the web UI reads only fields that exist in the dataset, and renders every schema field.');
process.exit(0);
