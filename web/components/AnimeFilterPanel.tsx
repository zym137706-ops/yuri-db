/**
 * Search + filter controls for /anime.
 *
 * Same design as components/FilterPanel.tsx (the Work version) and for the same
 * reasons: a plain `<form method="get" action={FORM_ACTION}>` maps every control 1:1
 * onto a query-string parameter, so
 *   - it works with no client-side JavaScript at all (the browser navigates and
 *     the client bundle re-reads the query string),
 *   - the resulting URL is a shareable, bookmarkable representation of the state,
 *   - it stays a plain HTML form, so it keeps working on any static host.
 *
 * The action carries a trailing slash because the site is exported with
 * `trailingSlash: true`: `/anime` would reach the host as a redirect, while
 * `/anime/` is the real directory that holds index.html.
 *
 * Every option list is passed in from the page, where it is derived from the real
 * dataset (lib/anime-filters.ts `*Options()`), so the panel never offers a filter
 * value that matches zero entries — and it shows the count each value would return.
 */
import Link from 'next/link';

import {
  ANIME_SORTS,
  buildAnimeQueryString,
  countActiveAnimeFilters,
  type AnimeFilters,
  type TokenOption,
} from '@/lib/anime-filters';
import {
  ADAPTATION_SOURCE_LABELS,
  ANIME_FORMAT_LABELS,
  ANIME_SORT_LABELS,
  ANIME_STATUS_LABELS,
  labelOf,
} from '@/lib/anime-labels';

/**
 * `NEXT_PUBLIC_BASE_PATH` 在构建期内联；不带上这个前缀，表单在 GitHub Pages
 * **项目站**（从 /<repo>/ 提供）上提交时会跳到 `https://host/anime/` —— 少了
 * /<repo> 段，直接 404。本地根路径下永远复现不出来，所以必须显式加。
 * `next/link` 会自动处理前缀，但原生 `<form action>` 不会。
 */
const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
const FORM_ACTION = `${BASE_PATH}/anime/`;

export interface AnimeFilterOptions {
  adaptations: TokenOption[];
  formats: TokenOption[];
  statuses: TokenOption[];
  years: TokenOption[];
  studios: TokenOption[];
}

function CheckboxGroup({
  legend,
  name,
  options,
  labels,
  selected,
  hint,
}: {
  legend: string;
  name: string;
  options: TokenOption[];
  labels: Record<string, string>;
  selected: string[];
  hint?: string;
}) {
  return (
    <fieldset className="border-t border-zinc-200 pt-3 first:border-t-0 first:pt-0">
      <legend className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{legend}</legend>
      {hint ? <p className="mb-1 text-xs text-zinc-500">{hint}</p> : null}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {options.map((option) => (
          <label key={option.token} className="inline-flex items-center gap-1.5 text-sm text-zinc-700">
            <input type="checkbox" name={name} value={option.token} defaultChecked={selected.includes(option.token)} />
            <span>
              {labelOf(labels, option.token)}
              <span className="ml-1 text-xs text-zinc-400 tabular-nums">({option.count})</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AnimeFilterPanel({
  filters,
  options,
  resultCount,
  totalCount,
}: {
  filters: AnimeFilters;
  options: AnimeFilterOptions;
  resultCount: number;
  totalCount: number;
}) {
  const activeCount = countActiveAnimeFilters(filters);
  const shareUrl = buildAnimeQueryString(filters);
  const yearToken = /^[0-9]{4}$/.test(filters.year) || filters.year === 'unknown' ? filters.year : '';

  return (
    <form
      method="get"
      action={FORM_ACTION}
      className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
    >
      <div>
        <label htmlFor="q" className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          搜尋
        </label>
        <input
          id="q"
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder="標題（日／羅馬字／英）、製作公司、聲優、角色"
          className="mt-1 w-full rounded border border-zinc-300 px-2.5 py-1.5 text-sm focus:border-pink-400 focus:outline-none"
        />
        <p className="mt-1 text-xs text-zinc-500">
          以空白分隔多個關鍵字時，需全部命中（AND）。標題同時比對日文原名、羅馬字與英文標題。
        </p>
      </div>

      <CheckboxGroup
        legend="改編類型"
        name="adaptation"
        options={options.adaptations}
        labels={ADAPTATION_SOURCE_LABELS}
        selected={filters.adaptation}
        hint="同一維度內多選為 OR，與其他維度為 AND。"
      />

      <CheckboxGroup legend="形態" name="format" options={options.formats} labels={ANIME_FORMAT_LABELS} selected={filters.format} />

      <CheckboxGroup legend="狀態" name="status" options={options.statuses} labels={ANIME_STATUS_LABELS} selected={filters.status} />

      <div className="border-t border-zinc-200 pt-3">
        <label htmlFor="year" className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          年份
        </label>
        <select
          id="year"
          name="year"
          defaultValue={yearToken}
          className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
        >
          <option value="">不限</option>
          {options.years.map((option) => (
            <option key={option.token} value={option.token}>
              {option.token === 'unknown' ? '年份 unknown（未定檔）' : option.token}（{option.count}）
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-zinc-500">
          口徑為 <code className="mono">season_year</code>，若為 null 才取 <code className="mono">start_date</code> 的年份，
          與管線 <code className="mono">data/anime_report.json</code> 的 <code className="mono">by_year</code> 相同；
          卡片與詳細頁仍會顯示原始 <code className="mono">start_date</code>。
        </p>
      </div>

      <div className="border-t border-zinc-200 pt-3">
        <label htmlFor="studio" className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          製作公司
        </label>
        <select
          id="studio"
          name="studio"
          defaultValue={options.studios.some((option) => option.token === filters.studio) ? filters.studio : ''}
          className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
        >
          <option value="">不限</option>
          {options.studios.map((option) => (
            <option key={option.token} value={option.token}>
              {option.token}（{option.count}）
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-zinc-500">
          這是資料中實際出現過的 {options.studios.length} 家製作公司；未收錄製作公司的條目不會被這個條件命中。
        </p>
      </div>

      <div className="border-t border-zinc-200 pt-3">
        <label htmlFor="sort" className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          排序
        </label>
        <select
          id="sort"
          name="sort"
          defaultValue={filters.sort}
          className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
        >
          {ANIME_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {ANIME_SORT_LABELS[sort] ?? sort}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3">
        <button
          type="submit"
          className="rounded bg-pink-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-800"
        >
          套用篩選
        </button>
        {activeCount > 0 ? (
          <Link href="/anime" className="text-sm text-zinc-600 no-underline hover:text-zinc-900">
            清除全部（{activeCount}）
          </Link>
        ) : null}
      </div>

      <p className="text-xs text-zinc-500">
        目前命中 <strong>{resultCount}</strong> / {totalCount} 筆。篩選條件全部反映在網址列（
        <code className="mono">{shareUrl || '（無條件）'}</code>），可直接複製分享。
      </p>
    </form>
  );
}
