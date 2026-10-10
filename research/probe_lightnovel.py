#!/usr/bin/env python3
"""Probe: where can we get yuri LIGHT NOVELS and WEB NOVELS?"""
import io
import json
import sys

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

s = requests.Session()
s.headers.update({"User-Agent": "YuriDBBot/0.1 (+https://example.org)",
                  "Content-Type": "application/json"})

Q = """
query ($page: Int, $type: MediaType, $format: MediaFormat) {
  Page(page: $page, perPage: 5) {
    pageInfo { hasNextPage total }
    media(type: $type, format: $format, tag: "Yuri", sort: [POPULARITY_DESC]) {
      id
      title { native romaji english }
      format
      status
      source
      startDate { year month day }
      volumes
      chapters
      countryOfOrigin
      isAdult
      staff(perPage: 3) { edges { role node { name { native } } } }
      coverImage { large }
      siteUrl
    }
  }
}
"""

print("=== AniList: MANGA type split by format, tag=Yuri ===")
for fmt in ("NOVEL", "MANGA", "ONE_SHOT"):
    r = s.post("https://graphql.anilist.co",
               json={"query": Q, "variables": {"page": 1, "type": "MANGA", "format": fmt}},
               timeout=45)
    d = r.json()
    if d.get("errors"):
        print(f"  {fmt}: ERROR {d['errors'][0].get('message')}")
        continue
    block = (d.get("data") or {}).get("Page") or {}
    total = (block.get("pageInfo") or {}).get("total")
    print(f"\n  format={fmt}: total={total}")
    for m in (block.get("media") or [])[:3]:
        staff = ", ".join(
            (e["node"]["name"].get("native") or "?") + f"({e['role']})"
            for e in (m.get("staff") or {}).get("edges", [])[:2]
        )
        print(f"     {m['title']['native'][:40]:42} src={m.get('source')} vol={m.get('volumes')} "
              f"start={m['startDate'].get('year')} staff={staff[:60]}")

print("\n=== なろう小説API 可达性（is_gl 是百合判定的关键）===")
for url in ("https://api.syosetu.com/novelapi/api/?out=json&lim=1&isgl=1",
            "https://api.syosetu.com/novelapi/api/?out=json&lim=1"):
    try:
        r = s.get(url, timeout=25)
        print(f"  {url[:62]} -> HTTP {r.status_code} len={len(r.content)}")
        print("      body head:", r.text[:150].replace("\n", " "))
    except Exception as exc:
        print(f"  {url[:62]} -> ERR {type(exc).__name__}: {str(exc)[:70]}")

print("\n=== カクヨム タグ「百合」===")
try:
    r = s.get("https://kakuyomu.jp/tags/%E7%99%BE%E5%90%88", timeout=30)
    import re
    print("  HTTP", r.status_code, "bytes", len(r.text))
    works = re.findall(r'href="(/works/\d+)"', r.text)
    print("  work links on page 1:", len(set(works)))
    m = re.search(r"([\d,]+)\s*件", r.text)
    print("  stated count:", m.group(1) if m else "n/a")
except Exception as exc:
    print("  ERR", type(exc).__name__, str(exc)[:80])
