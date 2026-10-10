#!/usr/bin/env python3
"""Validate the GitHub Actions workflow files.

    python scripts/validate_workflows.py

Checks that each workflow parses, declares a trigger, and that everything it
refers to actually exists — a missing script is the most common way a cron job
silently dies.

Motivation for the checks beyond "does the YAML parse": a real CI failure in this
repository was caused by `actions/setup-node` declaring
`cache-dependency-path: web/pnpm-lock.yaml` while the project uses npm, and by a
step running `node scripts/check-data-contract.mjs` when the file on disk is
named `assert-data-contract.mjs`. The original validator only matched
`python scripts/*.py`, so it reported "every referenced script exists" while both
of those were broken. Each check below exists because something got past the
previous version.
"""
from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

import yaml

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / ".github" / "workflows"

PY_RE = re.compile(r"python3?\s+([\w./-]+\.py)")
NODE_RE = re.compile(r"\bnode\s+([\w./-]+\.m?js)")
CACHE_RE = re.compile(r"cache-dependency-path:\s*[\"']?([^\s\"']+)")
WORKDIR_RE = re.compile(r"working-directory:\s*[\"']?([^\s\"']+)")
RUNPKG_RE = re.compile(r"\b(?:npm|pnpm|yarn)\s+run\s+([\w:.-]+)")


def resolve(path: str, workdir: str | None) -> Path:
    """Resolve a workflow-relative path the way the runner would."""
    p = Path(path)
    if p.is_absolute():
        return p
    if workdir:
        return (ROOT / workdir / p).resolve()
    return (ROOT / p).resolve()


def main() -> int:
    files = sorted(WF.glob("*.yml")) + sorted(WF.glob("*.yaml"))
    if not files:
        print("no workflow files found")
        return 1

    problems: list[str] = []
    for f in files:
        text = f.read_text(encoding="utf-8")
        try:
            doc = yaml.safe_load(text)
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

        missing: list[str] = []

        # 1) referenced python / node scripts must exist
        for m in PY_RE.finditer(text):
            if not resolve(m.group(1), None).exists():
                missing.append(m.group(1))
        for m in NODE_RE.finditer(text):
            # node paths usually sit next to a working-directory; try both
            workdirs = [w.group(1) for w in WORKDIR_RE.finditer(text)] or [None]
            if not any(resolve(m.group(1), w).exists() for w in workdirs):
                missing.append(m.group(1))

        # 2) cache-dependency-path must point at a real file — this is exactly
        #    what made actions/setup-node fail with `cache: pnpm`.
        for m in CACHE_RE.finditer(text):
            target = m.group(1)
            if not (ROOT / target).exists():
                missing.append(f"{target}  (cache-dependency-path)")

        # 3) working-directory must exist
        for m in WORKDIR_RE.finditer(text):
            if not (ROOT / m.group(1)).exists():
                missing.append(f"{m.group(1)}  (working-directory)")

        # 4) `npm run X` must be declared in that directory's package.json
        workdirs = [w.group(1) for w in WORKDIR_RE.finditer(text)] or ["."]
        for m in RUNPKG_RE.finditer(text):
            name = m.group(1)
            found = False
            for w in workdirs:
                pkg = ROOT / w / "package.json"
                if not pkg.exists():
                    continue
                try:
                    scripts = json.loads(pkg.read_text(encoding="utf-8")).get("scripts", {})
                except (json.JSONDecodeError, OSError):
                    continue
                if name in scripts:
                    found = True
                    break
            if not found:
                missing.append(f"npm script '{name}' not in any referenced package.json")

        if missing:
            problems.append(f"{f.name}: {sorted(set(missing))}")

        status = "FAIL" if missing else "OK  "
        print(f"{status} {f.name:32} triggers={kinds} jobs={jobs}")
        for c in crons:
            print(f"       cron: {c}")
        if missing:
            for item in sorted(set(missing)):
                print(f"       MISSING: {item}")

    print()
    if problems:
        print("PROBLEMS:")
        for p in problems:
            print(f"  ! {p}")
        return 1
    print(f"all {len(files)} workflow files valid; every referenced path exists")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
