#!/usr/bin/env python3
"""Generate the change log by diffing the current dataset against the snapshot.

    python scripts/make_changelog.py

The acceptance criteria require "daily automatic updates **with a change log**",
so the log is a primary product, not a side effect. Output:
    data/change_log.json     appended, newest entries included
    data/.works_snapshot.json  snapshot for the next run
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# Fields worth logging. Volumes are compared separately.
SCALAR_FIELDS = [
    "title_zh_tw",
    "title_zh_cn",
    "title_en",
    "media_type",
    "serialization_status",
    "start_date",
    "end_date",
    "latest_chapter_label",
    "chapter_count",
    "volume_count_ja",
    "volume_count_zh_tw",
    "volume_count_zh_cn",
    "yuri_type",
    "classification_basis",
    "anime_status",
    "publisher_ja",
    "magazine_or_platform",
    "magazine_or_platform_active",
]

MAX_LOG = 5000  # keep the file bounded


def load_previous() -> dict[str, dict]:
    """Prefer the git revision, so the log survives a fresh checkout."""
    for attempt in ("git", "snapshot"):
        if attempt == "git":
            try:
                blob = subprocess.run(
                    ["git", "show", "HEAD:data/works.json"],
                    cwd=ROOT, capture_output=True, text=True, timeout=30,
                )
                if blob.returncode == 0 and blob.stdout.strip():
                    data = json.loads(blob.stdout)
                    print("previous state: git HEAD")
                    return {w["id"]: w for w in data.get("works", [])}
            except Exception:
                pass
        else:
            p = DATA / ".works_snapshot.json"
            if p.exists():
                data = json.loads(p.read_text(encoding="utf-8"))
                print("previous state: snapshot file")
                return {w["id"]: w for w in data.get("works", [])}
    print("previous state: none (treating all works as new)")
    return {}


def vol_index(w: dict) -> set[tuple]:
    keys = set()
    for region, field in (("ja", "ja_volumes"), ("zh_tw", "zh_tw_volumes"), ("zh_cn", "zh_cn_volumes")):
        for v in w.get(field) or []:
            keys.add((region, v.get("volume"), v.get("isbn")))
    return keys


def main() -> int:
    current_doc = json.loads((DATA / "works.json").read_text(encoding="utf-8"))
    current = {w["id"]: w for w in current_doc["works"]}
    previous = load_previous()

    now = datetime.now(timezone.utc).isoformat()
    entries: list[dict] = []

    for wid, w in current.items():
        old = previous.get(wid)
        if old is None:
            entries.append({
                "entity_type": "work", "entity_id": wid, "work_id": wid,
                "change_type": "created", "field_name": None,
                "old_value": None, "new_value": w["title_ja"],
                "source_id": (w.get("sources") or [{}])[0].get("name"),
                "detected_at": now,
            })
            continue

        for field in SCALAR_FIELDS:
            a, b = old.get(field), w.get(field)
            if a != b:
                entries.append({
                    "entity_type": "work", "entity_id": wid, "work_id": wid,
                    "change_type": "updated", "field_name": field,
                    "old_value": None if a is None else str(a),
                    "new_value": None if b is None else str(b),
                    "source_id": (w.get("field_sources") or {}).get(field, {}).get("source_url"),
                    "detected_at": now,
                })

        added = vol_index(w) - vol_index(old)
        for region, num, isbn in sorted(added, key=lambda t: (t[0], t[1] or 0)):
            entries.append({
                "entity_type": "volume", "entity_id": f"{wid}:{region}:{num}",
                "work_id": wid, "change_type": "created", "field_name": f"{region}_volume",
                "old_value": None, "new_value": f"v{num} ISBN={isbn}",
                "source_id": None, "detected_at": now,
            })

    for wid, old in previous.items():
        if wid not in current:
            entries.append({
                "entity_type": "work", "entity_id": wid, "work_id": wid,
                "change_type": "deleted", "field_name": None,
                "old_value": old.get("title_ja"), "new_value": None,
                "source_id": None, "detected_at": now,
            })

    log_path = DATA / "change_log.json"
    existing: list[dict] = []
    if log_path.exists():
        try:
            existing = json.loads(log_path.read_text(encoding="utf-8")).get("entries", [])
        except Exception:
            existing = []

    merged = existing + entries
    merged = merged[-MAX_LOG:]
    log_path.write_text(
        json.dumps(
            {"generated_at": now, "total": len(merged), "latest_run_entries": len(entries),
             "entries": merged},
            ensure_ascii=False, indent=2,
        ),
        encoding="utf-8",
    )
    (DATA / ".works_snapshot.json").write_text(
        json.dumps(current_doc, ensure_ascii=False), encoding="utf-8"
    )

    by_type: dict[str, int] = {}
    for e in entries:
        by_type[e["change_type"]] = by_type.get(e["change_type"], 0) + 1
    print(f"new change entries: {len(entries)}  {by_type}")
    print(f"log total: {len(merged)}")
    print(f"wrote {log_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
