/**
 * /anime — 百合動畫 (yuri anime) catalogue.
 *
 * Covers the four categories the user named — 漫改 (manga), 輕小說改 (light novel
 * & friends), 原創 TV 動畫 (original + tv) and 劇場版 (movie) — plus OVA/ONA/
 * SPECIAL and the entries that are announced but not yet aired.
 *
 * This page is a SERVER component rendered once at build time into static HTML:
 * the intro, the AniList provenance warning and the 口徑 notes are real text in
 * `out/anime/index.html`, not something a browser has to hydrate. Everything that
 * depends on the URL query string — the preset chips, the filter panel and the
 * result grid — lives in components/AnimeBrowser.tsx, which filters the client-side
 * projection (lib/anime-slim.json) in the browser.
 *
 * The Suspense boundary is REQUIRED: AnimeBrowser calls `useSearchParams()`, and
 * Next refuses to statically export a page that reads search params without one.
 * The counts printed below come from the FULL dataset (data/anime.json) at build
 * time; scripts/verify-anime.mjs asserts that the slim projection the browser
 * filters is equivalent to it, so the two numbers cannot drift apart.
 */
import { Suspense } from 'react';
import Link from 'next/link';

import { AnimeBrowser } from '@/components/AnimeBrowser';
import { Pill, SectionCard, UnknownValue } from '@/components/ui';
import { getAnime, getAnimeGeneratedAt, getAnimeReport } from '@/lib/anime';
import { UNRECORDED_ZH_TITLE_NOTE } from '@/lib/anime-labels';
import { formatTimestamp } from '@/lib/policy';
import type { Anime } from '@/lib/anime-types';

function BrowserFallback() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-500">
      載入動畫清單中⋯（若持續顯示此訊息，代表瀏覽器未執行 JavaScript；
      篩選功能需要 JavaScript，但下方說明與每一部動畫的詳細頁都是預先產生的靜態 HTML，可直接閱讀。）
    </div>
  );
}

export default function AnimeListPage() {
  let anime: Anime[] = [];
  let generatedAt: string | null = null;
  let loadError: string | null = null;
  try {
    anime = getAnime();
    generatedAt = getAnimeGeneratedAt();
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }

  const report = getAnimeReport();
  const castWithoutVoiceActor = anime
    .flatMap((entry) => entry.main_cast)
    .filter((member) => !member.voice_actor).length;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-bold text-zinc-900 sm:text-2xl">百合動畫資料庫</h1>
        <p className="mt-1 text-sm text-zinc-700">
          收錄 {anime.length} 部百合動畫，含漫改、輕小說改、原創 TV 動畫、劇場版與 OVA／ONA／特別篇，
          以及<strong>已宣布動畫化但尚未播出</strong>的條目。每筆都列出開播時間、主要聲優（角色＋聲優）與製作公司。
          資料匯出於 {generatedAt ? formatTimestamp(generatedAt) : 'unknown'}。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill tone="plain">純靜態輸出，無需伺服器</Pill>
          <Pill tone="plain">篩選狀態全部在網址列</Pill>
          <Pill tone="plain">null ⇒ unknown／未收錄</Pill>
          <Pill tone="accent">排程更新，非即時</Pill>
        </div>
        <p className="mt-3 text-xs text-zinc-600">
          相關頁面：<Link href="/">漫畫／輕小說資料庫</Link> · <Link href="/sources">資料來源</Link> ·{' '}
          <Link href="/data-quality">資料品質</Link>（含動畫覆蓋率）
        </p>
      </section>

      {/* ---------------------------------------------------------------- *
       * Provenance warning — AniList is NOT an official source
       * ---------------------------------------------------------------- */}
      <section className="callout callout-warn">
        <p className="font-semibold text-zinc-800">
          這一節的資料<strong>全部來自 AniList（第三方資料庫）</strong>，不是官方來源。
        </p>
        <p className="mt-1 text-sm text-zinc-700">
          本目錄每一筆的 <code className="mono">sources[].basis</code> 都是{' '}
          <span className="badge badge-third_party">第三方資料庫 / third_party</span>
          ，來源為 <code className="mono">an_anilist</code>（AniList GraphQL API）。
          AniList 是使用者可編輯的資料庫，開播時間、聲優、製作公司都可能滯後或有誤；
          本站只做轉載與標示，<strong>不主張任何欄位為官方公告</strong>。請以官方網站與官方社群公告為準。
          {report?.collection_note ? (
            <>
              {' '}
              收錄範圍：<span className="text-zinc-700">{report.collection_note}</span>
            </>
          ) : null}
        </p>
      </section>

      {loadError ? (
        <SectionCard title="無法載入動畫資料集">
          <p className="mono text-sm text-zinc-700">{loadError}</p>
        </SectionCard>
      ) : null}

      <Suspense fallback={<BrowserFallback />}>
        <AnimeBrowser />
      </Suspense>

      {/* ---------------------------------------------------------------- *
       * Two discipline notes: titles and unknown values
       * ---------------------------------------------------------------- */}
      <SectionCard
        title="三語標題一律顯示，缺值就寫未收錄"
        subtitle="title_ja 必有值；title_zh_tw 與 title_zh_cn 在本資料集內全部為 null。"
      >
        <p className="text-sm text-zinc-700">{UNRECORDED_ZH_TITLE_NOTE}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">
          <li>
            <code className="mono">title_ja</code>：必有值（schema <code className="mono">required</code>），是本目錄的主鍵欄位。
          </li>
          <li>
            <code className="mono">title_zh_tw</code>／<code className="mono">title_zh_cn</code>：
            目前 <UnknownValue label="全部為 null" />，卡片與詳細頁一律顯示「未收錄（來源未提供）」，
            不會隱藏欄位、也不會拿日文標題假裝成中文譯名。
          </li>
          <li>
            <code className="mono">title_romaji</code>／<code className="mono">title_en</code>：AniList 有提供，
            缺值時同樣顯示 <UnknownValue />。
          </li>
        </ul>
      </SectionCard>

      <SectionCard title="其他口徑說明" subtitle="這些差異會影響你怎麼解讀畫面上的數字。">
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">
          <li>
            <strong>年份口徑</strong>：以 <code className="mono">season_year</code> 優先，null 時才取{' '}
            <code className="mono">start_date</code> 的年份；這與管線報告的{' '}
            <code className="mono">by_year</code> 相同，少數跨年作品（例如 12 月開播的 OVA）因此會歸在隔年的季。
          </li>
          <li>
            <strong>開播時間</strong>：<code className="mono">start_date</code> 可以是 <code className="mono">YYYY</code>／
            <code className="mono">YYYY-MM</code>／<code className="mono">YYYY-MM-DD</code>，本站照原文顯示，不補齊精度。
            未定檔或已宣布未播出者為 null，顯示「未定／unknown」。
          </li>
          <li>
            <strong>聲優</strong>：只收 AniList 標記為 MAIN 的角色，且只取日語聲優（schema 定義）。
            本資料集有 {castWithoutVoiceActor} 筆角色未對應到聲優，一律顯示「聲優 unknown」。
          </li>
          <li>
            <strong>成人內容</strong>：<code className="mono">is_adult</code> 全部為 false——採集時已排除 R18
            （見 <Link href="/data-quality">資料品質</Link> 的動畫覆蓋率）。
          </li>
        </ul>
      </SectionCard>
    </div>
  );
}
