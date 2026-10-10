#!/usr/bin/env python3
"""Validate the Phase 2 JSON Schema, including the three confirmed decisions.

Usage: python scripts/validate_schema.py

Runs one positive fixture and a set of negative cases that must each FAIL.
This is the executable form of docs/phase2-dedup-strategy.md §8 and the
D1/D2 decisions from Phase 1.
"""
import io
import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "schemas" / "work.schema.json"


def base_work() -> dict:
    """A minimal valid record. Values are deliberately sparse and marked
    'unknown'/null wherever they were not verified in Phase 1 — the schema is
    supposed to make 'I don't know' expressible."""
    return {
        "id": "clx0000000000000000000001",
        "slug": "yagate-kimi-ni-naru",
        "title_ja": "やがて君になる",
        "title_zh_tw": "終將成為妳",
        "title_zh_cn": None,
        "title_en": "Bloom Into You",
        "media_type": "manga",
        "serialization_status": "completed",
        "publisher_ja": "KADOKAWA",
        "publisher_zh_tw": "台灣角川",
        "publisher_zh_cn": None,
        "magazine_or_platform": "コミック百合姫",
        "magazine_or_platform_kind": "magazine",
        "magazine_or_platform_active": True,
        "authors": ["仲谷鳰"],
        "illustrators": [],
        "start_date": None,
        "end_date": None,
        "latest_chapter_label": None,
        "chapter_count": None,
        "volume_count_ja": 8,
        "volume_count_zh_tw": 8,
        "volume_count_zh_cn": None,
        "genres": ["百合"],
        "genres_official": True,
        "yuri_type": "orthodox_yuri",
        "classification_basis": "editorial",
        "anime_status": "finished",
        "anime_details": {
            "studio": None,
            "broadcast_date": None,
            "broadcast_end": None,
            "episode_count": None,
            "format": "tv",
            "official_url": None,
            "source_url": None,
        },
        "ja_volumes": [
            {
                "volume": 1,
                "isbn": None,
                "release_date": None,
                "publisher": "KADOKAWA",
                "price": None,
                "cover_url": None,
                "source_url": "https://www.ichijinsha.co.jp/yurihime/",
            }
        ],
        "zh_tw_volumes": [
            {
                "volume": 1,
                "isbn": None,
                "release_date": None,
                "publisher": "台灣角川",
                "translator": None,
                "source_url": "https://www.kadokawa.com.tw/sitemap.xml?locale=zh-hant",
            }
        ],
        "zh_cn_volumes": [],
        "official_zh_cn": {
            "exists": False,
            "kind": "unknown",
            "publisher": None,
            "latest_volume": None,
            "isbn": None,
            "source_url": None,
        },
        "unofficial_zh": {
            "status": "unknown",
            "latest_chapter": None,
            "last_seen": None,
            "note": None,
            "recorded_by": None,
            "recorded_at": None,
        },
        "ratings": [
            {
                "source_id": "rv_tw_bahamut",
                "region": "zh_tw",
                "score_value": 5.0,
                "score_scale": 5,
                "score_count": 60,
                "display_allowed": True,
                "license_note": "robots Allow: /",
                "source_url": "https://acg.gamer.com.tw/acgDetail.php?s=94420",
                "retrieved_at": "2026-10-09T12:00:00+08:00",
            }
        ],
        "review_meta": [
            {
                "source_id": "rv_ja_openbd_shohyo",
                "outlet": "朝日新聞",
                "reviewer": None,
                "published_date": None,
                "rank": None,
                "points": None,
                "source_url": "https://api.openbd.jp/v1/get?isbn=9784049130942",
                "retrieved_at": "2026-10-09T12:00:00+08:00",
            }
        ],
        "sources": [
            {
                "source_id": "ja_yurihime",
                "name": "コミック百合姫 公式サイト（一迅社）",
                "url": "https://www.ichijinsha.co.jp/yurihime/",
                "retrieved_at": "2026-10-09T12:00:00+08:00",
                "confidence": 0.95,
                "note": None,
            }
        ],
        "field_sources": {
            "title_ja": {
                "basis": "official",
                "source_url": "https://www.ichijinsha.co.jp/yurihime/",
                "retrieved_at": "2026-10-09T12:00:00+08:00",
                "confidence": 0.95,
            },
            "yuri_type": {
                "basis": "editorial",
                "source_url": "",
                "retrieved_at": None,
                "confidence": 0.5,
            },
        },
        "field_confidence": {
            "title_ja": 0.95,
            "yuri_type": 0.5,
            "start_date": 0.0,
        },
        "last_checked": "2026-10-09T12:00:00+08:00",
    }


def negative_cases(b: dict) -> list[tuple[str, dict, str]]:
    """(name, instance, why it must fail)"""
    import copy

    cases = []

    # N1 [D1] 非官方汉化备注不得含链接
    x = copy.deepcopy(b)
    x["unofficial_zh"] = {
        "status": "manually_flagged",
        "latest_chapter": "第10話",
        "last_seen": "2026-09-01",
        "note": "可在 example.com 阅读",
        "recorded_by": "editor",
        "recorded_at": "2026-10-09T12:00:00+08:00",
    }
    cases.append(("N1 unofficial_zh note 含 URL", x, "[D1] 必须拒绝含链接的备注"))

    x = copy.deepcopy(b)
    x["unofficial_zh"] = {
        "status": "manually_flagged",
        "latest_chapter": None,
        "last_seen": None,
        "note": "见 http://foo.bar/x",
        "recorded_by": "editor",
        "recorded_at": "2026-10-09T12:00:00+08:00",
    }
    cases.append(("N1b unofficial_zh note 含 http", x, "[D1] 必须拒绝含链接的备注"))

    # N2 [D2] official_tag 必须给 source_url
    x = copy.deepcopy(b)
    x["classification_basis"] = "official_tag"
    x.pop("field_sources")
    cases.append(("N2 official_tag 无 field_sources", x, "[D2] official_tag 必须可溯源"))

    # N3 评分口径非法
    x = copy.deepcopy(b)
    x["ratings"][0]["score_scale"] = 7
    cases.append(("N3 score_scale=7", x, "口径只能是 5/10/100"))

    # N4 评分缺 source_url
    x = copy.deepcopy(b)
    del x["ratings"][0]["source_url"]
    cases.append(("N4 rating 缺 source_url", x, "每条评分必须可溯源"))

    # N5 [D1] unknown 时不得留章节痕迹
    x = copy.deepcopy(b)
    x["unofficial_zh"]["latest_chapter"] = "第10話"
    cases.append(("N5 unknown 却有 latest_chapter", x, "[D1] 未登记不得留痕迹"))

    # N6 chapter_count 不得为负
    x = copy.deepcopy(b)
    x["chapter_count"] = -3
    cases.append(("N6 chapter_count=-3", x, "话数不得为负"))

    # N7 缺 last_checked
    x = copy.deepcopy(b)
    del x["last_checked"]
    cases.append(("N7 缺 last_checked", x, "验收标准要求每条有 last_checked"))

    # N8 未知字段
    x = copy.deepcopy(b)
    x["pirate_url"] = "https://example.invalid"
    cases.append(("N8 未知字段 pirate_url", x, "additionalProperties=false"))

    # N9 sources 为空
    x = copy.deepcopy(b)
    x["sources"] = []
    cases.append(("N9 sources 为空", x, "必须至少一条溯源"))

    # N10 ISBN 位数错误
    x = copy.deepcopy(b)
    x["ja_volumes"][0]["isbn"] = "978-4-04-913094-2"
    cases.append(("N10 ISBN 含连字符", x, "必须归一化为 13 位纯数字"))

    return cases


def main() -> int:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    print(f"schema OK (draft 2020-12): {SCHEMA_PATH.name}")

    validator = Draft202012Validator(schema, format_checker=FormatChecker())

    good = base_work()
    errors = sorted(validator.iter_errors(good), key=lambda e: list(e.path))
    if errors:
        print("\nPOSITIVE FIXTURE FAILED:")
        for e in errors:
            print(f"  - {list(e.path)}: {e.message}")
        return 1
    print("positive fixture: PASS")

    failures = 0
    print("\nnegative cases (each MUST fail):")
    for name, instance, why in negative_cases(good):
        errs = list(validator.iter_errors(instance))
        if errs:
            print(f"  PASS  {name}")
            print(f"        └ {errs[0].message[:110]}")
        else:
            failures += 1
            print(f"  FAIL  {name}  <-- schema accepted an invalid record!")
            print(f"        expected rejection because: {why}")

    print(f"\nnegative cases: {len(negative_cases(good)) - failures}/{len(negative_cases(good))} correctly rejected")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
