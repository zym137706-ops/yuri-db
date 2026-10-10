#!/usr/bin/env python3
"""Build + validate the yuri-anime dataset.

    python scripts/build_anime_dataset.py

data/anime_catalog.json  ->  data/anime.json (+ data/anime_report.json)
"""
from __future__ import annotations

import io
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collectors"))
from normalize import norm_title  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SCHEMA = ROOT / "schemas" / "anime.schema.json"

NOW = datetime.now(timezone.utc).isoformat()
ANILIST_URL = "https://graphql.anilist.co"

# AniList is a third-party, user-edited database — never "official".
THIRD_PARTY_NOTE = (
    "AniList（第三者のユーザー編集データベース）由来。"
    "AniList ToS により全量ミラーは禁止のため、作品紹介に必要な項目のみ保持。"
    "公式サイトでの確認が望ましい。"
)


def main() -> int:
    src = DATA / "anime_catalog.json"
    if not src.exists():
        print("FATAL: run collectors/anime.py first", file=sys.stderr)
        return 1
    doc = json.loads(src.read_text(encoding="utf-8"))
    entries = doc["entries"]

    # Re-resolve the Work links against the CURRENT works.json.
    # The collector bakes `related_work_slug` in at collection time; as soon as
    # the works dataset grows or a slug changes, those links go stale and become
    # dead links in the UI. Deriving them here keeps them true by construction.
    works_path = DATA / "works.json"
    relinked = 0
    if works_path.exists():
        works = json.loads(works_path.read_text(encoding="utf-8"))["works"]
        by_key: dict[str, dict] = {}
        for w in works:
            by_key.setdefault(norm_title(w["title_ja"]), w)
        for e in entries:
            hit = by_key.get(norm_title(e.get("title_ja") or ""))
            e["related_work_id"] = hit["id"] if hit else None
            e["related_work_slug"] = hit["slug"] if hit else None
            if hit:
                relinked += 1
        print(f"re-resolved Work links against {len(works)} works -> {relinked} linked")

    out = []
    for e in entries:
        e["sources"] = [
            {
                "source_id": "an_anilist",
                "name": "AniList GraphQL API（第三者のアニメDB）",
                "url": ANILIST_URL,
                "retrieved_at": NOW,
                "confidence": 0.7,
                "note": THIRD_PARTY_NOTE,
            }
        ]
        e["field_sources"] = {
            k: {"basis": "third_party", "source_url": e.get("source_url") or ANILIST_URL,
                "retrieved_at": NOW, "confidence": 0.7, "note": THIRD_PARTY_NOTE}
            for k in ("title_ja", "format", "adaptation_source", "status", "start_date",
                      "studios", "main_cast", "episode_count", "cover_url")
        }
        e["field_confidence"] = {
            "title_ja": 0.85, "studio": 0.8, "broadcast": 0.75, "cast": 0.8,
        }
        e["last_checked"] = NOW
        out.append(e)

    # slug uniqueness is a hard requirement for the [slug] route
    seen: dict[str, int] = {}
    for e in sorted(out, key=lambda x: x["slug"]):
        if e["slug"] in seen:
            seen[e["slug"]] += 1
            e["slug"] = f"{e['slug']}-{seen[e['slug']]}"
        else:
            seen[e["slug"]] = 1

    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())

    errors: list[str] = []
    for e in out:
        for err in validator.iter_errors(e):
            errors.append(f"{e['slug']}: {list(err.path)}: {err.message}")

    def dist(key: str) -> dict:
        return dict(sorted(Counter(e[key] for e in out).items(), key=lambda kv: -kv[1]))

    adapted = {k: v for k, v in dist("adaptation_source").items()}
    report = {
        "generated_at": NOW,
        "total": len(out),
        "by_format": dist("format"),
        "by_adaptation_source": adapted,
        "by_status": dist("status"),
        "by_year": dict(sorted(
            Counter(
                str(e["season_year"]) if e.get("season_year")
                else (e.get("start_date") or "")[:4] or "unknown"
                for e in out
            ).items(), reverse=True)),
        "with_studio": sum(1 for e in out if e["studios"]),
        "with_cast": sum(1 for e in out if e["main_cast"]),
        "with_start_date": sum(1 for e in out if e["start_date"]),
        "with_cover": sum(1 for e in out if e["cover_url"]),
        "announced_not_aired": sum(1 for e in out if e["status"] == "announced"),
        "movies": sum(1 for e in out if e["format"] == "movie"),
        "linked_works": sum(1 for e in out if e["related_work_id"]),
        "schema_errors": errors,
        "collection_note": doc.get("query_note"),
        "raw_fetched": doc.get("raw_fetched"),
        "dropped": doc.get("dropped"),
    }
    (DATA / "anime.json").write_text(
        json.dumps({"generated_at": NOW, "count": len(out), "anime": out},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (DATA / "anime_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"anime entries: {len(out)}")
    print("by format      :", report["by_format"])
    print("by source      :", report["by_adaptation_source"])
    print("by status      :", report["by_status"])
    print(f"with studio    : {report['with_studio']}")
    print(f"with main cast : {report['with_cast']}")
    print(f"with start date: {report['with_start_date']}")
    print(f"with cover     : {report['with_cover']}")
    print(f"movies         : {report['movies']}")
    print(f"announced      : {report['announced_not_aired']}")
    print(f"linked to works: {report['linked_works']}")
    print(f"schema errors  : {len(errors)}")
    for e in errors[:8]:
        print("   " + e)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
