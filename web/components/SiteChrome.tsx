/**
 * Site header + footer.
 *
 * The footer carries the required disclosure: the data is refreshed by a
 * scheduled pipeline (not real-time), together with the exact export timestamp
 * and a link to the sources page.
 */
import Link from 'next/link';

import { formatTimestamp, relativeAge } from '@/lib/policy';

const NAV = [
  { href: '/', label: '搜尋／瀏覽' },
  { href: '/anime', label: '百合動畫' },
  { href: '/sources', label: '資料來源' },
  { href: '/data-quality', label: '資料品質' },
  { href: '/changelog', label: '更新日誌' },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="flex items-baseline gap-2 no-underline">
          <span className="text-lg font-bold tracking-tight text-pink-800">百合 DB</span>
          <span className="text-xs text-zinc-500">日本百合漫畫／輕小說資料庫 · Phase 4 MVP</span>
        </Link>
        <nav aria-label="主導覽">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-zinc-700 no-underline hover:text-pink-800">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter({
  generatedAt,
  workCount,
  sourceCount,
  animeCount = 0,
}: {
  generatedAt: string | null;
  workCount: number;
  sourceCount: number;
  /** Entries in data/anime.json; 0 when the anime dataset is unavailable. */
  animeCount?: number;
}) {
  const age = generatedAt ? relativeAge(generatedAt) : null;
  return (
    <footer className="mt-12 border-t border-zinc-200 bg-white">
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-6 text-sm text-zinc-600">
        <div className="callout callout-info">
          <p className="font-semibold text-zinc-800">資料更新方式：排程管線，非即時</p>
          <p className="mt-1">
            本站資料由<strong>每日排程的採集管線</strong>產生後匯出為檔案，並非即時查詢。
            畫面上的數值可能落後於上游網站；每筆紀錄都附上各自的
            <code className="mono">retrieved_at</code>（取得時間）與來源連結，請以原始來源為準。
          </p>
          <p className="mt-1">
            本次匯出時間：
            <strong>{formatTimestamp(generatedAt)}</strong>
            {age ? `（約 ${age}）` : null}
            。收錄 {workCount} 筆作品、{animeCount} 部動畫、{sourceCount} 條已登錄來源。
          </p>
          <p className="mt-1">
            想知道每個欄位是從哪裡來的？
            <Link href="/sources">前往資料來源頁</Link>
            查看全部 94 條來源，或見
            <Link href="/data-quality">資料品質</Link>
            的欄位完整度與溯源覆蓋率；百合動畫目錄見
            <Link href="/anime">百合動畫</Link>。
          </p>
        </div>

        <div className="flex flex-col gap-2 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            合規聲明：本資料庫只收錄官方授權中文版資訊，不索引、不儲存任何盜版或漢化發布內容與連結。
            評分僅存聚合分數與件數，評論正文不入庫（可行性報告 §5.2）。
          </p>
          <p className="shrink-0">
            <Link href="/sources">資料來源（94）</Link>
            {' · '}
            <Link href="/changelog">更新日誌</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
