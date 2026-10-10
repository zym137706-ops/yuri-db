import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-10">
      <h1 className="text-xl font-bold text-zinc-900">找不到這個作品</h1>
      <p className="text-sm text-zinc-700">
        此 slug 不在目前的資料集（<code className="mono">data/works.json</code>）中。
        資料集只收錄已完成匯出的作品；若剛新增，請等下一輪排程管線執行後再試。
      </p>
      <p className="text-sm">
        <Link href="/">← 回搜尋頁</Link>
      </p>
    </div>
  );
}
