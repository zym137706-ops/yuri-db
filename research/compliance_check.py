#!/usr/bin/env python3
"""Compliance self-check for the Phase 1 deliverables.

- validates sources.yaml parses
- collects every referenced domain
- flags any domain matching a denied pattern (piracy / scanlation aggregators)
- prints coverage statistics for the final report
"""
import io
import re
import sys
from collections import Counter

import yaml

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

YAML_PATH = r"C:\DSH\yuri-db\sources.yaml"

# Patterns that must never appear in this project's source list.
DENY_PATTERNS = [
    r"rawdevart", r"mangago", r"bato\.to", r"mangadex", r"mangahere", r"mangafox",
    r"kissmanga", r"readmanga", r"mangakakalot", r"manganelo", r"comico\.jp/pirate",
    r"dm5", r"manhuagui", r"copymanga", r"baozimh", r"manhuaren", r"mangabz",
    r"hanhuazu", r"shoujo-ai", r"dynasty-scans", r"yuri-ism", r"scans",
]


def collect(obj, out):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("url", "api_endpoint", "api_docs_url", "api_docs") and isinstance(v, str):
                out.append(v)
            elif k == "evidence_urls" and isinstance(v, list):
                out.extend(x for x in v if isinstance(x, str))
            else:
                collect(v, out)
    elif isinstance(obj, list):
        for item in obj:
            collect(item, out)


def main() -> int:
    with open(YAML_PATH, encoding="utf-8") as fh:
        data = yaml.safe_load(fh)

    urls: list[str] = []
    collect(data, urls)

    domains = set()
    for u in urls:
        for host in re.findall(r"https?://([^/\s\"'),]+)", u):
            domains.add(host.lower())

    print(f"YAML parses: OK")
    print(f"top-level keys: {list(data.keys())}")
    print(f"sources={len(data['sources'])} review_sources={len(data['review_sources'])} "
          f"field_source_map={len(data['field_source_map'])}")
    print(f"referenced URLs: {len(urls)}  unique domains: {len(domains)}")

    denied = sorted(
        d for d in domains if any(re.search(p, d, re.I) for p in DENY_PATTERNS)
    )
    print(f"\ndenylist hits: {denied if denied else 'NONE  (clean)'}")

    print("\n--- domains ---")
    for d in sorted(domains):
        print("  " + d)

    print("\n--- collection-method distribution ---")
    for k, v in sorted(Counter(s["method"] for s in data["sources"]).items()):
        print(f"  {k:16} {v}")

    print("\n--- confidence distribution ---")
    for k, v in sorted(Counter(s["confidence"] for s in data["sources"]).items()):
        print(f"  {k:8} {v}")

    print("\n--- evidence provenance ---")
    for k, v in sorted(Counter(s.get("verified_by", "n/a") for s in data["sources"]).items()):
        print(f"  {k:16} {v}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
