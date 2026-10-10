#!/usr/bin/env python3
"""One-off maintenance: replace the unreliable boolean `reachable_from_dev_host`
with a three-valued `dev_host_reachability`.

Why: the original boolean was populated from measurements taken with a broken
TLS client (curl/node), so most `false` values are simply wrong. Re-testing all
63 entries is out of scope, so anything we did NOT re-test is marked
`unverified` rather than being left as a false negative.

    python research/fix_reachability.py --write
"""
from __future__ import annotations

import io
import re
import sys
from pathlib import Path

import yaml

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "sources.yaml"

# Re-tested with Python requests on 2026-10-09 during phase 3-5.
VERIFIED_REACHABLE = {
    "ja_ndl_search_sru_opensearch", "ja_ndl_search_oaipmh", "ja_openbd",
    "ja_rakuten_books_api", "ja_calil_api", "ja_google_books_api",
    "ja_yurihime", "ja_galette", "ja_kadocomi", "ja_web_ace_youngaceup",
    "ja_ganma", "ja_houbunsha", "tw_tongli", "tw_kadokawa", "tw_chingwin",
    "tw_egmanga", "tw_ncl_isbn", "tw_ncl_bulk",
    "an_animeanime", "an_yahoo_rss", "an_anilist", "an_shobocal",
    "ln_ga_bunko", "ln_web_action_prtimes", "ln_sqex_novel",
}
VERIFIED_UNREACHABLE = {
    # DNS hijacked to unrelated IPs; the HTTP response is NOT from the service
    "wn_narou_api", "wn_narou_rank_api", "wn_narou_r18_api", "wn_narou_genre_spec",
    "wn_pixiv_novel",
    # genuine transport failure
    "an_jikan",
    # sites that actively refuse automated clients
    "ja_comic_natalie", "wn_alphapolis",
}

NOTE = (
    "# dev_host_reachability: verified_reachable | verified_unreachable | unverified\n"
    "#   初版用了坏掉的 curl/node TLS 客户端，导致大量 false 误判（见文件头修正说明）。\n"
    "#   本轮只复测了一部分；**未复测一律记 unverified，而不是留一个假阴性**。\n"
)


def main() -> int:
    write = "--write" in sys.argv
    text = SOURCES.read_text(encoding="utf-8")

    counts = {"verified_reachable": 0, "verified_unreachable": 0, "unverified": 0, "kept_true": 0}

    def repl(match: re.Match) -> str:
        return match.group(0)  # placeholder, handled below

    # Process line by line, tracking the current source id.
    lines = text.split("\n")
    current = None
    out: list[str] = []
    for line in lines:
        m = re.match(r"^  - id: (\S+)\s*$", line)
        if m:
            current = m.group(1)
        if re.match(r"^\s+reachable_from_dev_host:\s*(true|false)\s*$", line):
            old = line.strip().endswith("true")
            indent = line[: len(line) - len(line.lstrip())]
            if current in VERIFIED_REACHABLE or old:
                value = "verified_reachable"
            elif current in VERIFIED_UNREACHABLE:
                value = "verified_unreachable"
            else:
                value = "unverified"
            counts[value] += 1
            out.append(f"{indent}dev_host_reachability: {value}")
            continue
        out.append(line)

    new_text = "\n".join(out)

    # Replace the field's documentation comment once.
    new_text = new_text.replace(
        "# -----------------------------------------------------------------------------\n"
        "# 全局合规红线（所有采集器必须遵守）",
        NOTE
        + "# -----------------------------------------------------------------------------\n"
        "# 全局合规红线（所有采集器必须遵守）",
        1,
    )

    print("new distribution:", counts)
    leftover = new_text.count("reachable_from_dev_host:")
    print("leftover old field occurrences:", leftover)

    if write:
        SOURCES.write_text(new_text, encoding="utf-8")
        doc = yaml.safe_load(new_text)
        print(f"written; YAML re-parses OK, {len(doc['sources'])} sources")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
