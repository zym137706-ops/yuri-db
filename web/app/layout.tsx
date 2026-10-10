import type { Metadata } from 'next';

import './globals.css';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { getAnime } from '@/lib/anime';
import { getDatasetGeneratedAt, getRegisteredSources, getReviewSources, getWorks } from '@/lib/data';

export const metadata: Metadata = {
  title: {
    default: '百合 DB — 日本百合漫畫／輕小說連載與出版資料庫',
    template: '%s · 百合 DB',
  },
  description:
    '可搜尋、可篩選的日本百合漫畫／輕小說資料庫。每個欄位都附上來源、取得時間與把握度；無法確認的欄位一律標為 unknown。',
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  let generatedAt: string | null = null;
  let workCount = 0;
  let sourceCount = 0;
  let animeCount = 0;

  try {
    generatedAt = getDatasetGeneratedAt();
    workCount = getWorks().length;
  } catch {
    // The dataset is missing or malformed — each page renders its own error state.
  }

  try {
    animeCount = getAnime().length;
  } catch {
    // anime.json missing/malformed; /anime renders its own error state.
  }

  try {
    sourceCount = getRegisteredSources().length + getReviewSources().length;
  } catch {
    // sources.yaml unreadable; only the Sources page reports the detail.
  }

  return (
    <html lang="zh-Hant">
      <body className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        <SiteFooter
          generatedAt={generatedAt}
          workCount={workCount}
          sourceCount={sourceCount}
          animeCount={animeCount}
        />
      </body>
    </html>
  );
}
