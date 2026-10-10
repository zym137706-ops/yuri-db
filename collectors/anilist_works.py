#!/usr/bin/env python3
"""AniList 作品目录采集器 —— 漫画 / 轻小说 / Web 小说。

    python collectors/anilist_works.py --pages 12

产出 data/anilist_works.json，由 scripts/build_dataset.py 合并进 works.json。

为什么需要它：
  项目此前只接了「コミック百合姫」与「ガレット」两个**漫画**源，
  结果 49 部作品全是 manga，**一部轻小说都没有**。

AniList 的 `type: MANGA` 同时包含漫画与轻小说，用 `format` 区分：
    MANGA / ONE_SHOT -> media_type = manga
    NOVEL            -> media_type = light_novel（ラノベ・Web小説の単行本）

注意 AniList 的 Yuri 标签很宽（含大量擦边作），因此用 `tags.rank` 过滤，
并把 rank 一并存下来，用于回答「为何收录此条」。

合规：AniList ToS 非商用、禁止当数据存储/备份、禁止 hoarding
（sources.yaml → an_anilist）。因此只取作品介绍所需字段。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from hashlib import sha1
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import requests  # noqa: E402

from base import ROOT, USER_AGENT, now_iso  # noqa: E402

DATA = ROOT / "data"
ENDPOINT = "https://graphql.anilist.co"

# AniList 的 format -> 我们的 media_type
FORMAT_TO_MEDIA = {
    "MANGA": "manga",
    "ONE_SHOT": "manga",
    "NOVEL": "light_novel",
}

QUERY = """
query ($page: Int, $perPage: Int, $format: MediaFormat) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage currentPage }
    media(type: MANGA, format: $format, tag: "Yuri", sort: [POPULARITY_DESC]) {
      id
      idMal
      title { native romaji english }
      format
      status
      source
      startDate { year month day }
      endDate { year month day }
      volumes
      chapters
      countryOfOrigin
      isAdult
      averageScore
      popularity
      genres
      tags { name rank isMediaSpoiler }
      staff(perPage: 4) { edges { role node { name { native full } } } }
      coverImage { large }
      siteUrl
    }
  }
}
"""

ROLE_AUTHOR = ("story", "original creator", "original story", "author")
ROLE_ILLUSTRATOR = ("illustration", "art", "character design")


def iso(d: dict | None) -> str | None:
    if not d or not d.get("year"):
        return None
    return f"{d['year']:04d}-{d.get('month') or 1:02d}-{d.get('day') or 1:02d}"


def yuri_rank(tags: list[dict]) -> int | None:
    for t in tags or []:
        if (t.get("name") or "").lower() == "yuri":
            return t.get("rank")
    return None


def classify(staff_edges: list[dict]) -> tuple[list[str], list[str]]:
    """Split AniList staff into authors vs illustrators.

    Order matters: AniList's common role string is "Story & Art", which contains
    BOTH keywords.  Checking illustration first (the original bug) filed every
    manga-ka as an illustrator and left `authors` empty for ~77% of records.
    "Story & Art" therefore goes into both lists.
    """
    authors, illustrators = [], []
    for e in staff_edges or []:
        role = (e.get("role") or "").lower()
        name = ((e.get("node") or {}).get("name") or {}).get("native") \
            or ((e.get("node") or {}).get("name") or {}).get("full")
        if not name:
            continue
        is_author = any(r in role for r in ROLE_AUTHOR) or "story" in role
        is_illust = any(r in role for r in ROLE_ILLUSTRATOR)
        if is_author and name not in authors:
            authors.append(name)
        if is_illust and name not in illustrators:
            illustrators.append(name)
    return authors, illustrators


def slugify(title: str, aid: int) -> str:
    base = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-zA-Z0-9]+", "-", base).strip("-").lower()
    return base[:56] if len(base) >= 2 else f"w-anilist-{aid}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=12, help="每个 format 的页数（每页 50）")
    ap.add_argument("--sleep", type=float, default=3.0)
    ap.add_argument("--min-yuri-rank", type=int, default=60)
    ap.add_argument("--include-adult", action="store_true")
    args = ap.parse_args()

    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Content-Type": "application/json"})

    raw: list[dict] = []
    fetches: list[dict] = []
    for fmt in ("MANGA", "NOVEL", "ONE_SHOT"):
        for page in range(1, args.pages + 1):
            body = {"query": QUERY, "variables": {"page": page, "perPage": 50, "format": fmt}}
            try:
                r = s.post(ENDPOINT, json=body, timeout=45)
            except requests.RequestException as exc:
                fetches.append({"format": fmt, "page": page, "status": "network_error",
                                "error": f"{type(exc).__name__}: {exc}"})
                print(f"[works] {fmt} p{page}: network_error")
                break
            if r.status_code == 429:
                fetches.append({"format": fmt, "page": page, "status": "rate_limited"})
                print(f"[works] {fmt} p{page}: 429 backoff")
                time.sleep(30)
                continue
            if r.status_code != 200:
                fetches.append({"format": fmt, "page": page, "status": "failed",
                                "http": r.status_code})
                print(f"[works] {fmt} p{page}: HTTP {r.status_code}")
                break
            payload = r.json()
            if payload.get("errors"):
                fetches.append({"format": fmt, "page": page, "status": "graphql_error",
                                "errors": payload["errors"]})
                print(f"[works] {fmt} p{page}: GraphQL {payload['errors'][0].get('message')}")
                break
            block = (payload.get("data") or {}).get("Page") or {}
            media = block.get("media") or []
            for m in media:
                m["_requested_format"] = fmt
            raw.extend(media)
            fetches.append({"format": fmt, "page": page, "status": "ok", "items": len(media)})
            print(f"[works] {fmt:7} p{page:2}: {len(media):3} (cumulative {len(raw)})")
            if not (block.get("pageInfo") or {}).get("hasNextPage"):
                break
            time.sleep(args.sleep)

    # ------------------------------------------------------------- filter
    kept, dropped = [], {"adult": 0, "low_rank": 0, "no_title": 0}
    for m in raw:
        if not args.include_adult and m.get("isAdult"):
            dropped["adult"] += 1
            continue
        rank = yuri_rank(m.get("tags"))
        if rank is None or rank < args.min_yuri_rank:
            dropped["low_rank"] += 1
            continue
        if not ((m.get("title") or {}).get("native")):
            dropped["no_title"] += 1
            continue
        kept.append(m)

    # --------------------------------------------------------- normalise
    entries = []
    for m in kept:
        native = m["title"]["native"]
        romaji = (m.get("title") or {}).get("romaji")
        authors, illustrators = classify((m.get("staff") or {}).get("edges") or [])
        aid = m["id"]
        entries.append({
            "source_id": "an_anilist",
            "anilist_id": aid,
            "mal_id": m.get("idMal"),
            "slug": slugify(romaji or native, aid),
            "title_ja": native,
            "title_romaji": romaji,
            "title_en": (m.get("title") or {}).get("english"),
            "media_type": FORMAT_TO_MEDIA.get(m.get("format") or "", "manga"),
            "anilist_format": m.get("format"),
            "status": {
                "RELEASING": "ongoing", "FINISHED": "completed",
                "NOT_YET_RELEASED": "unknown", "HIATUS": "hiatus",
                "CANCELLED": "completed",
            }.get(m.get("status") or "", "unknown"),
            "start_date": iso(m.get("startDate")),
            "end_date": iso(m.get("endDate")),
            "volume_count": m.get("volumes"),
            "chapter_count": m.get("chapters"),
            "authors": authors,
            "illustrators": illustrators,
            "genres": ["百合"],
            "yuri_tag_rank": yuri_rank(m.get("tags")),
            "average_score": m.get("averageScore"),
            "popularity": m.get("popularity"),
            "country_of_origin": m.get("countryOfOrigin"),
            "is_adult": bool(m.get("isAdult")),
            "cover_url": (m.get("coverImage") or {}).get("large"),
            "source_url": m.get("siteUrl") or f"https://anilist.co/manga/{aid}",
        })

    by_id = {e["anilist_id"]: e for e in entries}
    seen: dict[str, int] = {}
    for e in by_id.values():
        if e["slug"] in seen:
            seen[e["slug"]] += 1
            e["slug"] = f"{e['slug']}-{seen[e['slug']]}"
        else:
            seen[e["slug"]] = 1
    entries = sorted(by_id.values(), key=lambda e: (-(e.get("yuri_tag_rank") or 0), e["title_ja"]))

    by_media: dict[str, int] = {}
    for e in entries:
        by_media[e["media_type"]] = by_media.get(e["media_type"], 0) + 1

    (DATA / "anilist_works.json").write_text(
        json.dumps({
            "generated_at": now_iso(),
            "source": "an_anilist",
            "endpoint": ENDPOINT,
            "license_note": "AniList ToS: 非商用；禁止当数据存储/备份；禁止 hoarding。"
                            "仅取作品介绍所需字段；Yuri 标签相关度一并保留以便说明收录理由。",
            "min_yuri_rank": args.min_yuri_rank,
            "fetches": fetches,
            "raw_fetched": len(raw),
            "dropped": dropped,
            "total": len(entries),
            "by_media_type": by_media,
            "entries": entries,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nraw={len(raw)} dropped={dropped} kept={len(entries)}")
    print("by media_type:", by_media)
    print(f"wrote {DATA / 'anilist_works.json'}")
    return 0 if entries else 1


if __name__ == "__main__":
    raise SystemExit(main())
