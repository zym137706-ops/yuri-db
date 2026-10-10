#!/usr/bin/env python3
"""Probe: can AniList give us source-type, studios and main voice actors?"""
import io
import json
import sys

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

QUERY = """
query ($page: Int) {
  Page(page: $page, perPage: 3) {
    pageInfo { hasNextPage total }
    media(type: ANIME, tag: "Yuri", sort: START_DATE_DESC) {
      id
      title { native romaji english }
      format
      status
      source
      episodes
      duration
      season
      seasonYear
      startDate { year month day }
      endDate { year month day }
      countryOfOrigin
      isAdult
      studios(isMain: true) { nodes { name } }
      coverImage { large }
      siteUrl
      characters(role: MAIN, sort: [ROLE, RELEVANCE], perPage: 6) {
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

s = requests.Session()
s.headers.update({"User-Agent": "YuriDBBot/0.1 (+https://example.org)", "Content-Type": "application/json"})
r = s.post("https://graphql.anilist.co", json={"query": QUERY, "variables": {"page": 1}}, timeout=40)
print("HTTP", r.status_code)
d = r.json()
if "errors" in d:
    print("ERRORS:", json.dumps(d["errors"], ensure_ascii=False)[:600])
block = (d.get("data") or {}).get("Page") or {}
print("total yuri anime:", (block.get("pageInfo") or {}).get("total"))
for m in (block.get("media") or []):
    print("\n---", m["title"]["native"], "|", m["title"].get("romaji"))
    print("   format:", m["format"], "| status:", m["status"], "| source:", m["source"])
    print("   start:", m["startDate"], "| season:", m.get("season"), m.get("seasonYear"),
          "| eps:", m.get("episodes"), "| dur:", m.get("duration"))
    print("   studios:", [n["name"] for n in (m.get("studios") or {}).get("nodes", [])])
    print("   origin:", m.get("countryOfOrigin"), "| adult:", m.get("isAdult"))
    ch = (m.get("characters") or {}).get("edges") or []
    print("   main characters:", len(ch))
    for c in ch[:4]:
        vas = c.get("voiceActors") or []
        nm = (c.get("node") or {}).get("name") or {}
        print("      ", nm.get("native") or nm.get("full"),
              "CV:", ", ".join((v["name"].get("native") or v["name"].get("full") or "?") for v in vas) or "—")
