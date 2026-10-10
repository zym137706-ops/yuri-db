/**
 * Layout for /anime.
 *
 * Exists for two reasons that the page itself can no longer provide once it
 * became a client component for the static export:
 *   1. `metadata` is server-only, so the SEO title/description live here;
 *   2. `useSearchParams()` requires a Suspense boundary somewhere ABOVE the
 *      component that calls it, so the shell is wrapped here.
 */
import { Suspense } from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '百合動畫',
  description:
    '百合動畫目錄：漫改、輕小說改、原創 TV 動畫與劇場版，含開播時間、主要聲優與製作公司；已宣布動畫化但未播出的條目亦一併收錄。資料來源為 AniList（第三方），逐欄位標示依據。',
};

export default function AnimeLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-500">
          載入動畫清單中⋯（若持續顯示此訊息，代表瀏覽器未執行 JavaScript；
          個別動畫的詳細頁是預先產生的靜態 HTML，可直接瀏覽。）
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
