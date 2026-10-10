#!/usr/bin/env python3
"""Parse a workflow job-output spill file into structured JSON and print an index.

Usage: python parse_workflow_output.py <spill.txt> [out.json]
"""
import io
import json
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def main() -> int:
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else None
    raw = open(src, "rb").read().decode("utf-8", errors="replace")

    idx = raw.find("\n[")
    if idx == -1:
        idx = raw.find("[")
    if idx == -1:
        print("no JSON array found")
        return 1
    body = raw[idx:].strip()

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        print(f"JSON parse failed: {exc}")
        print(f"tail: {body[-200:]!r}")
        return 2

    print(f"parsed OK: {len(data)} groups")
    total = 0
    for g in data:
        res = g.get("result") or {}
        srcs = res.get("sources") or []
        total += len(srcs)
        print(f"\n=== {g['group']}  ({g['label']})  ok={g.get('ok')}  sources={len(srcs)}")
        for s in srcs:
            print(f"   - [{s.get('category','?')}] {s.get('name','?')}")
            print(f"     {s.get('url','?')}  conf={s.get('confidence','?')} status={s.get('status_2026','?')}")
        dep = res.get("dead_or_deprecated") or []
        if dep:
            print(f"   deprecated({len(dep)}): " + " | ".join(d[:90] for d in dep[:6]))
    print(f"\nTOTAL sources: {total}")

    if dst:
        with open(dst, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        print(f"wrote {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
