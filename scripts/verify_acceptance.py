#!/usr/bin/env python3
"""Verify the dataset against the project's acceptance criteria.

    python scripts/verify_acceptance.py

Two classes of check (this distinction matters):

  HARD GATE  — a violation means the data is wrong or non-compliant. Exit 1.
               schema errors, missing provenance, missing last_checked,
               unofficial_zh containing a link, denylist hit.

  TARGET     — a goal that the dataset is still growing toward. Exit 0 with a
               warning. The 100-work target belongs here during the MVP phases;
               it becomes a hard gate once the collector coverage is complete.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SCHEMA = ROOT / "schemas" / "work.schema.json"

TARGET_WORKS = 100
MIN_CORE_COMPLETENESS = 0.80

LINK_RE = re.compile(r"(?:[hH][tT][tT][pP][sS]?://)|(?:[wW]{3}\.)|(?:[a-zA-Z0-9-]+\.[a-zA-Z]{2,})")


def main() -> int:
    works_path = DATA / "works.json"
    report_path = DATA / "dataset_report.json"
    if not works_path.exists() or not report_path.exists():
        print("FATAL: run scripts/build_dataset.py first", file=sys.stderr)
        return 1

    doc = json.loads(works_path.read_text(encoding="utf-8"))
    works = doc["works"]
    report = json.loads(report_path.read_text(encoding="utf-8"))

    hard: list[str] = []
    warn: list[str] = []

    # ---------------- HARD GATES ----------------
    if report.get("schema_errors"):
        hard.append(f"schema errors: {len(report['schema_errors'])}")

    for w in works:
        tag = w.get("slug", w.get("id"))
        if not w.get("sources"):
            hard.append(f"{tag}: sources[] is empty (provenance required)")
        if not w.get("last_checked"):
            hard.append(f"{tag}: last_checked missing")

        uz = w.get("unofficial_zh") or {}
        note = uz.get("note")
        if note and LINK_RE.search(note):
            hard.append(f"{tag}: unofficial_zh.note contains a link (D1 violation)")
        if uz.get("status") == "unknown" and (uz.get("latest_chapter") or uz.get("last_seen")):
            hard.append(f"{tag}: unofficial_zh status=unknown but chapter/date present (D1)")

        for fname, meta in (w.get("field_sources") or {}).items():
            if meta.get("basis") != "editorial" and not meta.get("source_url"):
                hard.append(f"{tag}: field_sources[{fname}] basis={meta.get('basis')} without source_url (D2)")

        cb = w.get("classification_basis")
        if cb == "official_tag" and not (w.get("field_sources") or {}):
            hard.append(f"{tag}: classification_basis=official_tag without field_sources (D2)")

        for r in w.get("ratings") or []:
            if not r.get("source_url"):
                hard.append(f"{tag}: rating without source_url")
            if r.get("score_scale") not in (5, 10, 100):
                hard.append(f"{tag}: rating score_scale={r.get('score_scale')} not in 5/10/100")

    # ---------------- anime dataset (independent catalogue) ----------------
    anime_path = DATA / "anime.json"
    anime_report_path = DATA / "anime_report.json"
    anime_count = 0
    if anime_path.exists():
        anime_doc = json.loads(anime_path.read_text(encoding="utf-8"))
        anime = anime_doc["anime"]
        anime_count = len(anime)

        if anime_report_path.exists():
            ar = json.loads(anime_report_path.read_text(encoding="utf-8"))
            if ar.get("schema_errors"):
                hard.append(f"anime schema errors: {len(ar['schema_errors'])}")

        seen_slugs: set[str] = set()
        for a in anime:
            tag = a.get("slug", a.get("id"))
            if tag in seen_slugs:
                hard.append(f"anime {tag}: duplicate slug (breaks the [slug] route)")
            seen_slugs.add(tag)
            if not a.get("sources"):
                hard.append(f"anime {tag}: sources[] is empty (provenance required)")
            if not a.get("last_checked"):
                hard.append(f"anime {tag}: last_checked missing")
            if not a.get("source_url"):
                hard.append(f"anime {tag}: source_url missing")
            if a.get("is_adult"):
                hard.append(f"anime {tag}: is_adult entry present (site policy excludes R18)")
            rank = a.get("yuri_tag_rank")
            if rank is not None and not (0 <= rank <= 100):
                hard.append(f"anime {tag}: yuri_tag_rank out of range")
        # the four categories the requirement names must actually be non-empty
        for key, want in (("adaptation_source", "manga"),
                          ("adaptation_source", "light_novel"),
                          ("adaptation_source", "original"),
                          ("format", "movie")):
            if not any(a.get(key) == want for a in anime):
                hard.append(f"anime: no entry with {key}={want} (required category empty)")

    # ---------------- TARGETS ----------------
    # 完整率按「来源层级」判定：curated = 有出版社/书目一手来源，
    # catalogue = 仅第三方目录（出版社待 NDL 补全，会随时间升级）。
    # 把两者混在一个分母里会掩盖真实差距，所以硬门禁只压 curated 层。
    tiers = report.get("core_field_completeness_by_tier", {})
    curated = tiers.get("curated", {})
    catalogue = tiers.get("catalogue", {})

    for field, value in (curated or {}).items():
        if field == "count":
            continue
        if value < MIN_CORE_COMPLETENESS:
            hard.append(
                f"curated core field '{field}' completeness {value:.1%} "
                f"< {MIN_CORE_COMPLETENESS:.0%}"
            )

    for field, value in (catalogue or {}).items():
        if field == "count" or value >= MIN_CORE_COMPLETENESS:
            continue
        warn.append(
            f"catalogue core field '{field}' completeness {value:.1%} "
            "< 80% (待 NDL 补全任务逐步提升)"
        )

    # 作品数现在是**硬门禁**，不再是 warning。
    # 曾经它只是 warning，于是 2026-10-12 数据集从 835 部塌到 35 部时，
    # 整条流水线依然是绿的、坏数据照常提交并上线。
    # 现在缩到目标以下会让 collect-daily 在提交前就失败。
    if len(works) < TARGET_WORKS:
        hard.append(
            f"works {len(works)} < target {TARGET_WORKS} — "
            "数据集疑似塌缩（多半是某个采集器用空结果覆盖了好数据）"
        )

    # ---------------- report ----------------
    print("=" * 68)
    print(f"works                 : {len(works)}  (target {TARGET_WORKS})")
    print(f"yuri anime entries    : {anime_count}")
    for tier in ("curated", "catalogue"):
        row = (tiers or {}).get(tier)
        if row:
            vals = [v for k, v in row.items() if k != "count"]
            print(f"  tier {tier:10} n={row['count']:<5} min core completeness "
                  f"{min(vals):.1%}" if vals else "")
    print(f"schema errors (works) : {len(report.get('schema_errors', []))}")
    print(f"cross-language linked : {report.get('cross_language_linked', 0)}")
    print(f"works w/ cover        : {report.get('works_with_cover', 0)}")
    print(f"works w/ zh_tw title  : {report.get('works_with_title_zh_tw', 0)}")
    print("=" * 68)

    if warn:
        print("\nWARNINGS (targets, non-blocking):")
        for w in warn:
            print("  ! " + w)

    if hard:
        print("\nHARD GATE FAILURES:")
        for h in hard:
            print("  X " + h)
        return 1

    print("\nall hard gates passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
