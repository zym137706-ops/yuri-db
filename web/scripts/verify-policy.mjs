#!/usr/bin/env node
/**
 * Phase 4 · rating-policy / unofficial_zh / filter verification.
 *
 * This script imports the ACTUAL application module `lib/policy.ts` and executes
 * it against the ACTUAL dataset `data/works.json`. Node 24 strips the types
 * natively, so the app's business rules can be verified without `npm install`.
 *
 * What it proves:
 *   §5.2  display_allowed=false ⇒ no number is ever produced, link only (P4)
 *   §5.2  score_scale is always surfaced, and scales are never averaged (P2/P3)
 *   D1    unofficial_zh can never yield a link, and unknown status yields the
 *         exact fixed sentence required by the spec
 *   —     the search/filter/URL-query logic returns correct results on the real
 *         36-work dataset, and filter state round-trips through the query string
 *
 * Run:  node scripts/verify-policy.mjs
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(WEB_ROOT, '..');

const policy = await import(new URL('../lib/policy.ts', import.meta.url).href);

const {
  ANIME_STATUSES,
  CROSS_SCALE_AVERAGE_IS_FORBIDDEN,
  MEDIA_TYPES,
  SERIALIZATION_STATUSES,
  UNOFFICIAL_ZH_UNKNOWN_SENTENCE,
  buildQueryString,
  confidenceBand,
  countActiveFilters,
  containsLinkLikeText,
  displayValue,
  filterAndSortWorks,
  formatRatingDisplay,
  formatTimestamp,
  groupRatingsByScale,
  matchesQuery,
  parseFilters,
  sortWorks,
  ungroupedRatings,
  workHasZhCnEdition,
  workHasZhTwEdition,
} = policy;

/* ------------------------------------------------------------------ harness */
let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}
const section = (t) => console.log(`\n== ${t} ==`);

const dataset = JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'works.json'), 'utf8'));
const works = dataset.works;

/* ================================================================== *
 * 1. §5.2 — a rating whose display_allowed is false yields no number
 * ================================================================== */
section('§5.2 P4 — display_allowed=false must yield link-only');

const blocked = formatRatingDisplay({
  source_id: 'rv_zh_cn_douban',
  region: 'zh_cn',
  score_value: 8.7,
  score_scale: 10,
  score_count: 1234,
  display_allowed: false,
  source_url: 'https://example.invalid/work/1',
  retrieved_at: '2026-10-09T04:37:46.548037+00:00',
});

eq('showNumber is false', blocked.showNumber, false);
eq('scoreText is null (no number anywhere)', blocked.scoreText, null);
eq('percent is null (no visual ratio either)', blocked.percent, null);
eq('countText is null (count is a display of the source too)', blocked.countText, null);
eq('outbound link is still provided', blocked.outboundUrl, 'https://example.invalid/work/1');
check('policy note cites P4', /P4/.test(blocked.policyNote), blocked.policyNote);
check(
  'no numeric score leaks into any rendered field',
  ![blocked.scoreText, blocked.countText, blocked.percent, blocked.policyNote, blocked.outboundLabel]
    .filter((v) => v !== null && v !== undefined)
    .some((v) => String(v).includes('8.7')),
  JSON.stringify(blocked),
);
eq('scale is still disclosed even when the number is not', blocked.scaleText, '10 分制');

/* ================================================================== *
 * 2. §5.2 P2 — scale is explicit and formatting respects it
 * ================================================================== */
section('§5.2 P2 — explicit score_scale');

const scale5 = formatRatingDisplay({
  region: 'ja',
  score_value: 4.2,
  score_scale: 5,
  score_count: 41,
  display_allowed: true,
  source_url: 'https://example.invalid/ja',
});
eq('5-point scale text', scale5.scoreText, '4.2 / 5');
eq('5-point scale label', scale5.scaleText, '5 分制');
eq('5-point count text', scale5.countText, '41 則評分');
eq('5-point percent', scale5.percent, 84);

const scale10 = formatRatingDisplay({ region: 'ja', score_value: 8.55, score_scale: 10, display_allowed: true, source_url: 'u' });
eq('10-point scale text rounds to 1 decimal', scale10.scoreText, '8.6 / 10');
eq('10-point scale label', scale10.scaleText, '10 分制');

const scale100 = formatRatingDisplay({ region: 'ja', score_value: 85.4, score_scale: 100, display_allowed: true, source_url: 'u' });
eq('100-point scale text is an integer', scale100.scoreText, '85 / 100');
eq('100-point scale label', scale100.scaleText, '100 分制');

const unknownScale = formatRatingDisplay({ region: 'ja', score_value: 4.5, score_scale: undefined, display_allowed: true, source_url: 'u' });
eq('unknown scale ⇒ no number shown', unknownScale.showNumber, false);
eq('unknown scale is named as such', unknownScale.scaleText, '口徑未知');

/* ================================================================== *
 * 3. §5.2 P3 — never average across scales
 * ================================================================== */
section('§5.2 P3 — scales are grouped, never averaged');

const mixed = [
  { source_id: 'rakuten', region: 'ja', score_value: 4.2, score_scale: 5, display_allowed: true, source_url: 'a' },
  { source_id: 'mal', region: 'ja', score_value: 8.1, score_scale: 10, display_allowed: true, source_url: 'b' },
  { source_id: 'anilist', region: 'ja', score_value: 79, score_scale: 100, display_allowed: true, source_url: 'c' },
  { source_id: 'douban', region: 'zh_cn', score_value: 8.9, score_scale: 10, display_allowed: false, source_url: 'd' },
  { source_id: 'mystery', region: 'zh_tw', score_value: 5, score_scale: 7, display_allowed: true, source_url: 'e' },
];

const groups = groupRatingsByScale(mixed);
eq('one group per known scale, in 5/10/100 order', groups.map((g) => g.scale), [5, 10, 100]);
eq('group sizes', groups.map((g) => g.items.length), [1, 2, 1]);
check(
  'every group contains only its own scale',
  groups.every((g) => g.items.every((r) => r.score_scale === g.scale)),
);
eq('the 10-point group counts only its displayable member', groups[1].displayableCount, 1);
eq('the off-scale row lands in the ungrouped bucket', ungroupedRatings(mixed).map((r) => r.source_id), ['mystery']);
eq(
  'no row is lost or duplicated across buckets',
  groups.reduce((n, g) => n + g.items.length, 0) + ungroupedRatings(mixed).length,
  mixed.length,
);
check(
  'groupRatingsByScale exposes no combined/average field',
  !groups.some((g) => 'average' in g || 'mean' in g || 'combined' in g),
);
check(
  'lib/policy exports no *function* that averages ratings',
  Object.entries(policy).filter(([key, value]) => typeof value === 'function' && /average|mean|combined|overall/i.test(key)).length === 0,
  `found: ${Object.entries(policy)
    .filter(([key, value]) => typeof value === 'function' && /average|mean|combined|overall/i.test(key))
    .map(([key]) => key)
    .join(', ')}`,
);
check(
  'the cross-scale prohibition is stated as an exportable constant the UI must render',
  typeof CROSS_SCALE_AVERAGE_IS_FORBIDDEN === 'string' && CROSS_SCALE_AVERAGE_IS_FORBIDDEN.length > 0,
);

/* ================================================================== *
 * 4. D1 — unofficial_zh
 * ================================================================== */
section('D1 — unofficial_zh policy');

eq(
  'the fixed sentence matches the specification byte-for-byte',
  UNOFFICIAL_ZH_UNKNOWN_SENTENCE,
  '本数据库只收录官方授权中文版信息。非官方翻译不在收录范围，因此不作标注。',
);

const unknownView = policy.formatUnofficialZh(works[0].unofficial_zh);
eq('real record status passes through', unknownView.status, 'unknown');
eq('unknown status shows the fixed sentence', unknownView.explanation, UNOFFICIAL_ZH_UNKNOWN_SENTENCE);
eq('hasLink is hard-coded false', unknownView.hasLink, false);

const unknownWorks = works.filter((w) => w.unofficial_zh?.status === 'unknown');
check(
  `all ${unknownWorks.length} unknown-status works render the fixed sentence`,
  unknownWorks.every((w) => policy.formatUnofficialZh(w.unofficial_zh).explanation === UNOFFICIAL_ZH_UNKNOWN_SENTENCE),
);
check(
  `every work (${works.length}) yields hasLink === false`,
  works.every((w) => policy.formatUnofficialZh(w.unofficial_zh).hasLink === false),
);

const dirty = policy.formatUnofficialZh({
  status: 'unknown',
  latest_chapter: '第 99 話',
  last_seen: '2026-01-01',
  note: null,
});
eq('D1 is enforced even if the input carries chapter data (unknown ⇒ null)', dirty.latestChapter, null);
eq('D1 is enforced for last_seen too', dirty.lastSeen, null);

const flagged = policy.formatUnofficialZh({
  status: 'manually_flagged',
  latest_chapter: '第 12 話',
  last_seen: '2026-02-02',
  note: '人工確認',
  recorded_by: 'curator',
});
eq('manually_flagged keeps chapter info', flagged.latestChapter, '第 12 話');
eq('manually_flagged keeps the human note', flagged.humanNote, '人工確認');
eq('manually_flagged still has no link', flagged.hasLink, false);

check('link detector catches a full URL', containsLinkLikeText('see https://example.com/x'));
check('link detector catches a bare domain', containsLinkLikeText('漢化組 example.com 發布'));
check('link detector catches www.', containsLinkLikeText('www.foo.net'));
check('link detector passes clean prose', !containsLinkLikeText('人工確認存在，但依規範不提供取得方式。'));
check(
  'the redaction path is reachable (a URL inside a note is detected)',
  containsLinkLikeText('請見 example.com'),
);
check(
  'no real unofficial_zh payload trips the link detector',
  works.every((w) => !containsLinkLikeText(w.unofficial_zh)),
);

/* ================================================================== *
 * 5. Filter parsing + URL shareability
 * ================================================================== */
section('filter parsing / query-string round-trip');

eq(
  'repeated keys (HTML form output) are read as a list',
  parseFilters({ status: ['ongoing', 'completed'] }).status,
  ['ongoing', 'completed'],
);
eq(
  'comma lists (hand-written links) are read as a list',
  parseFilters({ media: 'manga,light_novel' }).media,
  ['manga', 'light_novel'],
);
eq(
  'unknown values are dropped instead of breaking the page',
  parseFilters({ status: 'not_a_status', media: ['manga', 'nope'] }).status,
  [],
);
eq('media drops only the invalid entry', parseFilters({ media: ['manga', 'nope'] }).media, ['manga']);
eq('empty input yields defaults', parseFilters(undefined), {
  q: '',
  author: '',
  status: [],
  media: [],
  yuri: [],
  anime: [],
  zhTw: 'any',
  zhCn: 'any',
  sort: 'title',
});
eq('zh_tw=yes is parsed', parseFilters({ zh_tw: 'yes' }).zhTw, 'yes');
eq('zh_cn=no is parsed', parseFilters({ zh_cn: 'no' }).zhCn, 'no');
eq('a bad edition value degrades to any', parseFilters({ zh_tw: 'maybe' }).zhTw, 'any');
eq('sort=recent is parsed', parseFilters({ sort: 'recent' }).sort, 'recent');
eq('an unknown sort degrades to title', parseFilters({ sort: 'weird' }).sort, 'title');
eq('q is trimmed', parseFilters({ q: '  citrus  ' }).q, 'citrus');

const complex = {
  q: 'citrus',
  author: '入間人間',
  status: ['ongoing'],
  media: ['manga'],
  yuri: ['uncertain'],
  anime: ['none'],
  zhTw: 'yes',
  zhCn: 'no',
  sort: 'recent',
};
const queryString = buildQueryString(complex);
check(
  'query string mentions every active dimension',
  ['q=citrus', 'status=ongoing', 'media=manga', 'yuri=uncertain', 'anime=none', 'zh_tw=yes', 'zh_cn=no', 'sort=recent'].every((part) => queryString.includes(part)),
  queryString,
);
eq('author is serialised (percent-encoded) and readable back', new URLSearchParams(queryString).get('author'), '入間人間');

const reparsed = parseFilters(Object.fromEntries(new URLSearchParams(queryString)));
eq('filters survive a URL round-trip', reparsed, complex);
eq('defaults serialise to an empty query string', buildQueryString(parseFilters(undefined)), '');
eq('filter order in the URL is stable', buildQueryString({ ...complex, status: ['ongoing'] }), queryString);

/* ---- author dimension: parsing, encoding, exact matching ------------------ */
eq('author is trimmed on parse', parseFilters({ author: '  入間人間  ' }).author, '入間人間');
eq('a blank author means "no creator filter"', parseFilters({ author: '   ' }).author, '');
eq('author counts as exactly one active filter', countActiveFilters(parseFilters({ author: '入間人間' })), 1);
eq(
  'author composes with other dimensions in the active count',
  countActiveFilters(parseFilters({ author: '入間人間', media: 'manga' })),
  2,
);

const cjkAuthor = '入間人間';
const cjkAuthorQuery = buildQueryString(parseFilters({ author: cjkAuthor }));
check('a CJK author name is percent-encoded, not written raw', !cjkAuthorQuery.includes(cjkAuthor), cjkAuthorQuery);
eq(
  'a CJK author name survives the URL round-trip exactly',
  parseFilters(Object.fromEntries(new URLSearchParams(cjkAuthorQuery))).author,
  cjkAuthor,
);

/* ================================================================== *
 * 6. Filtering against the real dataset
 * ================================================================== */
section(`filtering the real ${works.length}-work dataset`);

const run = (params) => filterAndSortWorks(works, parseFilters(params));
const bySlug = (list) => list.map((w) => w.slug).sort();

// Independent re-derivation of the expected counts, written differently from the
// implementation so the two are a genuine cross-check.
const expectZhTw = works.filter((w) => w.title_zh_tw != null || (w.zh_tw_volumes ?? []).length > 0 || w.publisher_zh_tw != null).length;
const expectZhCn = works.filter(
  (w) => w.title_zh_cn != null || (w.zh_cn_volumes ?? []).length > 0 || w.publisher_zh_cn != null || w.official_zh_cn?.exists === true,
).length;

eq(`zh_tw=yes matches the independently computed count (${expectZhTw})`, run({ zh_tw: 'yes' }).length, expectZhTw);
eq('zh_tw=no is the complement', run({ zh_tw: 'no' }).length, works.length - expectZhTw);
eq(`zh_cn=yes matches the independently computed count (${expectZhCn})`, run({ zh_cn: 'yes' }).length, expectZhCn);
eq('zh_cn=no is the complement', run({ zh_cn: 'no' }).length, works.length - expectZhCn);

// Slug-for-slug equality against the independent predicate, not just a count.
const expectedZhTwSlugs = works
  .filter((w) => w.title_zh_tw != null || (w.zh_tw_volumes ?? []).length > 0 || w.publisher_zh_tw != null)
  .map((w) => w.slug)
  .sort();
eq('zh_tw=yes returns exactly the expected works', bySlug(run({ zh_tw: 'yes' })), expectedZhTwSlugs);
check(
  'the zh_tw filter and workHasZhTwEdition agree on every work',
  works.every((w) => workHasZhTwEdition(w) === expectedZhTwSlugs.includes(w.slug)),
);
check(
  'the zh_cn filter and workHasZhCnEdition agree on every work',
  works.every((w) => workHasZhCnEdition(w) === (w.title_zh_cn != null || (w.zh_cn_volumes ?? []).length > 0 || w.publisher_zh_cn != null || w.official_zh_cn?.exists === true)),
);

// Every expectation below is DERIVED from the dataset rather than hardcoded, so
// the test keeps working as the collector coverage grows (it previously pinned
// "36" and broke the moment anime_status became populated).
const countBy = (pred) => works.filter(pred).length;
eq('media=manga matches data', run({ media: 'manga' }).length,
   countBy((w) => w.media_type === 'manga'));
eq('media=light_novel matches data', run({ media: 'light_novel' }).length,
   countBy((w) => w.media_type === 'light_novel'));
eq('status=ongoing matches data', run({ status: 'ongoing' }).length,
   countBy((w) => w.serialization_status === 'ongoing'));
eq('status=hiatus matches data', run({ status: 'hiatus' }).length,
   countBy((w) => w.serialization_status === 'hiatus'));
eq('yuri=uncertain matches data', run({ yuri: 'uncertain' }).length,
   countBy((w) => w.yuri_type === 'uncertain'));
eq('anime=none matches data', run({ anime: 'none' }).length,
   countBy((w) => w.anime_status === 'none'));
eq('anime=finished matches data', run({ anime: 'finished' }).length,
   countBy((w) => w.anime_status === 'finished'));
eq('filters combine with AND', run({ media: 'manga', status: 'completed' }).length,
   countBy((w) => w.media_type === 'manga' && w.serialization_status === 'completed'));
eq('multi-select within a dimension is OR', run({ status: ['completed', 'ongoing'] }).length,
   countBy((w) => ['completed', 'ongoing'].includes(w.serialization_status)));

const citrus = run({ q: 'citrus' });
// Derived, not hardcoded: the work whose title contains "citrus" must be found
// whatever its slug is (it became `citrus-plus` once sequel markers stopped
// being stripped by the slugger).
const citrusWorks = works.filter((w) => w.title_ja.toLowerCase().includes('citrus'));
check(
  `searching "citrus" finds every citrus work (${citrusWorks.length})`,
  citrusWorks.every((w) => bySlug(citrus).includes(w.slug)),
  `found=[${bySlug(citrus).join(',')}] expected=[${citrusWorks.map((w) => w.slug).sort().join(',')}]`,
);

const authorWork = works.find((w) => (w.authors ?? []).length > 0);
const author = authorWork.authors[0];
const byAuthor = run({ q: author });
check(
  `searching by author "${author}" finds ${authorWork.slug}`,
  bySlug(byAuthor).includes(authorWork.slug),
  bySlug(byAuthor).join(','),
);

/* ---- author filter: exact match over authors ∪ illustrators -------------- */
const creatorName = author;
const expectedCreatorSlugs = works
  .filter((w) => (w.authors ?? []).includes(creatorName) || (w.illustrators ?? []).includes(creatorName))
  .map((w) => w.slug)
  .sort();
eq(
  `author="${creatorName}" returns exactly the works that list it`,
  bySlug(run({ author: creatorName })),
  expectedCreatorSlugs,
);
check(
  `every author="${creatorName}" result really lists that name (authors or illustrators)`,
  run({ author: creatorName }).every(
    (w) => (w.authors ?? []).includes(creatorName) || (w.illustrators ?? []).includes(creatorName),
  ),
);

const illustratorWork = works.find((w) => (w.illustrators ?? []).length > 0);
const illustratorName = illustratorWork.illustrators[0];
const illustratorMatches = run({ author: illustratorName });
check(
  `author="${illustratorName}" also matches the illustrators array (${illustratorMatches.length} works)`,
  illustratorMatches.some((w) => w.slug === illustratorWork.slug),
);
check(
  `every author="${illustratorName}" result lists it as author or illustrator`,
  illustratorMatches.every(
    (w) => (w.authors ?? []).includes(illustratorName) || (w.illustrators ?? []).includes(illustratorName),
  ),
);

const ghostAuthor = '絶対に存在しない作者名';
eq(`author="${ghostAuthor}" returns 0 works`, run({ author: ghostAuthor }).length, 0);
const authorPrefix = creatorName.slice(0, Math.max(1, creatorName.length - 1));
check(
  `author matching is exact, not a substring ("${authorPrefix}" only returns exact matches)`,
  run({ author: authorPrefix }).every(
    (w) => (w.authors ?? []).includes(authorPrefix) || (w.illustrators ?? []).includes(authorPrefix),
  ),
  bySlug(run({ author: authorPrefix })).join(','),
);

const slugWork = works[5];
eq('searching by slug finds exactly that work', bySlug(run({ q: slugWork.slug })), [slugWork.slug]);

const zhTwTitleWork = works.find((w) => w.title_zh_tw);
if (zhTwTitleWork) {
  check(
    `searching by 繁中標題 "${zhTwTitleWork.title_zh_tw}" finds ${zhTwTitleWork.slug}`,
    bySlug(run({ q: zhTwTitleWork.title_zh_tw })).includes(zhTwTitleWork.slug),
  );
} else {
  check('a 繁中 title exists to search (informational)', true);
}

const magWork = works.find((w) => w.magazine_or_platform);
const byMagazine = run({ q: magWork.magazine_or_platform });
check(
  `searching by magazine/platform "${magWork.magazine_or_platform}" returns ${byMagazine.length} works`,
  byMagazine.length > 0 && byMagazine.every((w) => w.magazine_or_platform === magWork.magazine_or_platform),
);

check(
  'two disjoint tokens require both (AND semantics)',
  matchesQuery(works[0], `${works[0].title_ja} 絶対に存在しない語`) === false,
);
eq('an empty query matches everything', filterAndSortWorks(works, parseFilters({})).length, works.length);
eq(
  'query + filters compose (manga + ongoing + citrus ⇒ 1)',
  run({ q: 'citrus', media: 'manga', status: 'ongoing' }).length,
  1,
);
eq(
  'a filter that contradicts the query yields 0',
  run({ q: 'citrus', media: 'light_novel' }).length,
  0,
);

const sortedA = sortWorks(works, 'title').map((w) => w.slug);
const sortedB = sortWorks(works, 'title').map((w) => w.slug);
eq('sorting is deterministic', sortedA, sortedB);
eq('sorting never drops or adds a work', sortedA.length, works.length);
eq('sorting does not mutate the input array', works[0].slug, dataset.works[0].slug);
const recent = sortWorks(works, 'recent');
check(
  'recent sort is non-increasing by last_checked',
  recent.every((w, i) => i === 0 || String(recent[i - 1].last_checked ?? '') >= String(w.last_checked ?? '')),
);

/* ================================================================== *
 * 7. The slim client projection the static export actually ships
 * ================================================================== */
section('slim projection (lib/works-slim.json) vs the full dataset');

/**
 * The exported site cannot hand the browser data/works.json (4.7 MB), so the list
 * page filters lib/works-slim.json. That projection is only safe if it is
 * SEMANTICALLY EQUIVALENT to the full dataset for everything the UI reads — so it
 * is checked here, record for record and filter for filter, against the same
 * functions the app uses. `avg_confidence` is recomputed through the REAL
 * lib/provenance.ts (staged for Node exactly as build-slim.mjs does it), never
 * re-derived here, so a drift in either implementation fails this section.
 */
function stageProvenance() {
  const inventory = readFileSync(join(WEB_ROOT, 'lib', 'schema-fields.json'), 'utf8');
  let code = readFileSync(join(WEB_ROOT, 'lib', 'provenance.ts'), 'utf8');
  code = code.replace(
    /^import schemaFields from '\.\/schema-fields\.json';$/m,
    `const schemaFields = ${inventory};`,
  );
  code = code.replace(/from '(\.\/[a-z-]+)';/g, (_m, spec) => `from '${spec}.ts';`);
  const staged = join(WEB_ROOT, 'lib', '.provenance.staged.ts');
  writeFileSync(staged, code, 'utf8');
  return staged;
}

const stagedProvenance = stageProvenance();
let averageFieldConfidence;
try {
  ({ averageFieldConfidence } = await import(pathToFileURL(stagedProvenance).href));
} finally {
  rmSync(stagedProvenance, { force: true });
}

const slim = JSON.parse(readFileSync(join(WEB_ROOT, 'lib', 'works-slim.json'), 'utf8'));
const slimWorks = slim.works;

eq(`the projection covers every work (${works.length})`, slimWorks.length, works.length);
eq('the projection reports the same count as its own array', slim.count, slimWorks.length);
eq('the projection keeps the dataset timestamp', slim.generated_at, dataset.generated_at);
eq(
  'the projection keeps every work in the dataset order, with the same id and slug',
  slimWorks.map((w) => [w.id, w.slug]),
  works.map((w) => [w.id, w.slug]),
);

const projectedKeySets = [...new Set(slimWorks.map((w) => Object.keys(w).sort().join(',')))];
eq('every projected record exposes exactly the same key set', projectedKeySets.length, 1);

const confidenceDrift = slimWorks.filter((projected, index) => !Object.is(projected.avg_confidence, averageFieldConfidence(works[index])));
eq(
  'avg_confidence is exactly the real averageFieldConfidence() on every work',
  confidenceDrift.map((w) => w.slug).slice(0, 5),
  [],
);

const editionDrift = slimWorks.filter((projected, index) => {
  const work = works[index];
  return (
    projected.has_zh_tw !== workHasZhTwEdition(work) ||
    projected.has_zh_cn !== workHasZhCnEdition(work) ||
    projected.sources_count !== (work.sources ?? []).length
  );
});
eq(
  'has_zh_tw / has_zh_cn (real functions) and sources_count match on every work',
  editionDrift.map((w) => w.slug).slice(0, 5),
  [],
);

/**
 * Filter equivalence, EXHAUSTIVELY: every combination of every filter dimension
 * (including the multi-select OR forms and both sorts) must produce exactly the
 * same ordered slug list from the projection as from the full dataset.
 */
const filterMatrix = [];
for (const media of [[], ...MEDIA_TYPES.map((token) => [token])]) {
  for (const status of [[], ...SERIALIZATION_STATUSES.map((t) => [t])]) {
    for (const yuri of [[], ['orthodox_yuri'], ['light_yuri'], ['s_class'], ['gl'], ['micro_yuri'], ['uncertain'], ['orthodox_yuri', 'light_yuri']]) {
      for (const anime of [[], ...ANIME_STATUSES.map((t) => [t])]) {
        for (const zhTw of ['any', 'yes', 'no']) {
          for (const zhCn of ['any', 'yes', 'no']) {
            for (const sort of ['title', 'recent']) {
              filterMatrix.push({
                ...(media.length ? { media } : {}),
                ...(status.length ? { status } : {}),
                ...(yuri.length ? { yuri } : {}),
                ...(anime.length ? { anime } : {}),
                ...(zhTw === 'any' ? {} : { zh_tw: zhTw }),
                ...(zhCn === 'any' ? {} : { zh_cn: zhCn }),
                ...(sort === 'title' ? {} : { sort }),
              });
            }
          }
        }
      }
    }
  }
}

let filterMismatch = null;
for (const params of filterMatrix) {
  const filters = parseFilters(params);
  const fromFull = JSON.stringify(filterAndSortWorks(works, filters).map((w) => w.slug));
  const fromSlim = JSON.stringify(filterAndSortWorks(slimWorks, filters).map((w) => w.slug));
  if (fromFull !== fromSlim) {
    filterMismatch = { params, fromFull: fromFull.slice(0, 120), fromSlim: fromSlim.slice(0, 120) };
    break;
  }
}
check(
  `all ${filterMatrix.length} filter combinations (every dimension × both sorts) return the identical work set and order`,
  filterMismatch === null,
  filterMismatch ? JSON.stringify(filterMismatch) : undefined,
);

/* ---- every real creator name: full dataset vs slim projection ------------ */
const allCreatorNames = [
  ...new Set(works.flatMap((w) => [...(w.authors ?? []), ...(w.illustrators ?? [])])),
].sort();

const creatorFilterMismatch = allCreatorNames
  .map((name) => ({
    name,
    full: JSON.stringify(filterAndSortWorks(works, parseFilters({ author: name })).map((w) => w.slug)),
    slim: JSON.stringify(filterAndSortWorks(slimWorks, parseFilters({ author: name })).map((w) => w.slug)),
  }))
  .find((entry) => entry.full !== entry.slim);

check(
  `all ${allCreatorNames.length} real creator names filter identically from the full dataset and the slim projection`,
  creatorFilterMismatch === undefined,
  creatorFilterMismatch ? JSON.stringify(creatorFilterMismatch) : undefined,
);

/** The searchable text must survive the projection too. */
const searchProbes = [
  works[0].title_ja,
  works[0].slug,
  works.find((w) => (w.authors ?? []).length > 0).authors[0],
  works.find((w) => w.title_zh_tw)?.title_zh_tw,
  works.find((w) => w.magazine_or_platform)?.magazine_or_platform,
  works.find((w) => (w.illustrators ?? []).length > 0)?.illustrators[0],
  works.find((w) => (w.genres ?? []).length > 0)?.genres[0],
  `${works[0].title_ja} 絶対に存在しない語`,
].filter((value) => typeof value === 'string' && value.length > 0);

const searchMismatch = searchProbes
  .map((q) => ({ q, full: filterAndSortWorks(works, parseFilters({ q })).map((w) => w.slug) }))
  .find(({ q, full }) => {
    const fromSlim = filterAndSortWorks(slimWorks, parseFilters({ q })).map((w) => w.slug);
    return JSON.stringify(full) !== JSON.stringify(fromSlim);
  });
check(
  `search over ${searchProbes.length} data-derived probes (title / slug / author / zh title / magazine / illustrator / genre / AND-miss) is identical`,
  searchMismatch === undefined,
  searchMismatch ? JSON.stringify(searchMismatch.q) : undefined,
);

check(
  'the projection carries no field_sources / field_confidence / volume arrays (that is what makes it small)',
  slimWorks.every((w) => !('field_sources' in w) && !('field_confidence' in w) && !('ja_volumes' in w)),
);

/* ================================================================== *
 * 8. Unknown-value handling
 * ================================================================== */
section('unknown handling');

eq('null renders as unknown', displayValue(null), 'unknown');
eq('undefined renders as unknown', displayValue(undefined), 'unknown');
eq('empty string renders as unknown', displayValue('   '), 'unknown');
eq('empty array renders as unknown', displayValue([]), 'unknown');
eq('false renders as false, not unknown', displayValue(false), 'false');
eq('true renders as true', displayValue(true), 'true');
eq('0 renders as 0, not unknown', displayValue(0), '0');
eq('arrays join with 、', displayValue(['a', 'b']), 'a、b');
eq('no confidence ⇒ unknown band', confidenceBand(null), 'unknown');
eq('0.9 ⇒ high band', confidenceBand(0.9), 'high');
eq('0.6 ⇒ medium band', confidenceBand(0.6), 'medium');
eq('0.2 ⇒ low band', confidenceBand(0.2), 'low');
eq('an unparseable timestamp is echoed, not crashed', formatTimestamp('not-a-date'), 'not-a-date');
eq('a null timestamp is unknown', formatTimestamp(null), 'unknown');
check('a valid ISO timestamp is formatted', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/.test(formatTimestamp(dataset.generated_at)), formatTimestamp(dataset.generated_at));

/* ================================================================== *
 * summary
 * ================================================================== */
console.log(`\n${'='.repeat(60)}`);
if (failures.length) {
  console.error(`POLICY VERIFICATION FAILED — ${failures.length} of ${passed + failures.length} checks failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`POLICY VERIFICATION PASSED — ${passed} checks, using the real lib/policy.ts on the real dataset.`);
process.exit(0);
