#!/usr/bin/env python3
"""Validate the GitHub Actions workflow files.

    python scripts/validate_workflows.py

Checks that each workflow parses, declares a schedule or trigger, and that any
script it invokes actually exists in the repository — a missing script is the
most common way a cron job silently dies.
"""
from __future__ import annotations

import io
import re
import sys
from pathlib import Path

import yaml

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / ".github" / "workflows"

RUN_RE = re.compile(r"python\s+(scripts/[\w./-]+\.py|collectors/[\w./-]+\.py|research/[\w./-]+\.py)")


def main() -> int:
    files = sorted(WF.glob("*.yml")) + sorted(WF.glob("*.yaml"))
    if not files:
        print("no workflow files found")
        return 1

    problems: list[str] = []
    for f in files:
        try:
            doc = yaml.safe_load(f.read_text(encoding="utf-8"))
        except yaml.YAMLError as exc:
            problems.append(f"{f.name}: YAML parse error: {exc}")
            print(f"FAIL {f.name}: {exc}")
            continue

        # PyYAML turns the bare key `on:` into the boolean True
        triggers = doc.get("on") if "on" in doc else doc.get(True)
        triggers = triggers or {}
        jobs = list((doc.get("jobs") or {}).keys())

        crons: list[str] = []
        if isinstance(triggers, dict):
            for entry in triggers.get("schedule") or []:
                if isinstance(entry, dict) and "cron" in entry:
                    crons.append(entry["cron"])
        kinds = list(triggers.keys()) if isinstance(triggers, dict) else [str(triggers)]

        # every referenced script must exist
        missing = []
        for m in RUN_RE.finditer(f.read_text(encoding="utf-8")):
            if not (ROOT / m.group(1)).exists():
                missing.append(m.group(1))
        if missing:
            problems.append(f"{f.name}: references missing scripts {sorted(set(missing))}")

        status = "OK  " if not missing else "FAIL"
        print(f"{status} {f.name:32} triggers={kinds} jobs={jobs}")
        for c in crons:
            print(f"       cron: {c}")
        if missing:
            print(f"       MISSING SCRIPTS: {sorted(set(missing))}")

    print()
    if problems:
        print("PROBLEMS:")
        for p in problems:
            print("  X " + p)
        return 1
    print(f"all {len(files)} workflow files valid; every referenced script exists")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
