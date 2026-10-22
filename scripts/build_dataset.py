#!/usr/bin/env python3
"""Phase 3: normalise raw collector output into schema-conformant works.

    python scripts/build_dataset.py

Pipeline:
  data/raw_records.json
    -> normalise (titleKey / nameKey, ISO dates, ISBN-13)
    -> dedupe  (docs/phase2-dedup-strategy.md §1-§3)
    -> assemble Work records per schemas/work.schema.json
    -> validate every record
    -> data/works.json + data/dataset_report.json
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from hashlib import sha1
from pathlib import Path
from urllib.parse import unquote

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SCHEMA_PATH = ROOT / "schemas" / "work.schema.json"

NOW = datetime.now(timezone.utc).isoformat()
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

# ---------------------------------------------------------------------------
# normalisation — canonical implementation lives in collectors/normalize.py
# (single source of truth; duplicate definitions have caused real bugs here)
# ---------------------------------------------------------------------------

sys.path.insert(0, str(ROOT / "collectors"))
from normalize import (  # noqa: E402
    extract_volume_number,
    isbn13,
    make_id,
    make_slug,
    norm_name,
    norm_publisher,
    norm_title,
)


# ---------------------------------------------------------------------------
# load
# ---------------------------------------------------------------------------

raw = json.loads((DATA / "raw_records.json").read_text(encoding="utf-8"))
records = raw["records"]

works: dict[str, dict] = {}
merge_log: list[dict] = []


def upsert_work(key: str, build) -> dict:
    if key in works:
        return works[key]
    w = build()
    works[key] = w
    return w


def new_work(title_ja: str, author: str | None, **kw) -> dict:
    slug = make_slug(title_ja, author)
    n = 2
    base_slug = slug
    while any(w["slug"] == slug for w in works.values()):
        slug = f"{base_slug}-{n}"
        n += 1
    w = {
        "id": make_id(norm_title(title_ja) + "|" + norm_name(author or "")),
        "slug": slug,
        "title_ja": title_ja,
        "title_zh_tw": None,
        "title_zh_cn": None,
        "title_en": None,
        "title_zh_tw_status": "unchecked",
        "title_zh_cn_status": "unchecked",
        "cover_url": None,
        "cover_source_url": None,
        "cover_region": None,
        "cover_display_allowed": None,
        "cover_note": None,
        "media_type": "manga",
        "serialization_status": "unknown",
        "publisher_ja": None,
        "publisher_zh_tw": None,
        "publisher_zh_cn": None,
        "magazine_or_platform": None,
        "magazine_or_platform_kind": None,
        "magazine_or_platform_active": None,
        "authors": [author] if author else [],
        "illustrators": [],
        "start_date": None,
        "end_date": None,
        "latest_chapter_label": None,
        "chapter_count": None,
        "volume_count_ja": None,
        "volume_count_zh_tw": None,
        "volume_count_zh_cn": None,
        "genres": [],
        "genres_official": False,
        "yuri_type": "uncertain",
        "classification_basis": "editorial",
        "anime_status": "none",
        "anime_details": None,
        "ja_volumes": [],
        "zh_tw_volumes": [],
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
        "ratings": [],
        "review_meta": [],
        "sources": [],
        "field_sources": {},
        "field_confidence": {},
        "last_checked": NOW,
        "created_at": NOW,
        "updated_at": NOW,
    }
    w.update(kw)
    return w


def add_source(w: dict, source_id: str, name: str, url: str, conf: float,
               note: str | None = None) -> None:
    for s in w["sources"]:
        if s["url"] == url:
            s["confidence"] = max(s["confidence"], conf)
            return
    w["sources"].append(
        {
            "source_id": source_id,
            "name": name,
            "url": url,
            "retrieved_at": NOW,
            "confidence": conf,
            "note": note,
        }
    )


def set_field(w: dict, field: str, value, basis: str, url: str, conf: float) -> None:
    if value in (None, "", []):
        return
    w[field] = value
    w["field_sources"][field] = {
        "basis": basis,
        "source_url": url,
        "retrieved_at": NOW,
        "confidence": conf,
        "note": None,
    }
    w["field_confidence"][field] = conf


# ---------------------------------------------------------------------------
# 1) コミック百合姫 -> manga works
# ---------------------------------------------------------------------------

YH_URL = "https://www.ichijinsha.co.jp/yurihime/"
for rec in records:
    if rec.get("source_id") != "ja_yurihime" or rec.get("kind") != "serialized_work":
        continue
    title = rec["title_ja"]
    author = (rec.get("authors") or [None])[0]
    w = upsert_work("yh:" + norm_title(title) + "|" + norm_name(author or ""),
                    lambda t=title, a=author: new_work(t, a))
    add_source(w, "ja_yurihime", "コミック百合姫 公式サイト（一迅社）", YH_URL, 0.95)
    set_field(w, "publisher_ja", "一迅社", "official", YH_URL, 0.95)
    set_field(w, "magazine_or_platform", "コミック百合姫", "official", YH_URL, 0.95)
    set_field(w, "magazine_or_platform_kind", "magazine", "official", YH_URL, 0.95)
    set_field(w, "magazine_or_platform_active", True, "official", YH_URL, 0.95)
    set_field(w, "serialization_status", "ongoing", "derived", YH_URL, 0.6)
    # 百合専門誌に掲載 = 百合であることは確定だが、下位分類は編集判断
    # serialization_status: 作品紹介ページは「現在の掲載作」一覧と解釈できるが、
    # 終了済み作品が残っている可能性を排除できないため、推定として低めの確度で記録する。
    w["field_sources"]["serialization_status"] = {
        "basis": "derived",
        "source_url": YH_URL,
        "retrieved_at": NOW,
        "confidence": 0.6,
        "note": "掲載誌の作品紹介ページに載っていることからの推定。"
                "終了済み作品が一覧に残る可能性があるため確度は0.6。"
                "正確な連載状況は各号の目次での確認が必要。",
    }
    w["field_confidence"]["serialization_status"] = 0.6
    if "百合" not in w["genres"]:
        w["genres"] = ["百合"]
        w["genres_official"] = False
        w["field_sources"]["genres"] = {
            "basis": "editorial",
            "source_url": YH_URL,
            "retrieved_at": NOW,
            "confidence": 0.9,
            "note": "掲載誌『コミック百合姫』が百合専門誌であることによる。下位分類は未判定。",
        }
        w["field_confidence"]["genres"] = 0.9
    w["field_sources"]["yuri_type"] = {
        "basis": "editorial",
        "source_url": "",
        "retrieved_at": None,
        "confidence": 0.2,
        "note": "百合であることは誌面から確実だが、orthodox/light 等の下位分類は本文を読まないと判定不能。",
    }
    w["field_confidence"]["yuri_type"] = 0.2

# ---------------------------------------------------------------------------
# 2) ガレット -> manga works with chapter labels
# ---------------------------------------------------------------------------

GAL_URL = "https://galetteweb.com/archives/3190"
for rec in records:
    if rec.get("source_id") != "ja_galette" or rec.get("kind") != "serialized_work":
        continue
    title = rec["title_ja"]
    author = (rec.get("authors") or [None])[0]
    w = upsert_work("gal:" + norm_title(title) + "|" + norm_name(author or ""),
                    lambda t=title, a=author: new_work(t, a))
    add_source(w, "ja_galette", "ガレット 公式サイト（自主制作百合コミック誌）", GAL_URL, 0.9)
    set_field(w, "publisher_ja", "GALETTE WORKS", "official", GAL_URL, 0.9)
    set_field(w, "magazine_or_platform", "ガレット", "official", GAL_URL, 0.9)
    set_field(w, "magazine_or_platform_kind", "magazine", "official", GAL_URL, 0.9)
    set_field(w, "magazine_or_platform_active", True, "official", GAL_URL, 0.9)
    set_field(w, "serialization_status", "ongoing", "official", GAL_URL, 0.7)
    set_field(w, "latest_chapter_label", rec.get("latest_chapter_label"), "official", GAL_URL, 0.85)
    if "百合" not in w["genres"]:
        w["genres"] = ["百合"]
        w["genres_official"] = False
        w["field_sources"]["genres"] = {
            "basis": "editorial",
            "source_url": GAL_URL,
            "retrieved_at": NOW,
            "confidence": 0.9,
            "note": "掲載誌『ガレット』が百合専門誌であることによる。",
        }
        w["field_confidence"]["genres"] = 0.9
    w["field_sources"]["yuri_type"] = {
        "basis": "editorial",
        "source_url": "",
        "retrieved_at": None,
        "confidence": 0.2,
        "note": "百合誌掲載であることは確実だが、orthodox/light 等の下位分類は本文未読のため判定不能。",
    }
    w["field_confidence"]["yuri_type"] = 0.2

# ---------------------------------------------------------------------------
# 2.5) AniList 作品目录 -> 漫画 / 轻小说 Works
# ---------------------------------------------------------------------------
# 此前只接了「コミック百合姫」与「ガレット」两个**漫画**源，结果全部作品都是 manga、
# 一部轻小说都没有。AniList 的 type: MANGA 同时包含漫画与轻小说，用 format 区分
# （MANGA/ONE_SHOT -> manga，NOVEL -> light_novel）。

ANILIST_ANIME_URL = "https://graphql.anilist.co"
anilist_created = 0
anilist_enriched = 0
anilist_skipped_manga = 0  # kept for report compatibility; no longer used to skip
_anilist_path = DATA / "anilist_works.json"
anilist_dropped_dupes = 0
if _anilist_path.exists():
    _aw = json.loads(_anilist_path.read_text(encoding="utf-8"))

    # 索引键必须带上 media_type。
    #
    # 曾经只按标题索引，结果把「轻小说原作」和「它的漫画改编版」合并成同一条记录，
    # 作者栏变成「入間人間、柚原もけ」（轻小说作者 + 漫画绘者混在一起）、
    # 插画栏变成「逢坂望美、仲谷鳰、柚原もけ」。用户就是从《安達としまむら》
    # 这一条发现的问题。同一标题在 AniList 里同时存在 NOVEL 与 MANGA 条目是常态
    # （本目录里有 11 个这样的标题），所以 (标题, 媒介) 才是正确的身份。
    _idx: dict[tuple, dict] = {}
    for w in works.values():
        _idx.setdefault((norm_title(w["title_ja"]), w["media_type"]), w)

    # 同一 (标题, 媒介) 还可能有**多条** AniList 条目 —— 例如《安達としまむら》
    # 有两个不同的漫画化版本（まに / 柚原もけ）。它们确实是不同作品，但我们的
    # 数据模型一条记录只有一个 authors 数组，硬合并会把两位漫画家的名字塞进同一条。
    # 因此只保留 popularity 最高的那条，其余丢弃并在报告里计数（不静默）。
    _best: dict[tuple, dict] = {}
    for e in _aw.get("entries", []):
        _k = (norm_title(e["title_ja"]), e.get("media_type") or "manga")
        _cur = _best.get(_k)
        if _cur is None or (e.get("popularity") or 0) > (_cur.get("popularity") or 0):
            _best[_k] = e
    anilist_dropped_dupes = len(_aw.get("entries", [])) - len(_best)

    for (_key, _media), e in _best.items():
        # 漫画与轻小说**都**并入。
        # 用户明确要求：漫画库不能只限于「台湾出版社已出版繁体中文版」的作品——
        # 很多百合漫画只有民间汉化、没有官方繁中版，那些同样应该收录。
        # 因此这里不做「是否有繁中版」的筛选，只按百合标签相关度收录。
        key = _key
        if not key:
            continue
        w = _idx.get((key, _media))
        created_here = False
        if w is None:
            author = (e.get("authors") or [None])[0]
            w = new_work(e["title_ja"], author)
            w["media_type"] = e.get("media_type") or "manga"
            works[f"anilist:{key}:{w['media_type']}"] = w
            _idx[(key, w["media_type"])] = w
            created_here = True
            anilist_created += 1
        else:
            anilist_enriched += 1

        add_source(w, "an_anilist", "AniList GraphQL API（第三者の作品DB）",
                   ANILIST_ANIME_URL, 0.7)
        if e.get("authors"):
            set_field(w, "authors", e["authors"], "third_party", e["source_url"], 0.7)
        if e.get("illustrators"):
            set_field(w, "illustrators", e["illustrators"], "third_party", e["source_url"], 0.7)
            # 如实说明这是**作品级汇总**，不是逐卷的。
            # 实测：NDL 的書志对轻小说只著录作者（creator = ['入間, 人間']），
            # **不著录插画师**；AniList 只给一条作品级的 Illustration 名单。
            # 所以「安達としまむら 不同卷插画师不同（逢坂望美 / Raemz）」这件事
            # 用现有数据源无法逐卷还原。这里标注出来，避免读者误以为该数组是逐卷的。
            w["field_sources"]["illustrators"]["note"] = (
                "作品級のクレジット（AniList のスタッフ情報）。**巻ごとの插画担当は"
                "現データ源から取得できない**（NDL はライトノベルのイラストレーターを"
                "著録しない）。複数名が並ぶ場合、それは同一作品に複数の役割／版がある"
                "ことを示すもので、巻ごとの対応ではない。"
            )
        for src, dst in (("start_date", "start_date"), ("end_date", "end_date")):
            if e.get(src):
                set_field(w, dst, e[src], "third_party", e["source_url"], 0.7)
        if e.get("volume_count") is not None and w.get("volume_count_ja") is None:
            set_field(w, "volume_count_ja", e["volume_count"], "third_party",
                      e["source_url"], 0.7)
        if e.get("chapter_count") is not None and w.get("chapter_count") is None:
            set_field(w, "chapter_count", e["chapter_count"], "third_party",
                      e["source_url"], 0.7)
        if e.get("status"):
            set_field(w, "serialization_status", e["status"], "derived",
                      e["source_url"], 0.6)
            w["field_sources"]["serialization_status"]["note"] = (
                "AniList の status からの写像（RELEASING→ongoing / FINISHED→completed）。"
                "第三者のユーザー編集データのため確度は 0.6。"
            )
        if e.get("cover_url") and not w.get("cover_url"):
            w["cover_url"] = e["cover_url"]
            w["cover_source_url"] = e["source_url"]
            w["cover_region"] = "ja"
            w["cover_display_allowed"] = True
            w["cover_note"] = (
                "封面連結來自 AniList。本站只存 URL、不鏡像檔案；"
                "圖片著作權屬原作者／出版社，權利人可要求下架。"
            )
            w["field_sources"]["cover_url"] = {
                "basis": "third_party", "source_url": e["source_url"],
                "retrieved_at": NOW, "confidence": 0.7, "note": w["cover_note"],
            }
            w["field_confidence"]["cover_url"] = 0.7
        if not w["genres"]:
            w["genres"] = ["百合"]
            w["genres_official"] = False
        w["field_sources"].setdefault("genres", {
            "basis": "editorial", "source_url": e["source_url"], "retrieved_at": NOW,
            "confidence": 0.8,
            "note": f"AniList の Yuri タグ（関連度 {e.get('yuri_tag_rank')}）で収録された作品。",
        })
        w["field_confidence"].setdefault("genres", 0.8)
        w["field_sources"].setdefault("yuri_type", {
            "basis": "editorial", "source_url": "", "retrieved_at": None,
            "confidence": 0.2,
            "note": "百合であることはタグで確認できるが、下位分類は本文未読のため判定不能。",
        })
        w["field_confidence"].setdefault("yuri_type", 0.2)

# ---------------------------------------------------------------------------
# 3) 東立 (繁中) -> cross-language linkage via 原文書名
# ---------------------------------------------------------------------------

TONGLI_URL = "https://www.tongli.com.tw/ThemeGL.aspx?page=1&s=1"
details = [r for r in records if r.get("kind") == "zh_tw_volume_detail"]
detail_by_bd = {d["bd"]: d for d in details}

# 索引既有的作品，按 (规范化日文标题, 媒介) 定位 —— 与 AniList 那边同一套身份规则。
# 東立出的是**漫画**的繁中版，所以它只能链到 manga 记录；曾经只按标题索引，
# 会把東立的繁中版挂到同名的轻小说记录上（例如把漫画版 ISBN 记进小说的卷列表）。
by_title_key: dict[tuple, dict] = {}
for w in works.values():
    by_title_key.setdefault((norm_title(w["title_ja"]), w["media_type"]), w)

linked = 0
created_from_tw = 0
unmatched_no_title = 0
for rec in records:
    if rec.get("kind") != "zh_tw_volume":
        continue
    bd = rec.get("bd")
    det = detail_by_bd.get(bd)
    title_ja = (det or {}).get("title_ja")

    if not title_ja:
        # 原文書名 unavailable -> title_ja is unverified. Never invent it, and do
        # not create a Work whose primary field would be a guess.
        unmatched_no_title += 1
        continue

    key = (norm_title(title_ja), "manga")
    target = by_title_key.get(key)
    if target is None:
        # 東立 publishes 原文書名 on its own detail page, so this Japanese title
        # is source-backed — creating a Work from it is grounded, not inferred.
        target = new_work(title_ja, None)
        works["tw:" + key[0]] = target
        by_title_key[key] = target
        created_from_tw += 1
    else:
        linked += 1

    # Every work must carry an explicit yuri_type provenance. For works known
    # only through the Taiwanese 百合姬 catalogue, "this is yuri" is certain
    # (that is literally the series the retailer filed it under) but the subtype
    # is an editorial call with no official source — same shape as the 百合姫 path.
    if "yuri_type" not in target["field_sources"]:
        if not target["genres"]:
            target["genres"] = ["百合"]
            target["genres_official"] = False
        target["field_sources"]["yuri_type"] = {
            "basis": "editorial",
            "source_url": "",
            "retrieved_at": None,
            "confidence": 0.2,
            "note": "東立「百合姬」系列歸類可確認其為百合，但 orthodox/light 等"
                    "下位分類需讀作品本文才能判定，故不臆測。",
        }
        target["field_confidence"]["yuri_type"] = 0.2
        target["field_sources"].setdefault("genres", {
            "basis": "editorial",
            "source_url": TONGLI_URL,
            "retrieved_at": NOW,
            "confidence": 0.8,
            "note": "東立將此書歸入「百合姬」系列，可確認其為百合作品。",
        })
        target["field_confidence"].setdefault("genres", 0.8)

    add_source(target, "tw_tongli", "東立出版社 ThemeGL（百合姬系列）", TONGLI_URL, 0.85)
    set_field(target, "publisher_zh_tw", "東立出版社", "official", TONGLI_URL, 0.9)
    if rec.get("title_zh_tw"):
        set_field(target, "title_zh_tw", rec["title_zh_tw"], "official", TONGLI_URL, 0.9)
        target["title_zh_tw_status"] = "official"
    if not target["authors"] and rec.get("authors_raw"):
        # keep the raw credit string; splitting roles is left to a later pass
        target["authors"] = [rec["authors_raw"]]
        target["field_sources"]["authors"] = {
            "basis": "official", "source_url": TONGLI_URL, "retrieved_at": NOW,
            "confidence": 0.7,
            "note": "東立商品頁的署名（含漫畫/原作/角色原案等角色，未拆分）。",
        }
        target["field_confidence"]["authors"] = 0.7

    if det:
        add_source(target, "tw_tongli", "東立出版社 書籍詳細", det["detail_url"], 0.9)
        vol = {
            "volume": det.get("volume") or rec.get("volume") or 1,
            "isbn": isbn13(det.get("isbn")),
            "release_date": det.get("release_date"),
            "publisher": "東立出版社",
            "translator": det.get("translator"),
            "cover_url": det.get("cover_url") or rec.get("cover_url"),
            "source_url": det["detail_url"],
        }
        if not any(v["volume"] == vol["volume"] for v in target["zh_tw_volumes"]):
            target["zh_tw_volumes"].append(vol)
        target["volume_count_zh_tw"] = max(
            [v["volume"] for v in target["zh_tw_volumes"]] or [0]
        ) or None

    # Cover: store the URL only, never mirror the bytes. Attribution + a takedown
    # route are what make this a 紹介目的 use rather than redistribution.
    cover = (det or {}).get("cover_url") or rec.get("cover_url")
    if cover and not target["cover_url"]:
        target["cover_url"] = cover
        target["cover_source_url"] = (det or {}).get("detail_url") or rec.get("detail_url")
        target["cover_region"] = "zh_tw"
        target["cover_display_allowed"] = True
        target["cover_note"] = (
            "封面著作權屬東立出版社／原權利人。本站只存圖片 URL、不鏡像檔案，"
            "以書籍介紹目的引用並標示出處；權利人可要求下架。"
        )
        target["field_sources"]["cover_url"] = {
            "basis": "official",
            "source_url": target["cover_source_url"],
            "retrieved_at": NOW,
            "confidence": 0.85,
            "note": target["cover_note"],
        }
        target["field_confidence"]["cover_url"] = 0.85

# ---------------------------------------------------------------------------
# 4) AniList -> anime_status / anime_details
# ---------------------------------------------------------------------------
# AniList is a third-party, user-edited database — NOT the official anime site.
# Phase 1 ranked an_official_site as primary and AniList as candidate-detection
# only, so these values carry basis "third_party" and a modest confidence.

ANILIST_URL = "https://graphql.anilist.co"
anime_matched = 0
_anime_path = DATA / "anime_status.json"
if _anime_path.exists():
    _anime_doc = json.loads(_anime_path.read_text(encoding="utf-8"))
    _by_id = {w["id"]: w for w in works.values()}
    for m in _anime_doc.get("matches", []):
        w = _by_id.get(m.get("work_id"))
        if not w:
            continue
        anime_matched += 1
        add_source(w, "an_anilist", "AniList GraphQL API（第三者のアニメDB）",
                   ANILIST_URL, 0.7)
        w["anime_status"] = m.get("our_status") or "none"
        w["anime_details"] = {
            "studio": m.get("studio"),
            "broadcast_date": m.get("broadcast_start"),
            "broadcast_end": m.get("broadcast_end"),
            "episode_count": m.get("episodes"),
            "format": m.get("format"),
            "official_url": None,
            "source_url": m.get("source_url"),
        }
        _note = (
            "AniList（第三者のユーザー編集データベース）による判定。"
            "公式アニメサイト（an_official_site）での確認が望ましい。"
            "AniList ToS により全量ミラーは禁止のため、照合結果のみを保持。"
        )
        w["field_sources"]["anime_status"] = {
            "basis": "third_party", "source_url": m.get("source_url"),
            "retrieved_at": NOW, "confidence": 0.7, "note": _note,
        }
        w["field_confidence"]["anime_status"] = 0.7
        w["field_sources"]["anime_details"] = {
            "basis": "third_party", "source_url": m.get("source_url"),
            "retrieved_at": NOW, "confidence": 0.7, "note": _note,
        }
        w["field_confidence"]["anime_details"] = 0.7

# ---------------------------------------------------------------------------
# 5) NDL -> ja_volumes (Japanese ISBNs)
# ---------------------------------------------------------------------------
# Only records whose normalised NDL title equals a work's normalised title are
# accepted. norm_title strips volume suffixes, so "citrus+ 1" and "citrus+ 2"
# both land on the work "citrus+", which is exactly what we want — but it also
# means a *different* work sharing a prefix could collide, so the volume number
# is re-extracted from the original catalogue title, not from the stripped key.

NDL_URL = "https://ndlsearch.ndl.go.jp/api/opensearch"
ndl_added = 0
_ndl_path = DATA / "ndl_volumes.json"
if _ndl_path.exists():
    _ndl_doc = json.loads(_ndl_path.read_text(encoding="utf-8"))
    _by_key = {}
    for w in works.values():
        _by_key.setdefault(norm_title(w["title_ja"]), []).append(w)

    for rec in _ndl_doc.get("records", []):
        isbn = rec.get("isbn")
        if not isbn:
            continue
        ndl_key = norm_title(rec.get("ndl_title") or "")
        if not ndl_key:
            continue

        # 排除明确不是「本书某一卷」的记录。
        # NDL 按标题检索会返回分冊版、単話、アンソロジー、漫画版等，它们与单行本
        # 不是同一个东西；把这些 ISBN 挂上去会让卷列表出现错误的书。
        # 数据实证：data/ndl_volumes.json 里 249 条中有 138 条的 ndl_title 与所属
        # 作品标题不一致（citrus+ 甚至被挂上了柑橘类生物学论文）。
        _NEGATIVE_MARKERS = (
            "分冊版", "単話", "アンソロジー", "アンソロジ-", "公式コミック",
            "【", "同人", "画集", "公式ガイド", "ファンブック", "ノベライズ",
        )
        if any(m in (rec.get("ndl_title") or "") for m in _NEGATIVE_MARKERS):
            continue

        # NDL catalogue titles usually carry a label parenthetical, e.g.
        #   「ささやくように恋を唄う 12 (百合姫コミックス)」
        # which normalisation does not reduce to the bare work title. So accept a
        # prefix match too — but ONLY when what follows the title is a volume
        # number or a bracketed label, never an arbitrary continuation of another
        # work's title ("志乃と恋" must not swallow "志乃と恋Future").
        targets = list(_by_key.get(ndl_key, []))
        if not targets and len(ndl_key) >= 4:
            for key, ws in _by_key.items():
                if len(key) < 4 or not ndl_key.startswith(key):
                    continue
                rest = ndl_key[len(key):].lstrip()
                if not rest:
                    continue
                if rest[0].isdigit() or rest[0] in "（(【[":
                    targets.extend(ws)

        for w in targets:
            if any(v.get("isbn") == isbn for v in w["ja_volumes"]):
                continue
            num = extract_volume_number(rec.get("ndl_title") or "", w["title_ja"])
            if num is None:
                num = len(w["ja_volumes"]) + 1
            # same volume number may reappear across editions; keep the first ISBN
            if any(v.get("volume") == num for v in w["ja_volumes"]):
                continue
            w["ja_volumes"].append(
                {
                    "volume": num,
                    "isbn": isbn,
                    "release_date": rec.get("release_date"),
                    "publisher": rec.get("publisher"),
                    "price": None,
                    "cover_url": None,
                    "source_url": rec.get("link") or NDL_URL,
                }
            )
            ndl_added += 1
            add_source(w, "ja_ndl_search_sru_opensearch",
                       "国立国会図書館サーチ（NDL Search）", NDL_URL, 0.9)

        # NDL 出版者 is authoritative — use it to fill publisher_ja when unknown.
        pub = rec.get("publisher")
        if pub:
            for w in targets:
                if not w.get("publisher_ja"):
                    set_field(w, "publisher_ja", pub, "official",
                              rec.get("link") or NDL_URL, 0.9)

    for w in works.values():
        if not w["ja_volumes"]:
            continue
        w["ja_volumes"].sort(key=lambda v: v["volume"])
        w["volume_count_ja"] = max(v["volume"] for v in w["ja_volumes"])
        w["field_sources"]["volume_count_ja"] = {
            "basis": "derived",
            "source_url": NDL_URL,
            "retrieved_at": NOW,
            "confidence": 0.7,
            "note": "NDL 書誌から得た既知の巻の最大値。欠けている巻があると実際の刊行数より"
                    "小さくなるため、下限値として扱うこと。",
        }
        w["field_confidence"]["volume_count_ja"] = 0.7

# ---------------------------------------------------------------------------
# 5b) Last-resort, explicitly-flagged inference for 繁中-catalogue-only works
# ---------------------------------------------------------------------------
# 東立's ThemeGL series is labelled 「百合姬」, which corresponds to 一迅社's
# 百合姫コミックス line. That is enough to infer the Japanese publisher — but it
# is an INFERENCE from a Taiwanese retail label, not a Japanese source, so it is
# recorded as `derived` with a modest confidence and a note. We deliberately do
# NOT infer the magazine from it: a 百合姫コミックス volume is not necessarily
# serialised in コミック百合姫.
TW_LABEL_INFERRED = 0
for w in works.values():
    if w.get("publisher_ja") or w.get("publisher_zh_tw") != "東立出版社":
        continue
    if not any("tongli.com.tw" in (v.get("source_url") or "") for v in w["zh_tw_volumes"]):
        continue
    TW_LABEL_INFERRED += 1
    set_field(w, "publisher_ja", "一迅社", "derived", TONGLI_URL, 0.6)
    w["field_sources"]["publisher_ja"]["note"] = (
        "東立商品頁的系列標示為「百合姬」→ 推定為一迅社 百合姫コミックス。"
        "這是從台灣零售標籤推定的，未經日方來源確認；應以 NDL 書誌複核。"
    )
    # The label itself IS knowable from the Taiwanese catalogue, so record it as
    # a label (not a magazine). serialization_status stays unknown — it is simply
    # not published anywhere we may legally read.
    set_field(w, "magazine_or_platform", "百合姫コミックス", "derived", TONGLI_URL, 0.6)
    w["field_sources"]["magazine_or_platform"]["note"] = (
        "東立「百合姬」系列對應一迅社 百合姫コミックス レーベル（単行本ブランド）。"
        "単行本レーベルであって掲載誌ではないため kind=label として記録。"
    )
    set_field(w, "magazine_or_platform_kind", "label", "derived", TONGLI_URL, 0.6)
    w["field_sources"]["serialization_status"] = {
        "basis": "editorial", "source_url": "", "retrieved_at": None,
        "confidence": 0.0,
        "note": "繁中零售書目只提供「已出版」資訊，不含連載狀態；"
                "日方來源（百合姫 目次・NDL）未覆蓋此作品，因此誠實地留 unknown。",
    }
    w["field_confidence"]["serialization_status"] = 0.0
    # record that a Chinese edition exists (verified), vs merely uncollected
    if w.get("title_zh_tw"):
        w["title_zh_tw_status"] = "official"

# ---------------------------------------------------------------------------
# 5c) 出版社 + 出版文库 / レーベル（NDL 的 publisher + seriesTitle）
# ---------------------------------------------------------------------------
# 用户要求：
#   「无官方繁体中文版本的文库日文轻小说，需要注明出版文库」（文库）
#   「漫画库也要扩展，不局限于台湾出版社已出版的繁中版」（漫画同样需要出版社）
# AniList 不提供出版社与文库；NDL 书志的 publisher / seriesTitle 是一手来源。
# 轻小说的 seriesTitle 是文库名（電撃文庫…），漫画的是レーベル名（百合姫コミックス…）。

ndl_enriched = 0
ndl_label_set = 0
_ndl_enrich_path = DATA / "ndl_enrichment.json"
if _ndl_enrich_path.exists():
    _enr = json.loads(_ndl_enrich_path.read_text(encoding="utf-8"))
    _idx3: dict[str, dict] = {}
    for w in works.values():
        _idx3.setdefault(norm_title(w["title_ja"]), w)

    # 媒介与 NDL レーベル必须匹配。
    #
    # norm_title 会**剥掉卷号**（安達としまむら（９） -> 安達としまむら），所以
    # 单靠标题相等挡不住「漫画卷被当成小说本体」这种错配 —— 这正是实际发生过的：
    #   安達としまむら（轻小说）拿到了 電撃コミックスＮＥＸＴ 的 ISBN/发售日
    #   志乃と恋（漫画）反而拿到了 富士見ファンタジア文庫 —— 小说标签
    # 日本的レーベル名本身就是可靠的分界：コミックス 系是漫画，文庫 系是小说。
    _COMICS_LABEL_HINTS = ("コミックス", "こみっくす", "comics")
    _NOVEL_LABEL_HINTS = ("文庫", "ぶんこ", "novel")

    def _label_of(rec: dict) -> str:
        return (rec.get("label") or "").lower()

    def _media_consistent(media_type: str, label: str) -> bool:
        if not label:
            return True  # 无标签时无从判断，交由其他校验
        is_comics = any(h in label for h in _COMICS_LABEL_HINTS)
        is_novel = any(h in label for h in _NOVEL_LABEL_HINTS)
        if media_type == "light_novel" and is_comics and not is_novel:
            return False
        if media_type == "manga" and is_novel and not is_comics:
            return False
        return True

    for rec in _enr.get("records", []):
        w = _idx3.get(norm_title(rec.get("title_ja") or ""))
        if w is None:
            continue
        if not _media_consistent(w["media_type"], _label_of(rec)):
            continue
        _url = rec.get("source_url") or NDL_URL
        add_source(w, "ja_ndl_search_sru_opensearch",
                   "国立国会図書館サーチ（NDL Search）", NDL_URL, 0.9)
        touched = False
        if rec.get("publisher_ja") and not w.get("publisher_ja"):
            set_field(w, "publisher_ja", rec["publisher_ja"], "official", _url, 0.9)
            touched = True
        if rec.get("label"):
            set_field(w, "magazine_or_platform", rec["label"], "official", _url, 0.85)
            set_field(w, "magazine_or_platform_kind", "label", "official", _url, 0.85)
            _kind = "出版文庫" if w["media_type"] == "light_novel" else "レーベル"
            w["field_sources"]["magazine_or_platform"]["note"] = (
                f"NDL 書誌の seriesTitle「{rec.get('label_raw')}」から抽出した{_kind}。"
                "単行本ブランドであり掲載誌ではないため kind=label。"
            )
            ndl_label_set += 1
            touched = True
        if rec.get("isbn") and not w["ja_volumes"]:
            w["ja_volumes"].append({
                "volume": 1, "isbn": rec["isbn"],
                "release_date": rec.get("release_date"),
                "publisher": rec.get("publisher_ja"),
                "price": None, "cover_url": None, "source_url": _url,
            })
            w["volume_count_ja"] = w.get("volume_count_ja") or 1
        if touched:
            ndl_enriched += 1

# ---------------------------------------------------------------------------
# 6) dedupe pass (titleKey + authorKey) and merge bookkeeping
# ---------------------------------------------------------------------------

groups: dict[tuple, list[str]] = defaultdict(list)
for wid, w in works.items():
    # 键里必须带 media_type。
    # 只按「标题 + 第一作者」去重的话，同一部作品的轻小说版与漫画版会被合并回去：
    # 《安達としまむら》小说作者是入間人間，其漫画版的第一作者**也是**入間人間
    # （原作），于是两者被判定为同一条，作者栏变成「入間人間、柚原もけ」。
    # 加上媒介后 LN 与漫画各自独立，这正是用户要的。
    k = (
        norm_title(w["title_ja"]),
        norm_name((w["authors"] or [""])[0]),
        w["media_type"],
    )
    groups[k].append(wid)

for k, ids in groups.items():
    if len(ids) <= 1 or not k[0]:
        continue
    ids.sort(key=lambda i: (-sum(1 for v in works[i].values() if v not in (None, "", [], {})), i))
    keep, drop = ids[0], ids[1:]
    for d in drop:
        merge_log.append({"kept": keep, "merged": d, "key": list(k), "score": 1.0, "rule": "titleKey+authorKey exact"})
        works.pop(d)

# ---------------------------------------------------------------------------
# 5) validate + report
# ---------------------------------------------------------------------------

schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
validator = Draft202012Validator(schema, format_checker=FormatChecker())

# ---------------------------------------------------------------------------
# id 唯一性后处理
# ---------------------------------------------------------------------------
# new_work() 用 make_id(规范化标题|规范化第一作者) 生成 id，**不含 media_type**。
# 拆分「轻小说本体」与「它的漫画版」之后，两者标题相同、第一作者往往也都是
# 原作者（《安達としまむら》：两边都是入間人間），于是算出完全相同的 id。
# 前端用 id 作 React key、也是记录标识，重复会导致渲染与契约检查失败。
#
# 这里只改冲突的那几条，其余 id 保持原样 —— 因此现存的 id 与 slug 都不变，
# 已发布的网址也不会失效（URL 用的是 slug，slug 由 make_slug 独立派生）。
_sorted_for_ids = sorted(works.values(), key=lambda x: (x["media_type"], x["slug"]))
_seen_ids: set[str] = set()
_id_reassigned = 0
for _w in _sorted_for_ids:
    if _w["id"] not in _seen_ids:
        _seen_ids.add(_w["id"])
        continue
    _base = (
        norm_title(_w["title_ja"])
        + "|"
        + norm_name((_w["authors"] or [""])[0])
        + "|"
        + _w["media_type"]
    )
    _new_id = make_id(_base)
    _k = 2
    while _new_id in _seen_ids:
        _new_id = make_id(_base + "|" + str(_k))
        _k += 1
    _w["id"] = _new_id
    _seen_ids.add(_new_id)
    _id_reassigned += 1

out = sorted(works.values(), key=lambda w: w["title_ja"])

# ---------------------------------------------------------------------------
# 保留已有的 created_at。
# ---------------------------------------------------------------------------
# new_work() 把 created_at 设成 NOW，但 created_at 的语义是「这条记录**首次**
# 建立的时间」，不是「这份数据集上次重建的时间」。不修的话每跑一次
# build_dataset，835 条作品的 created_at/updated_at 全部变化，产生约 2 万行
# 纯时间戳 diff —— 真正需要审查的改动会被完全淹没。
# work id 是确定性哈希（w-<hash>），所以按 id 回填是安全的。
_prev_created: dict[str, str] = {}
_prev_works_path = DATA / "works.json"
if _prev_works_path.exists():
    try:
        _prev_doc = json.loads(_prev_works_path.read_text(encoding="utf-8"))
        for _w in _prev_doc.get("works", []):
            if _w.get("id") and _w.get("created_at"):
                _prev_created[_w["id"]] = _w["created_at"]
    except (json.JSONDecodeError, OSError):
        _prev_created = {}

_created_preserved = 0
for _w in out:
    if _w["id"] in _prev_created:
        _w["created_at"] = _prev_created[_w["id"]]
        _created_preserved += 1

errors: list[str] = []
for w in out:
    for e in validator.iter_errors(w):
        errors.append(f"{w['slug']}: {list(e.path)}: {e.message}")

(DATA / "works.json").write_text(
    json.dumps({"generated_at": NOW, "count": len(out), "works": out}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

CORE = ["title_ja", "authors", "media_type", "publisher_ja",
        "serialization_status", "magazine_or_platform", "sources", "last_checked"]
EXT = ["volume_count_ja", "volume_count_zh_tw", "start_date", "latest_chapter_label",
       "chapter_count", "title_zh_tw", "magazine_or_platform_active"]


def filled(w: dict, f: str) -> bool:
    v = w.get(f)
    if f == "serialization_status":
        return v not in (None, "unknown")
    return v not in (None, "", [], {})


CURATED_SOURCE_IDS = {
    "ja_yurihime", "ja_galette", "tw_tongli",
    "ja_ndl_search_sru_opensearch", "ja_openbd",
}


def tier_of(w: dict) -> str:
    """curated = 有出版社/书目一手来源；catalogue = 仅第三方目录。"""
    ids = {s.get("source_id") for s in (w.get("sources") or [])}
    return "curated" if ids & CURATED_SOURCE_IDS else "catalogue"


report = {
    "generated_at": NOW,
    "source_records": raw["counts"],
    "works_total": len(out),
    "created_at_preserved": _created_preserved,
    "by_media_type": dict(Counter(w["media_type"] for w in out)),
    "anilist_created": anilist_created,
    "anilist_enriched": anilist_enriched,
    "anilist_skipped_manga": anilist_skipped_manga,
    # 同一 (标题, 媒介) 的多条 AniList 条目只保留 popularity 最高的一条，
    # 其余丢弃（多数是同一作品的两个不同漫画化版本，合并会把两位绘者混进一条记录）
    "anilist_dropped_duplicate_entries": anilist_dropped_dupes,
    "ndl_enriched_works": ndl_enriched,
    "ndl_label_set": ndl_label_set,
    "by_status": dict(Counter(w["serialization_status"] for w in out)),
    "by_magazine": dict(Counter(w["magazine_or_platform"] or "unknown" for w in out)),
    "core_field_completeness": {
        f: round(sum(1 for w in out if filled(w, f)) / len(out), 4) for f in CORE
    },
    # 按媒介类型拆分。合并后的分母里混着「日方一手来源的漫画」与
    # 「AniList 目录 + NDL 补全的轻小说」，只看总和会掩盖两者差距。
    "core_field_completeness_by_media_type": {
        mt: {
            "count": n,
            **{f: round(sum(1 for w in out if w["media_type"] == mt and filled(w, f)) / n, 4)
               for f in CORE},
        }
        for mt, n in Counter(w["media_type"] for w in out).items()
    },
    "publisher_ja_coverage_by_media_type": {
        mt: round(sum(1 for w in out if w["media_type"] == mt and w.get("publisher_ja")) / n, 4)
        for mt, n in Counter(w["media_type"] for w in out).items()
    },
    # 按「来源层级」拆分。库里现在混着两类记录，把它们的完整率加在一起会误导：
    #   curated   = 有日方/繁中出版社一手来源（百合姫・ガレット・東立・NDL）
    #   catalogue = 只有 AniList 目录（标题/作者/卷数/封面可信，但出版社待 NDL 补全）
    # catalogue 记录会随每日 NDL 补全任务逐步升级为 curated。
    "core_field_completeness_by_tier": {
        tier: {
            "count": n,
            **{f: round(sum(1 for w in out if tier_of(w) == tier and filled(w, f)) / n, 4)
               for f in CORE},
        }
        for tier, n in Counter(tier_of(w) for w in out).items()
    },
    "extended_field_completeness": {
        f: round(sum(1 for w in out if filled(w, f)) / len(out), 4) for f in EXT
    },
    "works_with_zh_tw_volumes": sum(1 for w in out if w["zh_tw_volumes"]),
    "cross_language_linked": linked,
    "works_created_from_tw_catalogue": created_from_tw,
    "tw_records_without_original_title": unmatched_no_title,
    "works_with_cover": sum(1 for w in out if w["cover_url"]),
    "works_with_title_zh_tw": sum(1 for w in out if w["title_zh_tw"]),
    "works_with_title_zh_cn": sum(1 for w in out if w["title_zh_cn"]),
    "anime_matched": anime_matched,
    "works_with_anime": sum(1 for w in out if w["anime_status"] not in ("none", None)),
    "ndl_volumes_added": ndl_added,
    "works_with_ja_volumes": sum(1 for w in out if w["ja_volumes"]),
    "merges": merge_log,
    "schema_errors": errors,
    "raw_files": len(list((DATA / "raw").rglob("*.*"))) if (DATA / "raw").exists() else 0,
}
(DATA / "dataset_report.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
)
(DATA / "zh_tw_pending_linkage.json").write_text(
    json.dumps(
        {
            "generated_at": NOW,
            "note": "東立書目中未取得「原文書名」因而無法確認日文原名的記錄。"
                    "title_ja 必須可驗證，因此不建 Work、也不編造。",
            "count": unmatched_no_title,
        },
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)

print(f"works: {len(out)}")
print(f"by media type: {report['by_media_type']}")
print(f"by magazine: {report['by_magazine']}")
print(f"cross-language linked (東立 原文書名 -> 日文原作): {linked}")
print("\ncore field completeness:")
for f, v in report["core_field_completeness"].items():
    print(f"  {f:28} {v:6.1%}")
print("\nextended field completeness:")
for f, v in report["extended_field_completeness"].items():
    print(f"  {f:28} {v:6.1%}")
print(f"\nschema validation errors: {len(errors)}")
for e in errors[:10]:
    print("  " + e)
print(f"\nwrote {DATA / 'works.json'}")
print(f"wrote {DATA / 'dataset_report.json'}")
raise SystemExit(1 if errors else 0)
