#!/usr/bin/env node
/**
 * Phase 4 · dataset reconnaissance.
 *
 * Prints the *actual* value distributions of `data/works.json` so the UI never
 * assumes a value that is not there (e.g. "all ratings have a score").
 *
 * Run:  node scripts/inspect-dataset.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataset = JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'works.json'), 'utf8'));
const works = dataset.works;

const tally = (values) => {
  const out = {};
  for (const v of values) {
    const k = v === null ? 'null' : v === undefined ? 'undefined' : String(v);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};
const show = (label, obj) => {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  console.log(`\n${label}`);
  for (const [k, n] of entries) console.log(`  ${String(n).padStart(3)}  ${k.length > 90 ? k.slice(0, 90) + '…' : k}`);
};

console.log(`dataset.generated_at = ${dataset.generated_at}`);
console.log(`works = ${works.length}`);

show('media_type', tally(works.map((w) => w.media_type)));
show('serialization_status', tally(works.map((w) => w.serialization_status)));
show('yuri_type', tally(works.map((w) => w.yuri_type)));
show('classification_basis', tally(works.map((w) => w.classification_basis)));
show('anime_status', tally(works.map((w) => w.anime_status)));
show('magazine_or_platform_kind', tally(works.map((w) => w.magazine_or_platform_kind)));
show('magazine_or_platform_active', tally(works.map((w) => w.magazine_or_platform_active)));
show('official_zh_cn.kind', tally(works.map((w) => w.official_zh_cn.kind)));
show('official_zh_cn.exists', tally(works.map((w) => w.official_zh_cn.exists)));
show('unofficial_zh.status', tally(works.map((w) => w.unofficial_zh.status)));

console.log('\nnull-ness of every top-level field (null/absent = the UI must print "unknown")');
const keys = [...new Set(works.flatMap((w) => Object.keys(w)))].sort();
for (const k of keys) {
  const absent = works.filter((w) => !(k in w)).length;
  const isNull = works.filter((w) => w[k] === null).length;
  const emptyArr = works.filter((w) => Array.isArray(w[k]) && w[k].length === 0).length;
  const arr = works.filter((w) => Array.isArray(w[k])).length;
  const nonNull = works.length - absent - isNull - (arr ? emptyArr : 0);
  console.log(
    `  ${k.padEnd(30)} populated=${String(nonNull).padStart(2)}  null=${String(isNull).padStart(2)}` +
      (arr ? `  emptyArray=${String(emptyArr).padStart(2)}/${arr}` : '') +
      (absent ? `  ABSENT_KEY=${absent}` : ''),
  );
}

console.log('\nfield_sources: which field names carry provenance, and with which basis');
const fsKeys = {};
for (const w of works) {
  for (const [field, meta] of Object.entries(w.field_sources ?? {})) {
    fsKeys[field] ??= { count: 0, basis: {} };
    fsKeys[field].count += 1;
    fsKeys[field].basis[meta.basis] = (fsKeys[field].basis[meta.basis] ?? 0) + 1;
  }
}
for (const [field, info] of Object.entries(fsKeys).sort()) {
  console.log(`  ${field.padEnd(30)} ${String(info.count).padStart(2)} works  ${JSON.stringify(info.basis)}`);
}

console.log('\nfield_sources entries missing optional keys (UI treats these as optional)');
const optKeys = ['source_url', 'retrieved_at', 'confidence', 'note'];
const missing = {};
for (const w of works) {
  for (const meta of Object.values(w.field_sources ?? {})) {
    for (const k of optKeys) if (!(k in meta)) missing[k] = (missing[k] ?? 0) + 1;
  }
}
console.log(`  ${JSON.stringify(missing)} (of ${works.reduce((n, w) => n + Object.keys(w.field_sources ?? {}).length, 0)} field_sources entries)`);

console.log('\nfield_confidence: which fields carry a confidence value');
const fcKeys = tally(works.flatMap((w) => Object.keys(w.field_confidence ?? {})));
show('field_confidence keys', fcKeys);

console.log('\ncollections (the UI must render an explicit empty state for each)');
const coll = {
  'sources[]': works.flatMap((w) => w.sources ?? []).length,
  'ratings[]': works.flatMap((w) => w.ratings ?? []).length,
  'review_meta[]': works.flatMap((w) => w.review_meta ?? []).length,
  'ja_volumes[]': works.flatMap((w) => w.ja_volumes ?? []).length,
  'zh_tw_volumes[]': works.flatMap((w) => w.zh_tw_volumes ?? []).length,
  'zh_cn_volumes[]': works.flatMap((w) => w.zh_cn_volumes ?? []).length,
  'works with >=1 source': works.filter((w) => (w.sources ?? []).length > 0).length,
  'works with >=1 rating': works.filter((w) => (w.ratings ?? []).length > 0).length,
  'works with >=1 review_meta': works.filter((w) => (w.review_meta ?? []).length > 0).length,
  'works with non-null anime_details': works.filter((w) => w.anime_details != null).length,
  'works with zh_tw edition (title|volumes|publisher)': works.filter(
    (w) => w.title_zh_tw != null || (w.zh_tw_volumes ?? []).length > 0 || w.publisher_zh_tw != null,
  ).length,
  'works with zh_cn edition (title|volumes|publisher|official.exists)': works.filter(
    (w) => w.title_zh_cn != null || (w.zh_cn_volumes ?? []).length > 0 || w.publisher_zh_cn != null || w.official_zh_cn.exists === true,
  ).length,
};
show('collections', coll);

console.log('\ntitle coverage (search must cover all four title languages)');
for (const f of ['title_ja', 'title_zh_tw', 'title_zh_cn', 'title_en']) {
  console.log(`  ${f.padEnd(14)} non-null ${works.filter((w) => w[f] != null).length}/${works.length}`);
}
console.log(`  authors non-empty ${works.filter((w) => (w.authors ?? []).length > 0).length}/${works.length}`);
console.log(`  illustrators non-empty ${works.filter((w) => (w.illustrators ?? []).length > 0).length}/${works.length}`);

console.log('\nslug samples:', works.slice(0, 5).map((w) => w.slug).join(', '));
