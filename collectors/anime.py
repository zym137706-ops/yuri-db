#!/usr/bin/env python3
"""百合动画目录采集器（AniList GraphQL）。

    python collectors/anime.py --pages 20            # 采集目录 + 回填作品动画状态
    python collectors/anime.py --pages 20 --include-adult

产出两份文件：
    data/anime_catalog.json   百合动画目录（漫改 / 轻小说改 / 原创 / 剧场版 …）
    data/anime_status.json    与我们库里 Work 匹配上的动画状态（供 build_dataset 使用）

为什么用 AniList：
  - 它同时给出 `source`（MANGA / LIGHT_NOVEL / ORIGINAL …）→ 正好是用户要的
    「漫改 / 轻小说改 / 原创」分类；
  - `format`（TV / MOVIE / OVA / ONA）→ 区分 TV 动画与剧场版；
  - `status = NOT_YET_RELEASED` → 「已宣布但未播出」；
  - `characters(role: MAIN)` 的 edge 上有 `voiceActors(language: JAPANESE)`
    → 主要声优（注意：voiceActors 在 edge 上，不在 node 上，写错会 400）。

合规（sources.yaml → an_anilist，ToS）：
  - 仅非商用；
  - **禁止把 API 当数据存储/备份，禁止 hoarding**；
  - 因此这里只保留「作品介绍所必需」的字段（标题、放送日、集数、制作公司、
    主要角色与声优、封面链接），不做全量字段镜像，也不落库评论正文。
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
from normalize import norm_title  # noqa: E402

DATA = ROOT / "data"
ENDPOINT = "https://graphql.anilist.co"

# AniList 的 MediaSource → 我们要的「改编类型」
SOURCE_MAP = {
    "ORIGINAL": "original",
    "MANGA": "manga",
    "LIGHT_NOVEL": "light_novel",
    "WEB_NOVEL": "web_novel",
    "NOVEL": "novel",
    "VISUAL_NOVEL": "visual_novel",
    "VIDEO_GAME": "game",
    "GAME": "game",
    "DOUJINSHI": "doujinshi",
    "ANIME": "anime",
    "OTHER": "other",
    "MUSIC": "other",
    "PICTURE_BOOK": "other",
}

FORMAT_MAP = {
    "TV": "tv",
    "TV_SHORT": "tv_short",
    "MOVIE": "movie",
    "OVA": "ova",
    "ONA": "ona",
    "SPECIAL": "special",
    "MUSIC": "music",
}

STATUS_MAP = {
    "FINISHED": "finished",
    "RELEASING": "airing",
    "NOT_YET_RELEASED": "announced",
    "CANCELLED": "cancelled",
    "HIATUS": "hiatus",
}

QUERY = """
query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage currentPage total }
    media(type: ANIME, tag: "Yuri", sort: [POPULARITY_DESC]) {
      id
      idMal
      title { native romaji english }
      synonyms
      format
      status
      source
      episodes
      duration
      season
      seasonYear
      countryOfOrigin
      isAdult
      averageScore
      popularity
      startDate { year month day }
      endDate { year month day }
      studios(isMain: true) { nodes { name } }
      coverImage { large extraLarge }
      siteUrl
      tags { name rank isMediaSpoiler }
      characters(role: MAIN, sort: [ROLE, RELEVANCE], perPage: 8) {
        edges {
          role
          node { name { native full } }
          voiceActors(language: JAPANESE) { name { native full } }
        }
      }
    }
  }
}
"""


def iso(d: dict | None) -> str | None:
    if not d or not d.get("year"):
        return None
    return f"{d['year']:04d}-{d.get('month') or 1:02d}-{d.get('day') or 1:02d}"


def yuri_rank(tags: list[dict]) -> int | None:
    for t in tags or []:
        if (t.get("name") or "").lower() == "yuri":
            return t.get("rank")
    return None


def slugify(title: str, anilist_id: int) -> str:
    base = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-zA-Z0-9]+", "-", base).strip("-").lower()
    if len(base) >= 2:
        return base[:56]
    return f"anime-{anilist_id}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=20, help="每页 50 条；AniList 限速 30 req/min")
    ap.add_argument("--sleep", type=float, default=3.0)
    ap.add_argument("--min-yuri-rank", type=int, default=55,
                    help="Yuri 标签相关度下限（AniList 的 Yuri 标签很宽，含大量擦边作）")
    ap.add_argument("--include-adult", action="store_true", help="包含 R18（默认排除）")
    ap.add_argument("--include-non-jp", action="store_true", help="包含非日本制作（默认只留 JP）")
    args = ap.parse_args()

    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Content-Type": "application/json"})

    raw: list[dict] = []
    fetches: list[dict] = []
    for page in range(1, args.pages + 1):
        try:
            r = s.post(ENDPOINT, json={"query": QUERY,
                                       "variables": {"page": page, "perPage": 50}}, timeout=45)
        except requests.RequestException as exc:
            fetches.append({"page": page, "status": "network_error", "error": f"{type(exc).__name__}: {exc}"})
            print(f"[anime] page {page}: network_error")
            break
        if r.status_code == 429:
            fetches.append({"page": page, "status": "rate_limited", "http": 429})
            print(f"[anime] page {page}: 429, backing off")
            time.sleep(30)
            continue
        if r.status_code != 200:
            fetches.append({"page": page, "status": "failed", "http": r.status_code,
                            "body": r.text[:200]})
            print(f"[anime] page {page}: HTTP {r.status_code}")
            break
        payload = r.json()
        if payload.get("errors"):
            fetches.append({"page": page, "status": "graphql_error",
                            "errors": payload["errors"]})
            print(f"[anime] page {page}: GraphQL error {payload['errors'][0].get('message')}")
            break
        block = (payload.get("data") or {}).get("Page") or {}
        media = block.get("media") or []
        raw.extend(media)
        fetches.append({"page": page, "status": "ok", "items": len(media),
                        "total": (block.get("pageInfo") or {}).get("total")})
        print(f"[anime] page {page:2}: {len(media):3} items (cumulative {len(raw)})")
        if not (block.get("pageInfo") or {}).get("hasNextPage"):
            break
        time.sleep(args.sleep)

    # ---------------------------------------------------------------- filter
    kept: list[dict] = []
    dropped = {"adult": 0, "non_jp": 0, "low_rank": 0, "no_title": 0}
    for m in raw:
        if not args.include_adult and m.get("isAdult"):
            dropped["adult"] += 1
            continue
        if not args.include_non_jp and (m.get("countryOfOrigin") or "") != "JP":
            dropped["non_jp"] += 1
            continue
        rank = yuri_rank(m.get("tags"))
        if rank is None or rank < args.min_yuri_rank:
            dropped["low_rank"] += 1
            continue
        native = (m.get("title") or {}).get("native") or ""
        if not native:
            dropped["no_title"] += 1
            continue
        kept.append(m)

    # ------------------------------------------------------------ normalise
    entries: list[dict] = []
    for m in kept:
        native = (m["title"] or {}).get("native") or ""
        romaji = (m["title"] or {}).get("romaji") or ""
        english = (m["title"] or {}).get("english")
        cast = []
        for edge in (m.get("characters") or {}).get("edges") or []:
            nm = ((edge.get("node") or {}).get("name") or {})
            vas = edge.get("voiceActors") or []
            cast.append({
                "character": nm.get("native") or nm.get("full"),
                "voice_actor": (vas[0]["name"].get("native") or vas[0]["name"].get("full"))
                if vas else None,
            })
        studios = [n["name"] for n in (m.get("studios") or {}).get("nodes") or []]
        aid = m["id"]
        entries.append({
            "id": "a" + sha1(f"anilist:{aid}".encode()).hexdigest()[:24],
            "slug": slugify(romaji or native, aid),
            "anilist_id": aid,
            "mal_id": m.get("idMal"),
            "title_ja": native,
            "title_romaji": romaji or None,
            "title_en": english,
            "title_zh_tw": None,
            "title_zh_cn": None,
            "format": FORMAT_MAP.get(m.get("format") or "", "other"),
            "adaptation_source": SOURCE_MAP.get(m.get("source") or "", "unknown"),
            "status": STATUS_MAP.get(m.get("status") or "", "unknown"),
            "start_date": iso(m.get("startDate")),
            "end_date": iso(m.get("endDate")),
            "season": (m.get("season") or "").lower() or None,
            "season_year": m.get("seasonYear"),
            "episode_count": m.get("episodes"),
            "episode_duration_min": m.get("duration"),
            "studios": studios,
            "main_cast": [c for c in cast if c.get("character")],
            "average_score": m.get("averageScore"),
            "popularity": m.get("popularity"),
            "yuri_tag_rank": yuri_rank(m.get("tags")),
            "is_adult": bool(m.get("isAdult")),
            "country_of_origin": m.get("countryOfOrigin"),
            "cover_url": ((m.get("coverImage") or {}).get("large")
                          or (m.get("coverImage") or {}).get("extraLarge")),
            "cover_source_url": m.get("siteUrl"),
            "source_url": m.get("siteUrl") or f"https://anilist.co/anime/{aid}",
            "related_work_id": None,
            "related_work_slug": None,
        })

    # dedupe by anilist id, then by slug
    by_id = {e["anilist_id"]: e for e in entries}
    seen_slug: dict[str, int] = {}
    for e in by_id.values():
        if e["slug"] in seen_slug:
            seen_slug[e["slug"]] += 1
            e["slug"] = f"{e['slug']}-{seen_slug[e['slug']]}"
        else:
            seen_slug[e["slug"]] = 1
    entries = sorted(by_id.values(), key=lambda e: (-(e.get("yuri_tag_rank") or 0),
                                                    e["title_ja"]))

    # ------------------------------------------------- match against our works
    status_matches: list[dict] = []
    works_path = DATA / "works.json"
    if works_path.exists():
        works = json.loads(works_path.read_text(encoding="utf-8"))["works"]
        by_title: dict[str, dict] = {}
        for w in works:
            by_title.setdefault(norm_title(w["title_ja"]), w)
        for e in entries:
            hit = by_title.get(norm_title(e["title_ja"]))
            if not hit:
                continue
            e["related_work_id"] = hit["id"]
            e["related_work_slug"] = hit["slug"]
            status_matches.append({
                "work_id": hit["id"],
                "work_slug": hit["slug"],
                "anilist_id": e["anilist_id"],
                "title_native": e["title_ja"],
                "status": e["status"],
                "our_status": {"airing": "airing", "finished": "finished",
                               "announced": "announced"}.get(e["status"], "none"),
                "format": e["format"],
                "episodes": e["episode_count"],
                "broadcast_start": e["start_date"],
                "broadcast_end": e["end_date"],
                "studio": (e["studios"] or [None])[0],
                "source_url": e["source_url"],
                "adaptation_source": e["adaptation_source"],
            })

    summary_stats = {}
    for key in ("format", "adaptation_source", "status"):
        dist: dict[str, int] = {}
        for e in entries:
            dist[e[key]] = dist.get(e[key], 0) + 1
        summary_stats[key] = dict(sorted(dist.items(), key=lambda kv: -kv[1]))

    (DATA / "anime_catalog.json").write_text(
        json.dumps({
            "generated_at": now_iso(),
            "source": "an_anilist",
            "endpoint": ENDPOINT,
            "license_note": "AniList ToS: 非商用；禁止当数据存储/备份；禁止 hoarding。"
                            "仅保留作品介绍所需字段。",
            "query_note": "media(type: ANIME, tag: \"Yuri\")，按 POPULARITY_DESC；"
                          f"Yuri 标签相关度 >= {args.min_yuri_rank}；"
                          f"{'含' if args.include_adult else '排除'} R18；"
                          f"{'含' if args.include_non_jp else '仅'} 日本制作。",
            "fetches": fetches,
            "raw_fetched": len(raw),
            "dropped": dropped,
            "total": len(entries),
            "distribution": summary_stats,
            "entries": entries,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (DATA / "anime_status.json").write_text(
        json.dumps({
            "generated_at": now_iso(),
            "source": "an_anilist",
            "matched_works": len(status_matches),
            "matches": status_matches,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\nraw={len(raw)} dropped={dropped} kept={len(entries)}")
    print("format:", summary_stats.get("format"))
    print("source:", summary_stats.get("adaptation_source"))
    print("status:", summary_stats.get("status"))
    print(f"matched to our works: {len(status_matches)}")
    print(f"wrote {DATA / 'anime_catalog.json'}")
    return 0 if entries else 1


if __name__ == "__main__":
    raise SystemExit(main())
