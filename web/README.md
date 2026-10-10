# yuri-db · Phase 4 Web MVP

Website MVP for the **yuri-db** project (日本百合漫畫／輕小說 連載與出版資料庫).

The point of this app is **provenance**: every displayed value lets the reader see
where it came from, how confident the pipeline is, and whether it is an official
fact or a human editorial judgement. A value that could not be confirmed is shown
as `unknown` — never hidden, never guessed.

---

## ⚠️ Build status: NOT build-verified

`npm install` **could not be run** in the environment where this code was authored.
Every registry fetch fails with `DEPTH_ZERO_SELF_SIGNED_CERT` and npm retries each
package three times, so the install produced no `node_modules` and no
`package-lock.json`.

```
npm http fetch GET https://registry.npmjs.org/next attempt 1 failed with DEPTH_ZERO_SELF_SIGNED_CERT
npm http fetch GET https://registry.npmjs.org/next attempt 2 failed with DEPTH_ZERO_SELF_SIGNED_CERT
npm http fetch GET https://registry.npmjs.org/next attempt 3 failed with DEPTH_ZERO_SELF_SIGNED_CERT
```

TLS verification was **not** disabled and the install was **not** retried.

**Therefore: `next build`, `next dev`, `tsc --noEmit` and any runtime render of a
React page have never been executed.** What *has* been verified is listed in
[Verification](#verification) below — it covers the data contract, the rating /
`unofficial_zh` policy, the provenance view builder, and import resolution, but it
cannot prove that Next.js compiles the JSX or that Tailwind emits the expected CSS.

Run this first on a machine with working registry access:

```bash
cd web
npm install
npm run typecheck     # tsc --noEmit
npm run build
npm run dev           # http://localhost:3000
```

---

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15 (App Router), React 19 |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS **v4** via `@tailwindcss/postcss` (no `tailwind.config.js` needed) |
| Data | `node:fs` + `yaml` — reads `../data/*.json` and `../sources.yaml` |
| ORM (optional, unused) | Prisma 6 (`prisma/schema.prisma`, `lib/prisma.ts`) |

`package.json` sets `"type": "module"`. This is supported by Next.js 15, and it is
also what lets Node execute `lib/policy.ts` directly for the verification scripts.

---

## Zero-infrastructure runtime path

**No database is required.** The site renders from the pipeline's own export files,
resolved relative to the repository root (found by walking up from `process.cwd()`):

| File | Used by |
|---|---|
| `../data/works.json` | Works list, search, filters, every detail page |
| `../data/dataset_report.json` | Data-quality page |
| `../data/change_log.json` *(optional)* | Changelog page — absent ⇒ graceful empty state |
| `../sources.yaml` | Sources page (75 sources + 19 review sources) |

`lib/prisma.ts` exists so a future deployment can move to Postgres, but **nothing
imports it**, so Prisma is never on the default code path (asserted by
`scripts/verify-imports.mjs`). `DATABASE_URL` is unset by default.

Because the files sit outside `web/`, nothing outside `web/` is bundled or modified.

---

## Pages

| Route | What it does |
|---|---|
| `/` | Search + filters + results. All filter state lives in the URL query string. |
| `/works/[slug]` | Renders **every** field of `schemas/work.schema.json` with per-field provenance and confidence. |
| `/sources` | All 94 sources grouped by `category` (review sources by `region`, with `review_text_available` + copyright risk + `display_policy`), plus `field_source_map`. |
| `/data-quality` | Pipeline completeness report **and** live per-field completeness + provenance coverage. |
| `/changelog` | Change-log entries grouped by detection batch; graceful empty state when the log does not exist yet. |

### Shareable filter URLs

Filters are a plain `<form method="get">`, so they work with JavaScript disabled and
every state is a copyable URL:

```
/?q=citrus&status=ongoing&media=manga&yuri=uncertain&anime=none&zh_tw=yes&zh_cn=no&sort=recent
```

- `q` — title (`title_ja` / `title_zh_tw` / `title_zh_cn` / `title_en`), author,
  illustrator, publisher, magazine/platform, slug and id. Space-separated tokens
  are AND-ed.
- `status` — `ongoing` \| `completed` \| `hiatus` \| `unknown` (repeatable)
- `media` — `manga` \| `light_novel` \| `web_novel` (repeatable)
- `yuri` — `orthodox_yuri` \| `light_yuri` \| `s_class` \| `gl` \| `micro_yuri` \| `uncertain` (repeatable)
- `anime` — `none` \| `announced` \| `in_production` \| `airing` \| `finished` \| `movie` (repeatable)
- `zh_tw`, `zh_cn` — `any` \| `yes` \| `no` (does a Chinese edition exist)
- `sort` — `title` (default) \| `recent`

Values inside one dimension are OR-ed; different dimensions are AND-ed. Unknown or
stale values are dropped rather than throwing, so an old link degrades gracefully.
Comma lists (`?media=manga,light_novel`) also parse, alongside repeated keys.

---

## Provenance UI (the first-class feature)

`lib/schema-fields.json` is the **single source of truth** for the field inventory and
its labels. `scripts/assert-data-contract.mjs` proves it is a bijection with the
`properties` of `schemas/work.schema.json` — so a schema field cannot silently stop
being rendered, and the UI cannot invent a field.

Every row of the detail page's provenance tables shows:

1. the field name (Chinese label + raw key),
2. the value, or the literal `unknown`,
3. the `field_sources` **basis** badge, and
4. the `field_confidence` value as a bar + percentage,
5. the source URL, `retrieved_at`, and the pipeline's explanatory `note`.

`basis` rendering rules:

| basis | Badge | Source link |
|---|---|---|
| `official` | 官方 / official | yes |
| `official_tag` | 官方標籤 / official_tag | yes |
| `editorial` | **編輯判斷 / editorial** (dashed amber, visually distinct) | **never** |
| `derived` | 推導 / derived | yes |

The pipeline really does put a context URL on `editorial` rows (e.g. `genres` marked
editorial carrying the magazine's page), so link suppression is enforced in the data
layer: `FieldView.linkableSourceUrl` is forced to `null` whenever `editorial` is true,
and the component links only that field. `scripts/verify-provenance.mjs` asserts this
for every editorial view across all 36 works.

Fields with no value render as `unknown` with an explanatory tooltip — nulls, empty
strings and empty arrays are never hidden.

---

## Review / rating policy (`docs/phase1-feasibility-report.md` §5.2)

The database has **no review-body column** ([A] scores + [B] metadata only). The UI
implements all five mandatory rules:

- **P1** — only aggregate scores + counts, each with an outbound link. No review text.
- **P2** — `score_scale` is always displayed explicitly (5 / 10 / 100 分制).
- **P3** — ratings are **grouped by scale** and never averaged across scales.
  `groupRatingsByScale()` returns one bucket per scale, so no caller can obtain a
  combined figure; a test asserts `lib/policy.ts` exports no averaging helper.
- **P4** — `display_allowed: false` ⇒ **no number at all**, not even the count or a
  visual bar; only the link and the scale label are shown.
- **P5** — every rating row shows `source_url` + `retrieved_at`.

The current dataset contains **0 rating rows**, so the detail page renders an explicit
"尚無站內評分" empty state that still explains the policy. The policy logic itself is
verified against synthetic rows.

`review_meta` (layer [B]) renders outlet / reviewer / date / rank / points + link, and
never a body.

## `unofficial_zh` (schema rule D1)

- Manual registration only; the schema object deliberately has **no link field**.
- The section renders the `status`, and can never produce a link: no descriptor of
  `unofficial_zh` is of `kind: "url"`, so `nestedRows()` returns `href: null` for all
  six rows (asserted for all 36 works).
- When `status === "unknown"` the required fixed sentence is shown verbatim:
  > 本数据库只收录官方授权中文版信息。非官方翻译不在收录范围，因此不作标注。
- Defence in depth: if a human `note` ever contained something URL-like, it is
  redacted instead of displayed (`containsLinkLikeText()`).
- Chapter fields are only surfaced for `manually_flagged` rows and are forced to
  `null` for `unknown` rows.

---

## Footer / banner

Every page carries a footer stating that the data is produced by a **scheduled
pipeline, not in real time**, showing the exact export timestamp and its age, and
linking to the Sources page (plus Data quality and Changelog).

---

## Verification

Four scripts run with **plain `node` — no `npm install` required**:

```bash
node scripts/assert-data-contract.mjs   # data contract + schema bijection
node scripts/verify-imports.mjs         # every import resolves to a real export
node scripts/verify-policy.mjs          # §5.2 + D1 + filters, on the real dataset
node scripts/verify-provenance.mjs      # provenance view builder, on all 36 works
node scripts/inspect-dataset.mjs        # dataset reconnaissance (informational)
```

`npm run verify` chains all four (contract → imports → policy → provenance); the
package scripts are `verify:contract`, `verify:imports`, `verify:policy`,
`verify:provenance`, `inspect:dataset`, plus `typecheck` / `build` / `dev`.

What each proves:

- **assert-data-contract** — every field the UI reads exists with the right shape;
  `lib/schema-fields.json` is a bijection with the schema (top level *and* every
  nested object); enum domains match; D1/D2 invariants hold; `dataset_report.json`
  reproduces from the raw export; `sources.yaml` has exactly 75 + 19 = 94 entries with
  every rendered key; source ids are unique and tab-free (YAML-parseable).
- **verify-imports** — a `tsc` stand-in: all 85 import statements resolve and all 189
  named imports exist as exports; only declared packages are imported; no page pulls
  in Prisma; no unused named imports.
- **verify-policy** — executes the real `lib/policy.ts` (Node 24 strips the types)
  against the real `data/works.json`: rating display policy, scale grouping,
  `unofficial_zh` fixed sentence and no-link guarantee, filter parsing and URL
  round-trip, and search/filter results cross-checked against independent
  re-derivations.
- **verify-provenance** — compiles the real `lib/provenance.ts` (two mechanical
  adaptations, both asserted) and runs it over all 36 works: 42 well-formed views per
  work, unknown handling, editorial link suppression, no `[object Object]`, and label
  coverage for every schema enum value.

### Cannot be verified here (needs `npm install`)

- `next build` / `next dev` and anything about JSX rendering or hydration.
- `tsc --noEmit` — type *consistency* is argued by review plus the import checker;
  it has not been machine-checked.
- Tailwind v4 CSS generation and responsive behaviour.
- `yaml` parsing of `sources.yaml`. The loader wraps parsing in `try/catch` and the
  Sources page renders a readable error state instead of crashing; the Works pages do
  not depend on that file. The structural contract (sections, ids, keys) is asserted.
- Postgres / Prisma (`prisma generate` has never run).

---

## Future: Postgres

`prisma/schema.prisma` mirrors `schemas/work.schema.json` (enums, nullability, and the
absence of a review-body column). `lib/prisma.ts` lazily creates a client only when
`DATABASE_URL` is set, and returns `null` on any failure, so switching backends cannot
break the JSON path.

```bash
cp .env.example .env      # then set DATABASE_URL
npm run prisma:generate
npm run prisma:push
```

`.env.example` documents `DATABASE_URL` and `NEXT_PUBLIC_SITE_URL`.

---

## File map

```
web/
  package.json            Next/React/Tailwind/Prisma/yaml, scripts, "type": "module"
  tsconfig.json           strict, paths "@/*" → web/*, resolveJsonModule
  next.config.mjs         reactStrictMode, serverExternalPackages: ['yaml']
  postcss.config.mjs      Tailwind v4 plugin only
  next-env.d.ts           committed so the repo type-checks before the first build
  .env.example            DATABASE_URL + NEXT_PUBLIC_SITE_URL
  .gitignore
  README.md               this file
  prisma/schema.prisma    future Postgres model
  lib/
    types.ts              TS mirror of work.schema.json + the other input shapes
    policy.ts             pure rules: §5.2 ratings, D1, search/filters (zero imports)
    labels.ts             enum → 繁體中文 label maps (zero imports)
    provenance.ts         field-view builder (schema-driven)
    schema-fields.json    the field inventory + labels (single source of truth)
    data.ts               server-side loaders for the JSON/YAML files
    prisma.ts             optional Postgres client (imported by nothing)
  app/
    layout.tsx            shell + header/footer (pipeline disclosure)
    globals.css           Tailwind import + provenance badge styling
    page.tsx              search + filters + results
    works/[slug]/page.tsx every schema field with provenance
    sources/page.tsx      94 sources grouped by category / region
    data-quality/page.tsx completeness + provenance coverage
    changelog/page.tsx    change log, or a graceful empty state
    not-found.tsx
  components/
    ui.tsx                Badge / Pill / UnknownValue / ConfidenceBar / SectionCard…
    ProvenanceTable.tsx   field rows: value + basis + confidence + source
    FilterPanel.tsx       GET form driving the query string
    RatingPanel.tsx       §5.2 rating display
    UnofficialZhPanel.tsx D1 section (cannot render a link)
    SourceList.tsx        sources[] with retrieved_at + confidence
    ReviewMetaList.tsx    review_meta
    VolumeTable.tsx       ja / zh_tw / zh_cn volume tables
    WorkCard.tsx          list result card
    SiteChrome.tsx        header + footer
  scripts/
    assert-data-contract.mjs   contract + schema-bijection proof
    verify-imports.mjs         import/export resolution (tsc stand-in)
    verify-policy.mjs          §5.2 / D1 / filters vs the real dataset
    verify-provenance.mjs      provenance builder vs all 36 works
    inspect-dataset.mjs        value distributions (informational)
```

---

## Assumptions

1. **UI language** is 繁體中文 (matching the project docs), except the
   `unofficial_zh` sentence from the Phase 4 spec, which is reproduced verbatim in
   Simplified Chinese.
2. **Node ≥ 20.9** (declared in `engines`). The verification scripts rely on Node's
   native TypeScript type-stripping, which needs Node ≥ 22.6 (developed on v24.18.0).
3. **`../data` is the source of truth.** The app never writes to it; the live pipeline
   may regenerate those files at any time, and the app re-reads them per request
   (`dynamic = 'force-dynamic'` on the data-driven routes).
4. **A zh_tw edition "exists"** if `title_zh_tw`, `publisher_zh_tw` or
   `zh_tw_volumes` is non-empty; likewise for zh_cn, plus
   `official_zh_cn.exists === true`. This definition is one function
   (`workHasZhTwEdition` / `workHasZhCnEdition`) and is asserted to agree with the
   filter on every work.
5. **`status_2026` in `sources.yaml` is partly free text** (30 distinct values, only
   `active` / `discontinued` / `unknown` are canonical), so the Sources page passes
   unrecognised values through instead of forcing a badge.
6. **`field_sources` entries may omit `source_url` / `retrieved_at` / `confidence` /
   `note`** — only `basis` is schema-required, and the UI treats the rest as optional.
7. **`change_log.json` currently exists** (36 `created` entries) even though it is
   specified as optional; the empty-state path is implemented but not exercised by the
   current dataset.
8. `npm install` has not run, so there is **no lockfile**; dependency ranges are
   carets of the required majors.
