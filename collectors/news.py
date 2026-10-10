#!/usr/bin/env python3
"""RSS-based news collector (Phase 5).

Only feeds that Phase 1 verified as legally usable and machine-readable are
listed. natalie.mu is deliberately absent: its robots.txt returns HTTP 405 and
its feed sits behind an AWS WAF challenge, so it is a manual source.

YIELD WARNING (measured 2026-10-09): all five feeds are *general-purpose*.
Across 340 parsed items only a handful matched the yuri keywords — see
data/news_run_stats.json for the per-feed `parsed` vs `matched` counts.
This collector therefore provides feed-health monitoring and an RSS framework,
NOT usable yuri coverage on its own. Real anime-status coverage needs the
targeted API collectors described in sources.yaml:
  - an_shobocal  しょぼいカレンダー db.php   (放送日時・話数)
  - an_anilist   AniList GraphQL tag:"Yuri"  (作品/状態)
Those are implemented in collectors/anime.py (Phase 5 follow-up).

    python collectors/news.py
    python collectors/news.py --since-days 7
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from base import ROOT, Fetcher, RunStats, now_iso  # noqa: E402

DATA = ROOT / "data"

# (source_id, label, url, kind)
FEEDS = [
    ("an_animeanime", "アニメ！アニメ！", "https://animeanime.jp/rss20/index.rdf", "anime_news"),
    ("an_yahoo_rss", "Yahoo!ニュース エンタメ", "https://news.yahoo.co.jp/rss/topics/entertainment.xml", "general_news"),
    ("ln_ga_bunko", "GA文庫 新刊", "https://ga.sbcr.jp/sitemap.rss", "new_release"),
    ("ln_web_action_prtimes", "双葉社 webアクション", "https://comic-action.com/rss", "new_serialization"),
    ("ln_web_action_prtimes", "PR TIMES", "https://prtimes.jp/index.rdf", "press_release"),
]

# 百合関連の判定に使う語。部分一致で使う語と、単語境界で使う語を分ける。
# （"GL" を部分一致にすると English / single などに誤ヒットする）
SUBSTRING_KEYWORDS = ("百合", "ガールズラブ", "百合姫", "ガレット", "百合作家")
TOKEN_KEYWORDS = ("yuri", "gl")
ANIME_MARKERS = ("アニメ化", "TVアニメ", "アニメーション化", "劇場アニメ")

_TOKEN_RE = re.compile(r"(?<![a-zA-Z])(" + "|".join(TOKEN_KEYWORDS) + r")(?![a-zA-Z])", re.I)


def is_yuri_related(blob: str) -> bool:
    if any(k in blob for k in SUBSTRING_KEYWORDS):
        return True
    return bool(_TOKEN_RE.search(blob))


NS = {
    "rss": "http://purl.org/rss/1.0/",
    "dc": "http://purl.org/dc/elements/1.1/",
    "atom": "http://www.w3.org/2005/Atom",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
}


def _text(el) -> str:
    return (el.text or "").strip() if el is not None else ""


def _first(item, names: tuple[str, ...]) -> str:
    """Namespace-robust child lookup: RSS 2.0 uses bare tags, RSS 1.0/RDF and
    Atom put everything in a namespace, so try bare then each prefix."""
    for name in names:
        el = item.find(name)
        if el is not None and _text(el):
            return _text(el)
    for prefix, uri in NS.items():
        for name in names:
            el = item.find(f"{{{uri}}}{name}")
            if el is not None and _text(el):
                return _text(el)
    return ""


def parse_feed(xml_text: str) -> list[dict]:
    """Handle RSS 2.0, RSS 1.0/RDF and Atom without external deps."""
    out: list[dict] = []
    try:
        root = ET.fromstring(xml_text.encode("utf-8", "replace"))
    except ET.ParseError:
        return out

    items = root.findall(".//item") or root.findall(f".//{{{NS['rss']}}}item")
    if not items:
        items = root.findall(".//atom:entry", NS) or root.findall(f".//{{{NS['atom']}}}entry")

    for it in items:
        title = _first(it, ("title",))
        link = _first(it, ("link",))
        if not link:
            le = it.find("atom:link", NS) or it.find(f"{{{NS['atom']}}}link")
            if le is not None:
                link = le.get("href", "")
            else:
                # RSS 1.0 stores the URL in rdf:resource
                for el in it.findall(f"{{{NS['rss']}}}link"):
                    link = el.get(f"{{{NS['rdf']}}}resource", "") or link
        date = _first(it, ("pubDate", "date", "updated", "published"))
        desc = _first(it, ("description", "summary", "encoded"))
        if not title:
            continue
        out.append({"title": title, "link": link, "date_raw": date, "summary": desc[:400]})
    return out


def parse_date(raw: str) -> str | None:
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        pass
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})", raw)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}T{m.group(4)}:{m.group(5)}:{m.group(6)}+00:00"
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since-days", type=int, default=14)
    ap.add_argument("--delay", type=float, default=2.0)
    args = ap.parse_args()

    cutoff = datetime.now(timezone.utc) - timedelta(days=args.since_days)
    f = Fetcher(delay=args.delay)

    all_items: list[dict] = []
    stats_out: list[dict] = []
    anime_hits: list[dict] = []

    for source_id, label, url, kind in FEEDS:
        res = f.get(url, source_id)
        st = RunStats(source_id=source_id)
        st.record(res)
        kept = 0
        parsed = 0
        if res.ok:
            feed_items = parse_feed(res.text)
            parsed = len(feed_items)
            for item in feed_items:
                blob = item["title"] + " " + item.get("summary", "")
                if not is_yuri_related(blob):
                    continue
                iso = parse_date(item["date_raw"])
                rec = {
                    "source_id": source_id,
                    "source_label": label,
                    "feed_kind": kind,
                    "title": item["title"],
                    "url": item["link"],
                    "published_at": iso,
                    "is_anime_announcement": any(m in blob for m in ANIME_MARKERS),
                    "retrieved_at": now_iso(),
                    "feed_url": url,
                }
                if iso:
                    try:
                        if datetime.fromisoformat(iso) < cutoff:
                            continue
                    except ValueError:
                        pass
                all_items.append(rec)
                kept += 1
                if rec["is_anime_announcement"]:
                    anime_hits.append(rec)

        stats_out.append(
            {
                "source_id": source_id,
                "status": st.status,
                "feed": url,
                "robots": f.robots_note(url),
                "matched": kept,
                "parsed": parsed,
                "http": res.status,
                "error": res.error,
            }
        )
        print(f"[news] {label:24} {st.status:16} parsed={parsed:3} matched={kept}")

    DATA.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": now_iso(),
        "since_days": args.since_days,
        "keywords": list(SUBSTRING_KEYWORDS) + list(TOKEN_KEYWORDS),
        "count": len(all_items),
        "anime_announcement_candidates": len(anime_hits),
        "items": all_items,
    }
    (DATA / "news_items.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DATA / "news_run_stats.json").write_text(
        json.dumps(stats_out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nmatched {len(all_items)} items, {len(anime_hits)} anime-announcement candidates")
    print(f"wrote {DATA / 'news_items.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
