#!/usr/bin/env python3
"""Run the Phase 3 MVP collection.

    python collectors/run.py            # collect from reachable sources
    python collectors/run.py --no-archive

Writes:
    data/raw_records.json   raw per-source records
    data/run_stats.json     per-source run status (network vs robots vs ok)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sources  # noqa: E402
from base import ROOT, Fetcher, now_iso  # noqa: E402

DATA = ROOT / "data"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-archive", action="store_true", help="do not save raw responses")
    ap.add_argument("--delay", type=float, default=2.0, help="per-host delay seconds")
    ap.add_argument("--details", type=int, default=4, help="how many Tongli detail pages to fetch")
    args = ap.parse_args()

    f = Fetcher(delay=args.delay, archive=not args.no_archive)

    all_records: list[dict] = []
    stats_out: list[dict] = []

    def run(name, fn):
        print(f"[collect] {name} ...", flush=True)
        recs, st = fn()
        all_records.extend(recs)
        stats_out.append(
            {
                "source_id": st.source_id,
                "status": st.status,
                "items_seen": st.items_seen,
                "fetches": [
                    {
                        "url": x.url,
                        "status_kind": x.status_kind,
                        "http": x.status,
                        "bytes": x.byte_size,
                        "sha256": x.sha256[:16],
                        "raw": x.raw_path,
                        "error": x.error,
                    }
                    for x in st.fetches
                ],
                "robots": [f.robots_note(x.url) for x in st.fetches][:1],
            }
        )
        print(f"          -> {st.status}, {st.items_seen} items, {len(st.fetches)} fetch(es)")
        return recs

    yuri = run("コミック百合姫", lambda: sources.collect_yurihime(f))
    gal = run("ガレット", lambda: sources.collect_galette(f))
    tong = run("東立 ThemeGL", lambda: sources.collect_tongli_list(f))

    # A few detail pages, to obtain 原文書名 (the cross-language anchor)
    details = []
    for rec in tong[: args.details]:
        if not rec.get("bd"):
            continue
        print(f"[collect] 東立 detail {rec['bd']} ...", flush=True)
        d, st = sources.collect_tongli_detail(f, rec["bd"])
        stats_out.append(
            {
                "source_id": st.source_id,
                "status": st.status,
                "items_seen": st.items_seen,
                "fetches": [
                    {"url": x.url, "status_kind": x.status_kind, "http": x.status}
                    for x in st.fetches
                ],
            }
        )
        if d:
            details.append(d)

    # openBD enrichment for any ISBN we now know
    known_isbns = sorted({d["isbn"] for d in details if d.get("isbn") and len(d["isbn"]) == 13})
    if known_isbns:
        ob, st = sources.collect_openbd(f, known_isbns)
        all_records.extend(ob)
        stats_out.append(
            {
                "source_id": st.source_id,
                "status": st.status,
                "items_seen": st.items_seen,
                "fetches": [{"url": x.url, "status_kind": x.status_kind} for x in st.fetches],
            }
        )
        print(f"[collect] openBD -> {st.items_seen} entries for {len(known_isbns)} ISBN(s)")

    payload = {
        "generated_at": now_iso(),
        "runner": "local_dev",
        "counts": {
            "yurihime": len(yuri),
            "galette": len(gal),
            "tongli_list": len(tong),
            "tongli_details": len(details),
            "total_records": len(all_records),
        },
        "records": all_records + details,
    }
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "raw_records.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DATA / "run_stats.json").write_text(
        json.dumps(stats_out, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("\n=== summary ===")
    for s in stats_out:
        print(f"  {s['source_id']:14} {s['status']:18} items={s['items_seen']}")
    print(f"\nwrote {DATA / 'raw_records.json'}")
    print(f"wrote {DATA / 'run_stats.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
