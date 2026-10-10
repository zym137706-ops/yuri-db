/**
 * Next.js configuration — **fully static export**.
 *
 * The site is built to plain HTML/CSS/JS in `out/` and served by any static host.
 * There is deliberately no server runtime: no `next start`, no database, no cron
 * on the host. Scheduled updates happen in CI (see .github/workflows/deploy-static.yml).
 *
 * Consequences of `output: 'export'`:
 *   - every route must be statically renderable, so the list pages do their
 *     filtering in the browser from `lib/*-slim.json` (see scripts/build-slim.mjs);
 *   - `images.unoptimized` is required because the Next image optimizer is a
 *     server feature. We use plain <img> anyway and never mirror cover art.
 *
 * NEXT_BASE_PATH exists because GitHub Pages serves *project* sites from
 * `https://<user>.github.io/<repo>/`, not from the domain root. Without a
 * basePath, `/_next/...` would 404 in production while working fine locally.
 */
const basePath = process.env.NEXT_BASE_PATH || '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  // `/works/x/` -> `works/x/index.html`, which is what static hosts expect.
  trailingSlash: true,
  images: { unoptimized: true },
  /**
   * This export pre-renders 1141 pages (every Work and every Anime entry renders
   * all of its schema fields, its provenance tables and a raw-record disclosure),
   * and each page re-reads the multi-megabyte dataset in its worker. Next's default
   * budget is 60 s per page, which this catalogue exceeds under any load — an
   * earlier build failed with "took more than 60 seconds ... after 3 attempts" and
   * aborted the whole export. 300 s keeps a genuinely slow page from failing the
   * build without hiding a broken page (a page that cannot render still fails).
   */
  staticPageGenerationTimeout: 300,
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  /**
   * `basePath` only rewrites Next's own asset URLs. A plain `fetch('/data/...')`
   * inside a client component is NOT rewritten, so on a GitHub Pages PROJECT site
   * (served from /<repo>/) that request would 404 while `/_next/...` worked —
   * a failure that cannot reproduce locally at the domain root.
   * Inlining the prefix lets those fetches build the right URL in both cases.
   */
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
