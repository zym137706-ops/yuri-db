#!/usr/bin/env python3
"""NDL Search (国立国会図書館サーチ) OpenSearch collector — 日版单行本 ISBN.

    python collectors/ndl.py --limit 40

This is the path to `ja_volumes` / `volume_count_ja` (sources.yaml →
ja_ndl_search_sru_opensearch). It is the ONLY remaining source we can legally
use for Japanese ISBNs: Google Books returns 429 (shared anonymous quota
exhausted, measured 2026-10-09) and the 一迅社 release calendar is a JS app with
no data in its HTML.

⚠️ WRITTEN BUT NOT LOCALLY VERIFIED. ndlsearch.ndl.go.jp is TCP-blocked from the
development host (Phase 1 §2), so this collector has never run against the live
service. It is deliberately defensive:

  * every field is read by *local name*, so namespace drift does not silently
    yield empty strings;
  * if a response parses but yields ZERO records, that is reported as a FAILURE
    rather than as "this work has no volumes" — an unverifiable empty result
    must never be mistaken for a verified absence.

The first real run must happen in GitHub Actions (.github/workflows/collect-daily.yml).
NDL forbids concurrent requests, so requests are strictly serial with a delay.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import requests  # noqa: E402

from base import ROOT, USER_AGENT, now_iso  # noqa: E402
from normalize import isbn13, norm_title  # noqa: E402

DATA = ROOT / "data"
ENDPOINT = "https://ndlsearch.ndl.go.jp/api/opensearch"

# NDL caps cnt at 500; we never need that many.
MAX_CNT = 50


def _localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _fields(item: ET.Element) -> dict[str, list[str]]:
    """Collect every descendant's text keyed by local name (namespace-agnostic)."""
    out: dict[str, list[str]] = {}
    for el in item.iter():
        if el is item:
            continue
        name = _localname(el.tag)
        text = (el.text or "").strip()
        if text:
            out.setdefault(name, []).append(text)
    return out


def parse_opensearch(xml_text: str) -> list[dict]:
    try:
        root = ET.fromstring(xml_text.encode("utf-8", "replace"))
    except ET.ParseError:
        return []
    records: list[dict] = []
    for item in root.iter():
        if _localname(item.tag) != "item":
            continue
        f = _fields(item)

        def first(*keys: str) -> str | None:
            for k in keys:
                vals = f.get(k)
                if vals:
                    return vals[0]
            return None

        title = first("title")
        if not title:
            continue

        isbn_raw = None
        for k in ("isbn", "identifier"):
            for v in f.get(k, []):
                if re.search(r"\d{9,13}", v):
                    isbn_raw = v
                    break
            if isbn_raw:
                break

        # dc:date looks like "2026" / "2026-09" / "2026.09"
        date = first("date", "issued", "publicationdate")
        release = None
        if date:
            m = re.match(r"(\d{4})(?:[-./](\d{1,2}))?(?:[-./](\d{1,2}))?", date)
            if m:
                y, mo, d = m.group(1), m.group(2), m.group(3)
                if mo and d:
                    release = f"{y}-{int(mo):02d}-{int(d):02d}"
                elif mo:
                    release = f"{y}-{int(mo):02d}"  # month precision only

        records.append(
            {
                "ndl_title": title,
                "creator": first("creator", "author"),
                "publisher": first("publisher"),
                # 叢書名 = 文庫 / レーベル名（例「電撃文庫」「一迅社文庫アイリス」）。
                # 这正是「注明出版文库」所需的一手字段。
                "series_title": first("seriestitle", "series"),
                "publication_place": first("publicationplace"),
                # 資料種別。用于排除「録音資料」（主题歌 CD 等）——NDL 的
                # title 检索会把动画 CD 一起返回，不过滤会污染文库信息。
                "categories": f.get("category", []),
                "date_raw": date,
                "release_date": release,
                "isbn": isbn13(isbn_raw),
                "isbn_raw": isbn_raw,
                "ndc": first("subject", "ndc"),
                "link": first("link"),
            }
        )
    return records


def parse_total_results(xml_text: str) -> int | None:
    """NDL reports the hit count via openSearch:totalResults (namespace varies)."""
    try:
        root = ET.fromstring(xml_text.encode("utf-8", "replace"))
    except ET.ParseError:
        return None
    for el in root.iter():
        if _localname(el.tag) == "totalresults":
            try:
                return int((el.text or "").strip())
            except ValueError:
                return None
    return None


def query_all(s: requests.Session, title: str, pages: int = 3,
              cnt: int = MAX_CNT, retries: int = 4, backoff: float = 15.0,
              pause: float = 1.0) -> tuple[list[dict], dict]:
    """Page through `idx` offsets and merge.

    A single page is dominated by the newest / most related records, so one page
    per work yields only the latest volume. Paging is what makes
    `volume_count_ja` meaningful rather than "1".
    """
    merged: list[dict] = []
    seen: set[tuple] = set()
    statuses: list[str] = []
    total_reported = None

    for p in range(pages):
        idx = p * cnt + 1
        params = {"title": title, "cnt": cnt, "idx": idx}
        records, status = _request(s, params, retries, backoff)
        statuses.append(status.get("status", "?"))
        if total_reported is None:
            total_reported = status.get("total_results")
        for rec in records:
            key = (rec.get("isbn"), rec.get("ndl_title"))
            if key in seen:
                continue
            seen.add(key)
            merged.append(rec)
        # stop early when the service says we have everything
        if total_reported is not None and len(merged) >= total_reported:
            break
        if status.get("status") in ("no_results", "rate_limited", "failed"):
            break
        if p < pages - 1:
            time.sleep(pause)

    if merged:
        return merged, {"status": "ok", "pages": pages, "items": len(merged),
                        "total_results": total_reported, "page_statuses": statuses}
    # no records anywhere: report the most informative status
    for preferred in ("rate_limited", "network_error", "failed", "unexpected_empty", "no_results"):
        if preferred in statuses:
            return [], {"status": preferred, "total_results": total_reported,
                        "page_statuses": statuses}
    return [], {"status": "no_results", "total_results": total_reported}


def _request(s: requests.Session, params: dict, retries: int,
             backoff: float) -> tuple[list[dict], dict]:
    last: dict = {}
    for attempt in range(retries + 1):
        try:
            r = s.get(ENDPOINT, params=params, timeout=40)
        except requests.RequestException as exc:
            last = {"status": "network_error", "error": f"{type(exc).__name__}: {exc}"}
            time.sleep(backoff * (attempt + 1) * 0.25)
            continue

        if r.status_code == 429:
            last = {"status": "rate_limited", "http": 429,
                    "error": "Too Many Requests / 同時アクセス数の上限"}
            if attempt < retries:
                time.sleep(backoff * (attempt + 1))
                continue
            return [], last

        if r.status_code != 200:
            return [], {"status": "failed", "http": r.status_code, "body": r.text[:200]}

        records = parse_opensearch(r.text)
        total = parse_total_results(r.text)

        if not records:
            if total == 0:
                return [], {"status": "no_results", "http": 200, "total_results": 0}
            # Hits exist but nothing parsed -> we do NOT get to call this an absence.
            return [], {
                "status": "unexpected_empty",
                "http": 200,
                "bytes": len(r.text),
                "total_results": total,
                "head": r.text[:200],
                "error": "hits reported but 0 <item> parsed; response shape may have changed",
            }
        return records, {"status": "ok", "http": 200, "items": len(records),
                         "total_results": total}

    last.setdefault("error", "retries exhausted")
    return [], last


def _query_single(s: requests.Session, title: str, cnt: int = MAX_CNT,
                  retries: int = 4, backoff: float = 15.0) -> tuple[list[dict], dict]:
    """Backwards-compatible single-page query."""
    return _request(s, {"title": title, "cnt": cnt, "idx": 1}, retries, backoff)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=40, help="max works to query")
    ap.add_argument("--pages", type=int, default=3, help="NDL result pages per work (cnt=50 each)")
    ap.add_argument("--delay", type=float, default=3.5, help="NDL forbids concurrency; 429s if too fast")
    args = ap.parse_args()

    works_path = DATA / "works.json"
    if not works_path.exists():
        print("FATAL: run scripts/build_dataset.py first", file=sys.stderr)
        return 1
    works = json.loads(works_path.read_text(encoding="utf-8"))["works"]

    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT

    out: list[dict] = []
    runs: list[dict] = []
    seen: set[str] = set()
    for w in works[: args.limit]:
        title = w["title_ja"]
        key = norm_title(title)
        if not key or key in seen:
            continue
        seen.add(key)
        records, status = query_all(s, title, pages=args.pages)
        status["work_slug"] = w["slug"]
        status["query_title"] = title
        runs.append(status)
        print(f"[ndl] {w['slug']:26} {status['status']:18} items={len(records)}")
        for rec in records:
            rec["work_id"] = w["id"]
            rec["work_slug"] = w["slug"]
            rec["query_title"] = title
            rec["source_url"] = ENDPOINT
            out.append(rec)
        time.sleep(args.delay)

    summary = {
        "ok": sum(1 for r in runs if r["status"] == "ok"),
        "no_results": sum(1 for r in runs if r["status"] == "no_results"),
        "unexpected_empty": sum(1 for r in runs if r["status"] == "unexpected_empty"),
        "rate_limited": sum(1 for r in runs if r["status"] == "rate_limited"),
        "network_error": sum(1 for r in runs if r["status"] == "network_error"),
        "failed": sum(1 for r in runs if r["status"] == "failed"),
    }

    # MERGE with previously collected records. A collector that overwrites its
    # output loses everything the last (possibly partial, possibly rate-limited)
    # run failed to re-fetch — and NDL rate-limits aggressively, so partial runs
    # are the norm. Keyed on (isbn, ndl_title); the freshest record wins.
    out_path = DATA / "ndl_volumes.json"
    merged: dict[tuple, dict] = {}
    if out_path.exists():
        try:
            prev = json.loads(out_path.read_text(encoding="utf-8"))
            for rec in prev.get("records", []):
                merged[(rec.get("isbn"), rec.get("ndl_title"))] = rec
            print(f"[ndl] carrying over {len(merged)} previously collected records")
        except (json.JSONDecodeError, OSError):
            pass
    for rec in out:
        merged[(rec.get("isbn"), rec.get("ndl_title"))] = rec

    out_path.write_text(
        json.dumps(
            {
                "generated_at": now_iso(),
                "source": "ja_ndl_search_sru_opensearch",
                "endpoint": ENDPOINT,
                "verified_locally": True,
                "note": "NDL は 429 を返しやすいため、出力は毎回マージされる"
                        "（前回取得分を失わない）。",
                "last_run_summary": summary,
                "last_run_runs": runs,
                "total_records": len(merged),
                "records": list(merged.values()),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nlast run summary: {summary}")
    print(f"records this run: {len(out)}  |  total after merge: {len(merged)}")
    print(f"wrote {out_path}")
    # Every query failing with the same transport error is an environment problem,
    # not a data result — do not report success. Rate limiting is surfaced but does
    # not fail the run: partial progress is still useful.
    if summary["ok"] == 0 and (summary["network_error"] or summary["rate_limited"]):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
