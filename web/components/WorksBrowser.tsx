'use client';

/**
 * Client-side browse for the statically exported home page.
 *
 * With `output: 'export'` there is no server to read `searchParams`, so the
 * filtering runs here instead. The URL stays the source of truth — the filter
 * form is still a GET form, so every filtered view is a shareable link and
 * browser back/forward keeps working.
 *
 * The data comes from `lib/works-slim.json` (built by scripts/build-slim.mjs),
 * never from the 4.7 MB `data/works.json`.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { FilterPanel } from './FilterPanel';
import { WorkCard } from './WorkCard';
import { EmptyState } from './ui';
import {
  buildQueryString,
  countActiveFilters,
  filterAndSortWorks,
  parseFilters,
} from '@/lib/policy';
import { queryRecord } from '@/lib/url-state';
import type { SlimWork, SlimWorksFile } from '@/lib/types';

/**
 * The dataset is fetched as a static asset rather than bundled.
 *
 * Bundling the 960 KB projection into the client graph made every prerendered
 * page take longer than Next's per-page budget to build, and it duplicated the
 * payload into each page's RSC output. Fetching keeps the HTML at ~20 KB and
 * lets the browser cache the data across navigations.
 *
 * The base path MUST be included by hand: `basePath` rewrites Next's own asset
 * URLs, but not a `fetch()` written in application code. Without the prefix this
 * 404s on a GitHub Pages project site while working perfectly at a domain root —
 * exactly the kind of bug that never reproduces locally.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const DATA_URL = `${BASE_PATH}/data/works-slim.json`;

export function WorksBrowser() {
  const [works, setWorks] = useState<SlimWork[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(DATA_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SlimWorksFile>;
      })
      .then((doc) => {
        if (!cancelled) setWorks(doc.works);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // lib/url-state.ts preserves repeated keys (`?media=a&media=b`), which
  // Object.fromEntries would silently collapse to the last value.
  const filters = parseFilters(queryRecord(useSearchParams()));

  if (error) {
    return (
      <EmptyState title="無法載入資料集" tone="warn">
        <p className="mono">{DATA_URL}: {error}</p>
        <p className="mt-1 text-xs">
          本站是純靜態網站，資料檔與 HTML 一同發佈。若此訊息持續出現，代表資料檔未部署成功。
        </p>
      </EmptyState>
    );
  }

  if (works === null) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-500">
        載入作品資料中⋯（單一資料檔，載入後所有篩選都在瀏覽器端完成）
      </div>
    );
  }

  const results = filterAndSortWorks(works, filters);
  const activeCount = countActiveFilters(filters);
  const shareQuery = buildQueryString(filters);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <FilterPanel filters={filters} resultCount={results.length} />
      </aside>

      <div className="space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 className="text-base font-semibold text-zinc-900">
            搜尋結果：{results.length} / {works.length} 筆
          </h2>
          {activeCount > 0 ? (
            <p className="text-xs text-zinc-600">
              已套用 {activeCount} 個條件
              {shareQuery ? <code className="mono ml-1">{shareQuery}</code> : null}
            </p>
          ) : (
            <p className="text-xs text-zinc-600">未套用任何篩選條件（顯示全部）。</p>
          )}
        </div>

        {results.length === 0 ? (
          <EmptyState title="沒有符合條件的作品" tone="warn">
            <p>請放寬篩選條件，或使用上方「清除全部」重新開始。</p>
            <p className="mt-1">
              提示：許多作品只有部分欄位可確認，其餘顯示為{' '}
              <span className="unknown-value">unknown</span>；因此部分組合（例如簡中官方授權＝有）
              目前不會有結果。
            </p>
          </EmptyState>
        ) : null}

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {results.map((work) => (
            <li key={work.id}>
              <WorkCard work={work} />
            </li>
          ))}
        </ul>

        <p className="pt-2 text-xs text-zinc-500">
          本站為**靜態網站**：篩選在瀏覽器端執行，資料集在頁面載入時一併下載，
          因此之後的每次篩選都不需要連線伺服器。
        </p>
      </div>
    </div>
  );
}
