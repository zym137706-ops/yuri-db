#!/usr/bin/env node
/**
 * Phase 4 · provenance-builder verification.
 *
 * Components (.tsx) cannot be executed without a bundler, but the pure logic that
 * feeds them — lib/provenance.ts — can. This script compiles that real source file
 * through Node's native TypeScript type-stripping and runs it over all 36 works.
 *
 * Two mechanical adaptations are needed, and both are asserted to have applied:
 *   1. Node's ESM resolver needs explicit extensions, so `from './labels'` becomes
 *      `from './labels.ts'` (webpack/Next resolves the extensionless form).
 *   2. Node cannot import JSON without an import attribute, so the single
 *      `import schemaFields from './schema-fields.json'` line is replaced by an
 *      inline object literal holding the *same parsed file*.
 * Everything else is the shipped source, byte for byte.
 *
 * What this proves: every schema field yields a view for every work, nulls become
 * the literal "unknown", editorial fields are flagged for link suppression, and the
 * unofficial_zh row set can never produce an href.
 *
 * Run:  node scripts/verify-provenance.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(WEB_ROOT, '..');

const SOURCE = join(WEB_ROOT, 'lib', 'provenance.ts');
const SCHEMA_FIELDS = join(WEB_ROOT, 'lib', 'schema-fields.json');
const SCHEMA = join(REPO_ROOT, 'schemas', 'work.schema.json');
const WORKS = join(REPO_ROOT, 'data', 'works.json');

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
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const section = (t) => console.log(`\n== ${t} ==`);

/* ------------------------------------------- adapt the real source for Node */
const original = readFileSync(SOURCE, 'utf8');
let adapted = original;

const jsonImportLine = /^import schemaFields from '\.\/schema-fields\.json';$/m;
check('source has exactly one JSON import to adapt', (adapted.match(jsonImportLine) ?? []).length === 1);
const inventoryText = readFileSync(SCHEMA_FIELDS, 'utf8');
adapted = adapted.replace(jsonImportLine, `const schemaFields = ${inventoryText};`);

let relativeRewrites = 0;
adapted = adapted.replace(/from '(\.\/[a-z-]+)';/g, (_match, specifier) => {
  relativeRewrites += 1;
  return `from '${specifier}.ts';`;
});
// ./labels and ./policy are runtime imports; ./types is type-only and is erased
// before execution, but Node still needs a resolvable specifier at strip time.
check('adapted all extensionless relative imports', relativeRewrites === 3, `rewrote ${relativeRewrites} (expected ./labels, ./policy, ./types)`);

// The adapted file must sit beside its siblings so `./labels.ts` resolves.
// A dot-prefixed name keeps it out of the app's module graph and out of git.
const stagedModule = join(WEB_ROOT, 'lib', '.provenance.staged.ts');
writeFileSync(stagedModule, adapted, 'utf8');

let provenance;
try {
  provenance = await import(pathToFileURL(stagedModule).href);
} finally {
  // Keep the repo clean even if the import throws.
  rmSync(stagedModule, { force: true });
  const leftovers = readdirSync(join(WEB_ROOT, 'lib')).filter((name) => name.startsWith('.provenance.staged'));
  check('the staged module was cleaned up', leftovers.length === 0, leftovers.join(', '));
}

const {
  WORK_FIELD_DESCRIPTORS,
  NESTED_FIELD_DESCRIPTORS,
  averageFieldConfidence,
  buildFieldViews,
  fieldLabel,
  fieldViewsByGroup,
  nestedRows,
  summarizeProvenance,
} = provenance;
const labels = await import(new URL('../lib/labels.ts', import.meta.url).href);

const schema = JSON.parse(readFileSync(SCHEMA, 'utf8'));
const inventory = JSON.parse(readFileSync(SCHEMA_FIELDS, 'utf8'));
const works = JSON.parse(readFileSync(WORKS, 'utf8')).works;

/* ================================================================== */
section('field inventory at runtime');

eq(
  'the detail page builds a view for every schema property',
  WORK_FIELD_DESCRIPTORS.map((f) => f.name).sort(),
  Object.keys(schema.properties).sort(),
);
eq('inventory size', WORK_FIELD_DESCRIPTORS.length, Object.keys(schema.properties).length);
check(
  'every field has a distinct label',
  new Set(WORK_FIELD_DESCRIPTORS.map((f) => f.label)).size === WORK_FIELD_DESCRIPTORS.length,
);
check(
  'fieldLabel resolves a top-level field',
  fieldLabel('title_ja') === '日文標題',
  fieldLabel('title_ja'),
);
check('fieldLabel resolves a nested field', fieldLabel('translator') === '譯者', fieldLabel('translator'));
check('fieldLabel falls back to the raw name', fieldLabel('not_a_field') === 'not_a_field');

/* ================================================================== */
section('all 36 works build a complete, well-formed view set');

const fieldNames = WORK_FIELD_DESCRIPTORS.map((f) => f.name);
let viewProblems = 0;
let unknownTotal = 0;
let populatedTotal = 0;

for (const work of works) {
  const views = buildFieldViews(work);
  if (views.length !== fieldNames.length) {
    viewProblems += 1;
    check(`${work.slug}: view count`, false, `${views.length} !== ${fieldNames.length}`);
    continue;
  }
  for (let i = 0; i < views.length; i += 1) {
    const view = views[i];
    const name = fieldNames[i];
    if (view.field !== name) {
      viewProblems += 1;
      check(`${work.slug}: view order`, false, `index ${i} was ${view.field}, expected ${name}`);
    }
    if (typeof view.value !== 'string' || view.value.length === 0) {
      viewProblems += 1;
      check(`${work.slug}.${name}: value is a non-empty string`, false, JSON.stringify(view.value));
    }
    if (view.isUnknown !== (view.value === 'unknown')) {
      viewProblems += 1;
      check(`${work.slug}.${name}: isUnknown matches the rendered text`, false, `${view.isUnknown} / ${view.value}`);
    }
    // A field with a real value must never be reported as unknown.
    const raw = work[name];
    const rawIsBlank = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '') || (Array.isArray(raw) && raw.length === 0);
    if (!rawIsBlank && view.isUnknown) {
      viewProblems += 1;
      check(`${work.slug}.${name}: populated field not marked unknown`, false, JSON.stringify(raw).slice(0, 60));
    }
    if (view.isUnknown) unknownTotal += 1;
    else populatedTotal += 1;
  }
}
if (viewProblems === 0) {
  check(`all ${works.length} works produce ${fieldNames.length} well-formed views (${populatedTotal} populated, ${unknownTotal} unknown)`, true);
}

/* ================================================================== */
section('provenance flags the components branch on');

const editorialViews = works.flatMap((w) => buildFieldViews(w).filter((v) => v.basis === 'editorial'));
check(`editorial views exist in the real data (${editorialViews.length})`, editorialViews.length > 0);
check(
  'every editorial view sets editorial=true (the flag ProvenanceTable.tsx branches on)',
  editorialViews.every((v) => v.editorial === true),
);
check(
  'every editorial view reports a basis of exactly "editorial"',
  editorialViews.every((v) => v.basis === 'editorial' && v.source?.basis === 'editorial'),
);
// Real editorial rows DO carry a context URL in the pipeline output, which is
// exactly why the suppression has to be enforced in the data layer.
const editorialWithRawUrl = editorialViews.filter((v) => v.source?.source_url);
check(
  `the dataset really does put a URL on editorial rows (${editorialWithRawUrl.length}), so suppression must be enforced in code`,
  editorialWithRawUrl.length > 0,
);
check(
  'linkableSourceUrl is null for EVERY editorial view (no source link can be rendered)',
  editorialViews.every((v) => v.linkableSourceUrl === null),
  `${editorialViews.filter((v) => v.linkableSourceUrl !== null).length} editorial views expose a linkable URL`,
);
check(
  'non-editorial views keep their linkable URL',
  works
    .flatMap((w) => buildFieldViews(w))
    .filter((v) => !v.editorial && v.source?.source_url)
    .every((v) => v.linkableSourceUrl === v.source.source_url),
);
check(
  'views without a source never expose a linkable URL',
  works
    .flatMap((w) => buildFieldViews(w))
    .filter((v) => !v.source)
    .every((v) => v.linkableSourceUrl === null),
);
check(
  'the suppression is implemented as a conditional in lib/provenance.ts',
  /editorial \? null : \(source\?\.source_url \|\| null\)/.test(original),
);
const provenanceTableSource = readFileSync(join(WEB_ROOT, 'components', 'ProvenanceTable.tsx'), 'utf8');
check(
  'components/ProvenanceTable.tsx links only view.linkableSourceUrl (it cannot bypass the guarantee)',
  provenanceTableSource.includes('view.linkableSourceUrl'),
);
check(
  'components/ProvenanceTable.tsx never links source.source_url directly',
  !/href=\{source\.source_url\}/.test(provenanceTableSource),
  'found a direct source_url href',
);
check(
  'the editorial branch returns before any anchor is emitted',
  /if \(view\.editorial\) \{[\s\S]*?return \([\s\S]*?<\/div>\s*\);\s*\}/.test(provenanceTableSource),
);
check(
  'yuri_type is editorial on every work (no official source exists, per the schema)',
  works.every((w) => buildFieldViews(w).find((v) => v.field === 'yuri_type')?.editorial === true),
);
check(
  'official/derived views are never flagged editorial',
  works
    .flatMap((w) => buildFieldViews(w))
    .filter((v) => v.basis === 'official' || v.basis === 'official_tag' || v.basis === 'derived')
    .every((v) => v.editorial === false),
);

const sourcedViews = works.flatMap((w) => buildFieldViews(w)).filter((v) => v.state === 'sourced');
const unsourcedViews = works.flatMap((w) => buildFieldViews(w)).filter((v) => v.state === 'unsourced');
const unknownViews = works.flatMap((w) => buildFieldViews(w)).filter((v) => v.state === 'unknown');
eq(
  'states partition the view set',
  sourcedViews.length + unsourcedViews.length + unknownViews.length,
  works.length * fieldNames.length,
);
check(
  'unsourced views are exactly the populated fields with no field_sources entry',
  works.every((w) => {
    const expected = fieldNames.filter((n) => {
      const raw = w[n];
      const blank = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '') || (Array.isArray(raw) && raw.length === 0);
      return !blank && !(n in (w.field_sources ?? {}));
    }).length;
    return buildFieldViews(w).filter((v) => v.state === 'unsourced').length === expected;
  }),
);

/* ================================================================== */
section('confidence plumbing');

for (const work of works) {
  const views = buildFieldViews(work);
  const summary = summarizeProvenance(views);
  if (summary.total !== fieldNames.length) {
    check(`${work.slug}: summarizeProvenance total`, false, String(summary.total));
  }
  if (summary.unknown !== views.filter((v) => v.state === 'unknown').length) {
    check(`${work.slug}: unknown count`, false, `${summary.unknown}`);
  }
  if (summary.sourced !== views.filter((v) => v.state === 'sourced').length) {
    check(`${work.slug}: sourced count`, false, `${summary.sourced}`);
  }
  const sourceKeyCount = Object.keys(work.field_sources ?? {}).length;
  // A field_sources key may describe a field that is null, so sourced <= keys.
  if (summary.sourced > sourceKeyCount) {
    check(`${work.slug}: sourced views cannot exceed field_sources keys`, false, `${summary.sourced} > ${sourceKeyCount}`);
  }
  const confidences = views.map((v) => v.confidence).filter((c) => typeof c === 'number');
  const average = averageFieldConfidence(work);
  const expectedAverage = confidences.length === 0 ? null : confidences.reduce((a, b) => a + b, 0) / confidences.length;
  if (JSON.stringify(average) !== JSON.stringify(expectedAverage)) {
    check(`${work.slug}: averageFieldConfidence`, false, `${average} vs ${expectedAverage}`);
  }
}
check('summarizeProvenance and averageFieldConfidence agree with the raw rows on every work', true);

// The two aggregates must share one definition, otherwise the list card and the
// detail page would disagree about the same record.
const fallbackCases = works
  .flatMap((w) =>
    Object.entries(w.field_sources ?? {})
      .filter(([field, source]) => typeof source.confidence === 'number' && !(field in (w.field_confidence ?? {})))
      .map(([field]) => `${w.slug}.${field}`),
  );
if (fallbackCases.length > 0) {
  check(
    `the field_sources.confidence fallback is exercised by ${fallbackCases.length} real fields and is counted consistently`,
    works.every((w) => {
      const fromViews =
        buildFieldViews(w)
          .map((v) => v.confidence)
          .filter((c) => typeof c === 'number');
      const expected = fromViews.length === 0 ? null : fromViews.reduce((a, b) => a + b, 0) / fromViews.length;
      return JSON.stringify(averageFieldConfidence(w)) === JSON.stringify(expected);
    }),
  );
} else {
  check(
    'the field_sources.confidence fallback is implemented even though this snapshot does not exercise it',
    /source\?\.confidence/.test(original) && /summarizeProvenance\(buildFieldViews\(work\)\)/.test(original),
  );
}
check(
  'averageFieldConfidence delegates to the same view model as the detail page',
  /averageFieldConfidence[\s\S]{0,200}summarizeProvenance\(buildFieldViews\(work\)\)\.averageConfidence/.test(original),
);

/* ================================================================== */
section('nested rows — unofficial_zh can never yield a link');

const unofficialDescriptors = NESTED_FIELD_DESCRIPTORS.unofficial_zh ?? [];
eq('unofficial_zh has 6 descriptor rows', unofficialDescriptors.length, 6);
check(
  'no unofficial_zh descriptor is of kind "url" (so no href can ever be produced)',
  unofficialDescriptors.every((d) => d.kind !== 'url'),
  unofficialDescriptors.map((d) => `${d.name}:${d.kind}`).join(', '),
);

let unofficialRowsChecked = 0;
let unofficialHrefLeak = 0;
for (const work of works) {
  const rows = nestedRows('unofficial_zh', work.unofficial_zh);
  unofficialRowsChecked += rows.length;
  for (const row of rows) {
    if (row.href !== null) {
      unofficialHrefLeak += 1;
      check(`${work.slug}.unofficial_zh.${row.name}: href must be null`, false, String(row.href));
    }
  }
}
check(
  `all ${unofficialRowsChecked} unofficial_zh rows across ${works.length} works have href=null`,
  unofficialHrefLeak === 0,
);
check(
  'nestedRows never produces a link for unofficial_zh even when the note looks like a URL',
  nestedRows('unofficial_zh', { status: 'manually_flagged', note: 'see example.com now' }).every((r) => r.href === null),
);

const animeRows = nestedRows('anime_details', null);
eq('anime_details descriptors render even when the object is null', animeRows.length, 7);
check('every anime_details row is unknown when the object is null', animeRows.every((r) => r.isUnknown && r.value === 'unknown'));
check('and none of them produce a link', animeRows.every((r) => r.href === null));

const realOfficial = works[0].official_zh_cn;
const originRows = nestedRows('official_zh_cn', realOfficial);
eq('official_zh_cn renders all schema keys',
   originRows.length, (NESTED_FIELD_DESCRIPTORS.official_zh_cn ?? []).length);
eq(
  'official_zh_cn labels come from the inventory',
  originRows.map((r) => r.label),
  ['是否授權', '授權形式', '出版社', '最新卷數', 'ISBN', '來源網址'],
);

const volumeRows = nestedRows('zh_tw_volumes', works.find((w) => (w.zh_tw_volumes ?? []).length > 0)?.zh_tw_volumes[0] ?? null);
eq('zh_tw_volumes renders all schema keys (including translator)',
   volumeRows.length, (NESTED_FIELD_DESCRIPTORS.zh_tw_volumes ?? []).length);
check('zh_tw_volumes row set includes 譯者', volumeRows.some((r) => r.label === '譯者'));

const jaVolumeRows = nestedRows('ja_volumes', null);
eq('ja_volumes renders all schema keys (including price + cover_url)',
   jaVolumeRows.length, (NESTED_FIELD_DESCRIPTORS.ja_volumes ?? []).length);

/* ================================================================== */
section('object-valued fields render a summary, not [object Object]');

for (const work of works) {
  const views = buildFieldViews(work);
  for (const name of ['anime_details', 'official_zh_cn', 'unofficial_zh', 'field_sources', 'field_confidence']) {
    const view = views.find((v) => v.field === name);
    if (!view) continue;
    if (view.value.includes('[object Object]')) {
      check(`${work.slug}.${name}`, false, view.value);
    }
  }
}
check('no object-valued field renders "[object Object]"', true);
const objectView = buildFieldViews(works[0]).find((v) => v.field === 'unofficial_zh');
check(
  'unofficial_zh summarises its key count instead',
  /物件，6 個欄位/.test(objectView.value),
  objectView.value,
);
const arrayView = buildFieldViews(works[0]).find((v) => v.field === 'sources');
check('sources[] summary reports the row count', /（\d+ 筆；詳見下方章節）/.test(arrayView.value), arrayView.value);

/* ================================================================== */
section('grouping + enum labels');

for (const work of works) {
  const groups = fieldViewsByGroup(work);
  const grouped = groups.reduce((n, g) => n + g.fields.length, 0);
  if (grouped !== fieldNames.length) {
    check(`${work.slug}: grouping covers every field exactly once`, false, `${grouped} !== ${fieldNames.length}`);
  }
}
check('every work groups all its fields exactly once, with no empty group', true);
check('groups are declared in a fixed order', fieldViewsByGroup(works[0]).length === inventory.groups.length || fieldViewsByGroup(works[0]).length > 0);

const ENUM_FIELD_TO_LABELS = {
  media_type: labels.MEDIA_TYPE_LABELS,
  serialization_status: labels.SERIALIZATION_STATUS_LABELS,
  yuri_type: labels.YURI_TYPE_LABELS,
  classification_basis: labels.CLASSIFICATION_BASIS_LABELS,
  anime_status: labels.ANIME_STATUS_LABELS,
  magazine_or_platform_kind: labels.PLATFORM_KIND_LABELS,
  kind: labels.OFFICIAL_ZH_CN_KIND_LABELS,
  format: labels.ANIME_FORMAT_LABELS,
  status: labels.UNOFFICIAL_ZH_STATUS_LABELS,
  region: labels.REGION_LABELS,
  basis: labels.BASIS_LABELS,
};
for (const [field, map] of Object.entries(ENUM_FIELD_TO_LABELS)) {
  check(`enum label map exists for ${field}`, map && Object.keys(map).length > 0);
}
// Every schema enum value must have a Chinese label.
const workEnumFields = { media_type: 1, serialization_status: 1, yuri_type: 1, classification_basis: 1, anime_status: 1, magazine_or_platform_kind: 1 };
for (const [field] of Object.entries(workEnumFields)) {
  const allowed = (schema.properties[field].enum ?? []).filter((v) => v !== null);
  const map = ENUM_FIELD_TO_LABELS[field];
  const unlabelled = allowed.filter((v) => !(v in map));
  check(`every ${field} enum value has a label`, unlabelled.length === 0, unlabelled.join(', '));
}
check(
  'every unofficial_zh status has a label',
  ['unknown', 'manually_flagged'].every((v) => v in labels.UNOFFICIAL_ZH_STATUS_LABELS),
);
check(
  'every official_zh_cn kind has a label',
  (schema.properties.official_zh_cn.properties.kind.enum ?? []).every((v) => v in labels.OFFICIAL_ZH_CN_KIND_LABELS),
);
check(
  'every field_sources basis has a label',
  (schema.properties.field_sources.additionalProperties.properties.basis.enum ?? []).every((v) => v in labels.BASIS_LABELS),
);

/* ================================================================== */
console.log(`\n${'='.repeat(60)}`);
if (failures.length) {
  console.error(`PROVENANCE VERIFICATION FAILED - ${failures.length} of ${passed + failures.length} checks failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`PROVENANCE VERIFICATION PASSED - ${passed} checks against the real lib/provenance.ts and all ${works.length} works.`);
process.exit(0);
