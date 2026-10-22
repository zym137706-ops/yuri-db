#!/usr/bin/env python3
"""Enrich works with publisher + label/文庫 + ISBN from NDL.

    python scripts/enrich_works_from_ndl.py --limit 300

需求背景：
  - AniList 提供标题/作者/卷数/封面/连载状态，但**不提供出版社与掲載誌/レーベル**；
  - 「日本的文库轻小说要注明出版文库」与「漫画库要有出版社」都需要这一层；
  - NDL 国会図書館サーチ 的 `publisher` 与 `seriesTitle` 正好是出版社与
    （文库 / レーベル名）的一手来源。

用法要点：
  - NDL 禁止并发且频繁 429/读超时，所以默认 **fail-fast（重试 1 次）**；
  - 输出为 **合并式写入**，可分批多次运行逐步补全（每天在 CI 里跑一批）；
  - `--only-missing` 默认开启，不重复查询上次已成功的标题。

输入  data/anilist_works.json
输出  data/ndl_enrichment.json
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collectors"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import requests  # noqa: E402

from base import ROOT, USER_AGENT  # noqa: E402
from ndl import ENDPOINT, query_all  # noqa: E402
from normalize import norm_title  # noqa: E402

DATA = ROOT / "data"
OUT = DATA / "ndl_enrichment.json"

# 图书类。其余（録音資料＝主题歌 CD、映像資料 等）一律排除——NDL 的 title 检索
# 会把动画 CD 一起返回，不排除会把「King Records」当成出版社。
BOOK_CATEGORIES = ("図書", "書籍", "和書", "洋書", "児童図書", "点字図書")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_label(raw: str | None) -> str | None:
    """NDL 的 seriesTitle 会带卷次/整理記号，例：
        「電撃文庫 ; 4034」            -> 電撃文庫
        「角川スニーカー文庫 ; い-10-3-1」 -> 角川スニーカー文庫
        「百合姫コミックス ; 3」        -> 百合姫コミックス
    只取分号前。"""
    if not raw:
        return None
    head = re.split(r"\s*[;；]\s*", raw.strip())[0].strip()
    head = re.sub(r"\s*[（(][^）)]*[）)]\s*$", "", head).strip()
    return head or None


def is_book(rec: dict) -> bool:
    cats = rec.get("categories") or []
    if not cats:
        return True
    return any(any(b in c for b in BOOK_CATEGORIES) for c in cats)


def best_match(title: str, records: list[dict]) -> dict | None:
    """只接受**精确**标题匹配。

    这里刻意不做前缀匹配。曾经做过，结果 162 条补全里有 15 条是错的，例如：

        やがて君になる   -> やがて君になる公式コミックアンソロジー（レーベル 電撃コミックスNEXT）
        志乃と恋         -> 志乃と恋Future（不同作品）
        安達としまむら   -> 安達としまむら（９）（其实是漫画版，レーベル 電撃コミックスNEXT）
        ケイヤクシマイ   -> ケイヤクシマイ【分冊版】11

    后果是把**漫画的レーベル / ISBN / 发售日**写进了轻小说记录。NDL 的書志里
    轻小说与漫画是两条不同记录（前者 seriesTitle 通常是ノベルレーベル，
    后者是コミックスレーベル），所以「标题完全一致」是最可靠的分界。
    少补几条 publisher 远好过补错一条。
    """
    key = norm_title(title)
    for r in records:
        if not is_book(r) or not r.get("ndl_title"):
            continue
        if norm_title(r["ndl_title"]) == key:
            return r
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=300)
    ap.add_argument("--delay", type=float, default=2.5)
    ap.add_argument("--pages", type=int, default=1)
    ap.add_argument("--retries", type=int, default=1, help="NDL 常读超时，默认快速失败")
    ap.add_argument("--backoff", type=float, default=4.0)
    ap.add_argument("--media-type", default="all", choices=["all", "manga", "light_novel"])
    ap.add_argument("--priority", default="light_novel",
                    help="先补哪一类（light_novel 优先，因为文库是明确需求）")
    args = ap.parse_args()

    src = DATA / "anilist_works.json"
    if not src.exists():
        print("FATAL: run collectors/anilist_works.py first", file=sys.stderr)
        return 1
    entries = json.loads(src.read_text(encoding="utf-8"))["entries"]
    if args.media_type != "all":
        entries = [e for e in entries if e["media_type"] == args.media_type]
    # 轻小说优先，其余按 yuri 相关度
    entries.sort(key=lambda e: (e["media_type"] != args.priority, -(e.get("yuri_tag_rank") or 0)))

    previous: dict[str, dict] = {}
    tried: set[str] = set()
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding="utf-8"))
            for r in prev.get("records", []):
                previous[r["title_ja"]] = r
            for r in prev.get("last_run", {}).get("runs", []):
                if r.get("title"):
                    tried.add(r["title"])
        except (json.JSONDecodeError, OSError):
            pass

    todo = [e for e in entries if e["title_ja"] not in tried][: args.limit]
    print(f"carried over {len(previous)} enriched records; this run: {len(todo)} titles")

    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT

    runs: list[dict] = []
    for i, w in enumerate(todo, 1):
        records, status = query_all(s, w["title_ja"], pages=args.pages,
                                    retries=args.retries, backoff=args.backoff)
        status["title"] = w["title_ja"]
        status["media_type"] = w["media_type"]
        runs.append(status)
        hit = best_match(w["title_ja"], records)
        if hit:
            previous[w["title_ja"]] = {
                "title_ja": w["title_ja"],
                "media_type": w["media_type"],
                "ndl_title": hit["ndl_title"],
                "publisher_ja": hit.get("publisher"),
                "label": clean_label(hit.get("series_title")),
                "label_raw": hit.get("series_title"),
                "isbn": hit.get("isbn"),
                "release_date": hit.get("release_date"),
                "publication_place": hit.get("publication_place"),
                "categories": hit.get("categories"),
                "source_url": hit.get("link") or ENDPOINT,
            }
        print(f"[ndl] {i:3}/{len(todo)} {w['media_type'][:11]:11} {w['title_ja'][:26]:28} "
              f"{status['status']:10} "
              f"{('-> ' + str((hit or {}).get('publisher')) + ' / ' + str(clean_label((hit or {}).get('series_title')))) if hit else '-> no match'}")
        time.sleep(args.delay)

    records = sorted(previous.values(), key=lambda r: (r["media_type"], r["title_ja"]))
    OUT.write_text(
        json.dumps({
            "generated_at": now_iso(),
            "source": "ja_ndl_search_sru_opensearch",
            "endpoint": ENDPOINT,
            "note": "只保留 category 为图书类的记录。publisher=出版社，"
                    "label=seriesTitle（轻小说为文库名，漫画为レーベル名）。"
                    "合并式写入：可分批多次运行逐步补全。",
            "total": len(records),
            "by_media_type": {
                mt: sum(1 for r in records if r["media_type"] == mt)
                for mt in ("manga", "light_novel")
            },
            "with_publisher": sum(1 for r in records if r.get("publisher_ja")),
            "with_label": sum(1 for r in records if r.get("label")),
            "with_isbn": sum(1 for r in records if r.get("isbn")),
            "last_run": {"queried": len(todo), "runs": runs},
            "records": records,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\ntotal enriched (cumulative): {len(records)} | publisher: "
          f"{sum(1 for r in records if r.get('publisher_ja'))} | label: "
          f"{sum(1 for r in records if r.get('label'))}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
