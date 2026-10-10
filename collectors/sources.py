#!/usr/bin/env python3
"""Source collectors for yuri-db.

Each collector returns a list of raw records tagged with their source id.
Parsing is intentionally defensive: anything not confidently extracted is left
as None so the normaliser can emit `unknown` rather than inventing a value.
"""
from __future__ import annotations

import re
from urllib.parse import unquote, urljoin

from lxml import html as lxml_html

from base import FetchResult, Fetcher, RunStats, now_iso

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

_WS = re.compile(r"[\s\u3000]+")
_RATING_VOL = re.compile(r"[（(]第\s*(\d+)\s*[集巻巻][)）]")


def _lines(el) -> list[str]:
    text = el.text_content() if el is not None else ""
    return [s.strip() for s in text.splitlines() if s.strip()]


def _clean(s: str | None) -> str | None:
    if s is None:
        return None
    s = _WS.sub(" ", s).strip()
    return s or None


def _doc(res: FetchResult):
    """Parse decoded text (never bytes) so the HTTP layer owns encoding."""
    return lxml_html.fromstring(res.text)


# ---------------------------------------------------------------------------
# 1) コミック百合姫（一迅社）
# ---------------------------------------------------------------------------

YURIHIME_URL = "https://www.ichijinsha.co.jp/yurihime/"


def collect_yurihime(f: Fetcher) -> tuple[list[dict], RunStats]:
    stats = RunStats(source_id="ja_yurihime")
    res = f.get(YURIHIME_URL, "ja_yurihime")
    stats.record(res)
    if not res.ok:
        return [], stats

    doc = _doc(res)
    records: list[dict] = []

    # 最新号
    issue_title = None
    issue_date = None
    mag = doc.xpath('//*[contains(@class,"home-magazine__title")]')
    if mag:
        txt = _lines(mag[0])
        issue_title = txt[0] if txt else None
    m = re.search(r"(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日", res.text)
    if m:
        issue_date = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"

    # 連載作品一覧（container is a div, items are div.home-titles__item）
    for li in doc.xpath('//*[contains(@class,"home-titles__item")]'):
        a = li.xpath(".//a[contains(@href,'/yurihime/title/')]")
        if not a:
            continue
        href = urljoin(YURIHIME_URL, a[0].get("href"))
        parts = _lines(a[0])
        if not parts:
            continue
        title = _clean(parts[0])
        author = _clean(parts[1]) if len(parts) > 1 else None
        if not title:
            continue
        records.append(
            {
                "source_id": "ja_yurihime",
                "kind": "serialized_work",
                "title_ja": title,
                "authors": [author] if author else [],
                "work_url": href,
                "magazine": "コミック百合姫",
                "publisher_ja": "一迅社",
                "issue_title": issue_title,
                "issue_date": issue_date,
                "source_url": YURIHIME_URL,
                "retrieved_at": now_iso(),
            }
        )

    # 新刊コミックス（百合姫コミックス）
    for li in doc.xpath('//*[contains(@class,"home-comics__item")]'):
        parts = _lines(li)
        if not parts:
            continue
        rec = {
            "source_id": "ja_yurihime",
            "kind": "new_volume",
            "raw_text": parts,
            "publisher_ja": "一迅社",
            "label": "百合姫コミックス",
            "source_url": YURIHIME_URL,
        }
        m2 = _RATING_VOL.search(" ".join(parts))
        if m2:
            rec["volume"] = int(m2.group(1))
        for p in parts:
            if re.fullmatch(r"\d{4}\.\d{2}\.\d{2}", p):
                rec["release_date"] = p.replace(".", "-")
        records.append(rec)

    # ニュース
    for li in doc.xpath('//*[contains(@class,"home-news__item")]'):
        parts = _lines(li)
        if not parts:
            continue
        a = li.xpath(".//a")
        records.append(
            {
                "source_id": "ja_yurihime",
                "kind": "news",
                "text": parts,
                "url": urljoin(YURIHIME_URL, a[0].get("href")) if a else None,
                "source_url": YURIHIME_URL,
            }
        )

    stats.items_seen = len(records)
    return records, stats


# ---------------------------------------------------------------------------
# 2) ガレット（自主制作百合コミック誌）
# ---------------------------------------------------------------------------

GALETTE_ISSUE_URL = "https://galetteweb.com/archives/3190"  # No.37
GALETTE_HOME = "https://galetteweb.com/"

_SECTION_HEADS = {"連載", "読み切り", "ILLUSTRATION", "読み物", "デザイン", "表紙"}
_SERIAL_RE = re.compile(r"^[・\u30fb]\s*(?P<author>\S+)\s+(?P<title>.+?)(?P<chap>#\d+)?$")


def collect_galette(f: Fetcher) -> tuple[list[dict], RunStats]:
    stats = RunStats(source_id="ja_galette")
    res = f.get(GALETTE_ISSUE_URL, "ja_galette")
    stats.record(res)
    if not res.ok:
        return [], stats

    doc = _doc(res)
    text = doc.text_content()
    raw_lines = [s.strip() for s in text.splitlines() if s.strip()]

    # 発行日・判型・ページ数
    issue_title = next((l for l in raw_lines if "ガレットNo." in l and "-" in l), None)
    issue_date = None
    m = re.search(r"発行日\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日", text)
    if m:
        issue_date = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    spec = None
    ms = re.search(r"仕様\s*([A-B]\d判／\d+ページ)", text)
    if ms:
        spec = ms.group(1)

    records: list[dict] = []
    section = None
    new_serial = False
    for line in raw_lines:
        if line.startswith("★") and "新連載" in line:
            new_serial = True
            continue
        if line in _SECTION_HEADS:
            section = line
            continue
        if not line.startswith(("・", "\u30fb")):
            continue
        if section == "連載" or new_serial:
            m2 = _SERIAL_RE.match(line)
            if not m2:
                continue
            author = _clean(m2.group("author"))
            title = _clean(m2.group("title"))
            chap = m2.group("chap")
            records.append(
                {
                    "source_id": "ja_galette",
                    "kind": "serialized_work",
                    "title_ja": title,
                    "authors": [author] if author else [],
                    "latest_chapter_label": chap,
                    "magazine": "ガレット",
                    "publisher_ja": "GALETTE WORKS",
                    "publisher_note": "自主制作（非大型商业出版社）",
                    "new_serial": new_serial,
                    "issue_title": issue_title,
                    "issue_date": issue_date,
                    "issue_spec": spec,
                    "source_url": GALETTE_ISSUE_URL,
                }
            )
            new_serial = False

    stats.items_seen = len(records)
    return records, stats


# ---------------------------------------------------------------------------
# 3) 東立出版社（繁中）
# ---------------------------------------------------------------------------

TONGLI_GL_URL = "https://www.tongli.com.tw/ThemeGL.aspx?page=1&s=1"
TONGLI_DETAIL = "https://www.tongli.com.tw/BooksDetail.aspx?Bd={bd}"
_TONGLI_VOL = re.compile(r"[（(]第\s*(\d+)\s*集[)）]")


def collect_tongli_list(f: Fetcher) -> tuple[list[dict], RunStats]:
    stats = RunStats(source_id="tw_tongli")
    res = f.get(TONGLI_GL_URL, "tw_tongli")
    stats.record(res)
    if not res.ok:
        return [], stats

    doc = _doc(res)
    records: list[dict] = []
    for pkg in doc.xpath('//div[contains(@class,"b_package")]'):
        a = pkg.xpath('.//a[contains(@href,"BooksDetail.aspx")]')
        if not a:
            continue
        href = a[0].get("href")
        bd = href.split("Bd=")[-1]
        img = pkg.xpath('.//div[contains(@class,"pk_img")]//img')
        cover_rel = img[0].get("src") if img else None
        cover_alt = _clean(img[0].get("alt")) if img else None
        em = pkg.xpath('.//div[contains(@class,"pk_txt")]//em/text()')
        spans = pkg.xpath('.//div[contains(@class,"pk_txt")]//span/text()')
        title = _clean(em[0]) if em else cover_alt
        authors_raw = _clean(spans[0]) if len(spans) > 0 else None
        vol_raw = _clean(spans[1]) if len(spans) > 1 else None
        vol = None
        if vol_raw:
            mv = _TONGLI_VOL.search(vol_raw)
            if mv:
                vol = int(mv.group(1))
        records.append(
            {
                "source_id": "tw_tongli",
                "kind": "zh_tw_volume",
                "title_zh_tw": title,
                "authors_raw": authors_raw,
                "volume": vol,
                "detail_url": urljoin(TONGLI_GL_URL, href),
                "bd": bd,
                # cover is stored as a URL only — we never mirror publisher images
                "cover_url": urljoin(TONGLI_GL_URL, cover_rel) if cover_rel else None,
                "publisher_zh_tw": "東立出版社",
                "series": "百合姬",
                "source_url": TONGLI_GL_URL,
            }
        )
    stats.items_seen = len(records)
    return records, stats


_DETAIL_KEYS = {
    "原文書名": "title_ja",
    "集數": "volume_label",
    "譯者": "translator",
    "出版日期": "release_date",
    "ISBN": "isbn",
    "系列別": "series",
    "作者": "author",
}


def collect_tongli_detail(f: Fetcher, bd: str) -> tuple[dict | None, RunStats]:
    stats = RunStats(source_id="tw_tongli")
    url = TONGLI_DETAIL.format(bd=bd)
    res = f.get(url, "tw_tongli")
    stats.record(res)
    if not res.ok:
        return None, stats

    doc = _doc(res)
    text = _WS.sub(" ", doc.text_content())
    out: dict = {"source_id": "tw_tongli", "kind": "zh_tw_volume_detail",
                 "bd": bd, "detail_url": url, "source_url": url}

    # og:image gives an absolute cover URL; we store the link, never the bytes.
    og = re.search(r'property="og:image"\s+content="([^"]+)"', res.text)
    if og:
        out["cover_url"] = og.group(1)
    else:
        img = re.search(r'<img[^>]+src="([^"]*ComicImages[^"]+)"', res.text)
        if img:
            out["cover_url"] = urljoin(url, img.group(1))

    for label, key in _DETAIL_KEYS.items():
        m = re.search(rf"{label}\s*[:：]?\s*([^ ]{{1,60}})", text)
        if m:
            out[key] = _clean(m.group(1))

    m = re.search(r"ISBN\s*[:：]?\s*([0-9\-]{10,20})", text)
    if m:
        out["isbn"] = re.sub(r"[^0-9X]", "", m.group(1))
    m = re.search(r"(\d{4}/\d{1,2}/\d{1,2})", text)
    if m:
        y, mo, d = m.group(1).split("/")
        out["release_date"] = f"{y}-{int(mo):02d}-{int(d):02d}"
    m = re.search(r"[（(]第\s*(\d+)\s*集[)）]", text)
    if m:
        out["volume"] = int(m.group(1))
    stats.items_seen = 1
    return out, stats


# ---------------------------------------------------------------------------
# 4) openBD（日版单行本 ISBN 补完）
# ---------------------------------------------------------------------------

OPENBD = "https://api.openbd.jp/v1/get?isbn={isbn}"


def collect_openbd(f: Fetcher, isbns: list[str]) -> tuple[list[dict], RunStats]:
    """Batch ISBN lookup. openBD accepts comma-separated ISBNs."""
    stats = RunStats(source_id="ja_openbd")
    out: list[dict] = []
    CHUNK = 10  # keep URLs short; openBD is slow
    for i in range(0, len(isbns), CHUNK):
        chunk = isbns[i : i + CHUNK]
        url = OPENBD.format(isbn=",".join(chunk))
        res = f.get(url, "ja_openbd")
        stats.record(res)
        if not res.ok:
            continue
        try:
            import json as _json

            data = _json.loads(res.text)
        except Exception:
            continue
        for entry in data:
            if not entry:
                continue
            summary = entry.get("summary") or {}
            hanmoto = entry.get("hanmoto") or {}
            onix = entry.get("onix") or {}
            out.append(
                {
                    "source_id": "ja_openbd",
                    "kind": "ja_volume",
                    "isbn": summary.get("isbn"),
                    "title_ja": summary.get("title"),
                    "volume": summary.get("volume"),
                    "series": summary.get("series"),
                    "publisher_ja": summary.get("publisher"),
                    "pubdate": summary.get("pubdate"),
                    "author": summary.get("author"),
                    "cover_url": summary.get("cover"),
                    "lanove": hanmoto.get("lanove"),
                    "reviews": hanmoto.get("reviews"),
                    "onix_title": (
                        onix.get("DescriptiveDetail", {})
                        .get("TitleDetail", {})
                        .get("TitleElement", {})
                        .get("TitleText", {})
                        .get("content")
                    ),
                    "source_url": url,
                }
            )
    stats.items_seen = len(out)
    return out, stats
