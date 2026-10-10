/**
 * Home = search + browse.
 *
 * This page is a **server component** rendered once at build time. All filtering
 * happens in the browser (components/WorksBrowser.tsx) because the site is a
 * static export with no server to read `searchParams`.
 *
 * The Suspense boundary is REQUIRED: WorksBrowser calls `useSearchParams()`, and
 * Next refuses to statically export a page that reads search params without one.
 */
import { Suspense } from 'react';
import Link from 'next/link';

import { WorksBrowser } from '@/components/WorksBrowser';
import { Pill, SectionCard } from '@/components/ui';
import { formatTimestamp } from '@/lib/policy';
import slimRaw from '@/lib/works-slim.json';
import type { SlimWorksFile } from '@/lib/types';

const slim = slimRaw as unknown as SlimWorksFile;

function BrowserFallback() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-500">
      載入作品清單中⋯（若持續顯示此訊息，代表瀏覽器未執行 JavaScript；
      本頁的篩選功能需要 JavaScript，但作品詳細頁是預先產生的靜態 HTML，可直接瀏覽。）
    </div>
  );
}

export default function HomePage() {
  const total = slim.count;
  const generatedAt = slim.generated_at;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-bold text-zinc-900 sm:text-2xl">
          日本百合漫畫／輕小說資料庫
        </h1>
        <p className="mt-1 text-sm text-zinc-700">
          收錄 {total} 筆作品，資料來自 {generatedAt ? formatTimestamp(generatedAt) : 'unknown'} 的管線匯出。
          每個欄位都可追溯來源；無法確認的欄位一律顯示為 <span className="unknown-value">unknown</span>，不推測、不隱藏。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill tone="accent">欄位級溯源</Pill>
          <Pill tone="plain">可分享的篩選網址</Pill>
          <Pill tone="plain">純靜態、無需伺服器</Pill>
          <Pill tone="plain">排程更新，非即時</Pill>
        </div>
        <p className="mt-3 text-xs text-zinc-600">
          資料來源清單與合規說明見 <Link href="/sources">資料來源</Link>；
          欄位完整度與溯源覆蓋率見 <Link href="/data-quality">資料品質</Link>；
          最近一次管線變更見 <Link href="/changelog">更新日誌</Link>；
          百合動畫見 <Link href="/anime">百合動畫</Link>。
        </p>
      </section>

      <Suspense fallback={<BrowserFallback />}>
        <WorksBrowser />
      </Suspense>

      <SectionCard
        title="為什麼每個欄位都要標來源？"
        subtitle="這是本專案 Phase 4 的核心：讀者必須能判斷一個值是官方公告、平台標籤，還是編輯判斷。"
      >
        <div className="grid grid-cols-1 gap-3 text-sm text-zinc-700 md:grid-cols-2">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>官方 / official</strong>：來自出版社或平台的官方頁面，附來源連結與取得時間。
            </li>
            <li>
              <strong>官方標籤 / official_tag</strong>：來自平台官方百合標籤（例如カクヨム、一迅プラス）。
            </li>
            <li>
              <strong>編輯判斷 / editorial</strong>：沒有官方資料源的人工判定（如 <code className="mono">yuri_type</code>），
              以獨立樣式標示且<strong>不提供來源連結</strong>。
            </li>
            <li>
              <strong>第三方 / third_party</strong>：來自第三方用戶編輯資料庫（如 AniList），
              可信度低於官方來源，頁面上會明確標示。
            </li>
          </ul>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <code className="mono">field_confidence</code> 是「這個欄位填得多確定」，與來源本身的可信度分開計分。
            </li>
            <li>
              <code className="mono">sources[]</code> 是整筆紀錄層級的來源清單，每筆都帶 <code className="mono">retrieved_at</code> 與 <code className="mono">confidence</code>。
            </li>
            <li>值為 null 或空時一律顯示 <span className="unknown-value">unknown</span>，不做任何推測填充。</li>
            <li>
              收錄<strong>不以「是否有官方中文版」為條件</strong>：只有民間漢化的作品同樣在庫內，
              但本站不提供任何非官方取得方式。
            </li>
          </ul>
        </div>
      </SectionCard>
    </div>
  );
}
