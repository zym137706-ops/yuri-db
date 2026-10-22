/**
 * Search + filter controls.
 *
 * Implemented as a plain `<form method="get">` on purpose:
 *   - it works without any client-side JavaScript,
 *   - every control maps 1:1 onto a query-string parameter, so the resulting URL
 *     is a shareable, bookmarkable representation of the current filter state,
 *   - a server component can render it, so the MVP ships no custom client bundle.
 *
 * Repeated checkbox names produce `?status=ongoing&media=manga`, which
 * lib/policy.ts `parseFilters` reads back (comma-separated values also work).
 */
import Link from 'next/link';

import {
  ANIME_STATUSES,
  MEDIA_TYPES,
  SERIALIZATION_STATUSES,
  YURI_TYPES,
  buildQueryString,
  countActiveFilters,
  type WorkFilters,
} from '@/lib/policy';
import {
  ANIME_STATUS_LABELS,
  MEDIA_TYPE_LABELS,
  SERIALIZATION_STATUS_LABELS,
  YURI_TYPE_LABELS,
} from '@/lib/labels';

/**
 * `action` is a plain HTML attribute, so Next's `basePath` does NOT rewrite it.
 * This panel is rendered inside a client component, where
 * `NEXT_PUBLIC_BASE_PATH` is inlined at build time; without the prefix the form
 * would submit to the domain root on a GitHub Pages project site (`/yuri-db/`)
 * and every filter (including the new author box) would be lost.
 */
const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
const FORM_ACTION = `${BASE_PATH}/`;

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
  options: readonly string[];
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
          <label key={option} className="inline-flex items-center gap-1.5 text-sm text-zinc-700">
            <input type="checkbox" name={name} value={option} defaultChecked={selected.includes(option)} />
            <span>{labels[option] ?? option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function EditionRadio({
  legend,
  name,
  value,
  hint,
}: {
  legend: string;
  name: string;
  value: 'any' | 'yes' | 'no';
  hint?: string;
}) {
  const options: { key: 'any' | 'yes' | 'no'; label: string }[] = [
    { key: 'any', label: '不限' },
    { key: 'yes', label: '有' },
    { key: 'no', label: '無' },
  ];
  return (
    <fieldset className="border-t border-zinc-200 pt-3">
      <legend className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{legend}</legend>
      {hint ? <p className="mb-1 text-xs text-zinc-500">{hint}</p> : null}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {options.map((option) => (
          <label key={option.key} className="inline-flex items-center gap-1.5 text-sm text-zinc-700">
            <input type="radio" name={name} value={option.key} defaultChecked={value === option.key} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function FilterPanel({ filters, resultCount }: { filters: WorkFilters; resultCount: number }) {
  const activeCount = countActiveFilters(filters);
  const resetHref = '/';
  const shareUrl = buildQueryString(filters);

  return (
    <form method="get" action={FORM_ACTION} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div>
        <label htmlFor="q" className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          搜尋
        </label>
        <input
          id="q"
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder="標題（日／繁中／簡中／英）、作者、出版社、雜誌或平台"
          className="mt-1 w-full rounded border border-zinc-300 px-2.5 py-1.5 text-sm focus:border-pink-400 focus:outline-none"
        />
        <p className="mt-1 text-xs text-zinc-500">
          以空白分隔多個關鍵字時，需全部命中（AND）。
        </p>
      </div>

      <div className="border-t border-zinc-200 pt-3">
        <label htmlFor="author" className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          作者／繪者
        </label>
        <input
          id="author"
          type="text"
          name="author"
          defaultValue={filters.author}
          placeholder="例：入間人間（需完全相符）"
          className="mt-1 w-full rounded border border-zinc-300 px-2.5 py-1.5 text-sm focus:border-pink-400 focus:outline-none"
        />
        <p className="mt-1 text-xs text-zinc-500">
          精確比對 <code className="mono">authors</code> 或 <code className="mono">illustrators</code>
          ；資料庫作者眾多，因此用文字輸入而非選單。
          {filters.author ? (
            <>
              {' '}目前只看作者／繪者為<strong>「{filters.author}」</strong>的作品。
            </>
          ) : null}
        </p>
      </div>

      <CheckboxGroup
        legend="連載狀態"
        name="status"
        options={SERIALIZATION_STATUSES}
        labels={SERIALIZATION_STATUS_LABELS}
        selected={filters.status}
      />

      <CheckboxGroup
        legend="媒體類型"
        name="media"
        options={MEDIA_TYPES}
        labels={MEDIA_TYPE_LABELS}
        selected={filters.media}
      />

      <CheckboxGroup
        legend="百合類型"
        name="yuri"
        options={YURI_TYPES}
        labels={YURI_TYPE_LABELS}
        selected={filters.yuri}
        hint="此為編輯判斷（classification_basis = editorial）。"
      />

      <CheckboxGroup
        legend="動畫狀態"
        name="anime"
        options={ANIME_STATUSES}
        labels={ANIME_STATUS_LABELS}
        selected={filters.anime}
      />

      <EditionRadio
        legend="繁中官方版"
        name="zh_tw"
        value={filters.zhTw}
        hint="判定依據：繁中標題／出版社／書目任一存在。"
      />

      <EditionRadio
        legend="簡中官方授權"
        name="zh_cn"
        value={filters.zhCn}
        hint="判定依據：簡中標題／出版社／書目，或 official_zh_cn.exists。"
      />

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
          <option value="title">日文標題（預設）</option>
          <option value="recent">最後查核時間（新→舊）</option>
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
          <Link href={resetHref} className="text-sm text-zinc-600 no-underline hover:text-zinc-900">
            清除全部（{activeCount}）
          </Link>
        ) : null}
      </div>

      <p className="text-xs text-zinc-500">
        目前命中 <strong>{resultCount}</strong> 筆。篩選條件全部反映在網址列（
        <code className="mono">{shareUrl || '（無條件）'}</code>），可直接複製分享。
      </p>
    </form>
  );
}
