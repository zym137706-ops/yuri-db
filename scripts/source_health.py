#!/usr/bin/env python3
"""Source health report — separates network failure from robots refusal.

    python scripts/source_health.py

Phase 1 established that conflating "the site refused us" with "we could not
reach it" corrupts the compliance record (report §2.2). This script keeps those
two apart and cross-checks against the registered source list in sources.yaml.
"""
from __future__ import annotations

import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SOURCES_YAML = ROOT / "sources.yaml"


def main() -> int:
    registry: dict[str, dict] = {}
    if SOURCES_YAML.exists():
        reg = yaml.safe_load(SOURCES_YAML.read_text(encoding="utf-8"))
        for s in reg.get("sources", []):
            registry[s["id"]] = s

    rows: list[dict] = []
    for filename in ("run_stats.json", "news_run_stats.json"):
        p = DATA / filename
        if not p.exists():
            continue
        for entry in json.loads(p.read_text(encoding="utf-8")):
            sid = entry.get("source_id", "?")
            meta = registry.get(sid, {})
            rows.append(
                {
                    "source_id": sid,
                    "declared_method": meta.get("method"),
                    "declared_status_2026": meta.get("status_2026"),
                    "declared_anti_bot_risk": meta.get("anti_bot_risk"),
                    "observed_status": entry.get("status"),
                    "parsed": entry.get("parsed"),
                    "matched": entry.get("matched"),
                    "items_seen": entry.get("items_seen"),
                    "robots": entry.get("robots"),
                    "errors": [
                        f.get("error")
                        for f in entry.get("fetches", [])
                        if f.get("error")
                    ],
                }
            )

    counts: dict[str, int] = {}
    for r in rows:
        counts[r["observed_status"]] = counts.get(r["observed_status"], 0) + 1

    # A source declared do_not_collect must never show up as successfully crawled.
    violations = [
        r["source_id"]
        for r in rows
        if r.get("declared_method") == "do_not_collect" and r.get("observed_status") == "ok"
    ]

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "observed_status_counts": counts,
        "do_not_collect_violations": violations,
        "sources": rows,
    }
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "source_health.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("observed status counts:", counts)
    for r in rows:
        flag = {"ok": "OK ", "partial": "PART", "network_error": "NET ", "blocked_by_robots": "ROBOTS"}.get(
            r["observed_status"], "?"
        )
        extra = ""
        if r.get("parsed") is not None:
            extra = f" parsed={r['parsed']} matched={r.get('matched')}"
        elif r.get("items_seen") is not None:
            extra = f" items={r['items_seen']}"
        print(f"  [{flag}] {r['source_id']:16} declared={r.get('declared_method')}{extra}")
        for e in r["errors"][:1]:
            if e:
                print(f"          └ {e[:100]}")

    if violations:
        print(f"\nWARNING: do_not_collect sources reported ok: {violations}")
    print(f"\nwrote {DATA / 'source_health.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
