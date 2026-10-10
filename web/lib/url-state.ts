/**
 * The one adapter between the browser's `URLSearchParams` and the pure
 * `parseFilters` / `parseAnimeFilters` functions in lib/policy.ts and
 * lib/anime-filters.ts.
 *
 * Why it exists: the statically exported site has no server to read the query
 * string, so the browser components call `useSearchParams()`. That returns a
 * `ReadonlyURLSearchParams`, while the filter parsers accept the same shape Next
 * hands a server component (`Record<string, string | string[]>`), keeping both
 * the repeated-key form an HTML GET form produces (`?media=manga&media=light_novel`)
 * and the comma form a hand-written share link uses (`?media=manga,light_novel`)
 * working identically on both paths.
 *
 * A `Record` built with `Object.fromEntries` would silently drop every repeated
 * key except the last, which is exactly the bug this helper prevents.
 *
 * No imports: this module is deliberately `node:`-free and package-free so it can
 * be bundled into a client component and still be scanned by
 * scripts/verify-imports.mjs.
 */

/** The structural subset of URLSearchParams / ReadonlyURLSearchParams we need. */
export interface QueryParamsLike {
  keys(): Iterable<string>;
  getAll(key: string): string[];
}

/**
 * Collects a query string into the record form the filter parsers accept.
 * A key seen once becomes a string; a key seen several times becomes an array.
 */
export function queryRecord(params: QueryParamsLike): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = {};
  for (const key of Array.from(params.keys())) {
    const values = params.getAll(key);
    if (values.length === 0) continue;
    record[key] = values.length === 1 ? values[0] : values;
  }
  return record;
}
