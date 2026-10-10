#!/usr/bin/env python3
"""Canonical normalisation functions — single source of truth.

Both the collectors and the dataset builder import from here. Keeping one
implementation matters: duplicate definitions of "the same" normalisation have
already produced a real bug in this project (two different definitions of
average field confidence produced different values for the same record).

Rules are documented in docs/phase2-dedup-strategy.md §1.
"""
from __future__ import annotations

import re
import unicodedata
from hashlib import sha1

_WS = re.compile(r"[\s\u3000]+")

# Volume-suffix patterns stripped from titles before comparison.
_VOL_SUFFIX = re.compile(
    r"[（(]\s*\d+\s*[)）]|\u3010\d+\u3011|\[\d+\]|第\s*\d+\s*[巻巻卷]|\s\d+$"
)

# NEVER strip these: citrus vs citrus+, ゆるゆり vs ゆるゆり♪♪ are different works
# (dedup doc §5, trap T1). Listed here to make the intent explicit.
SEQUEL_MARKERS = ("+", "♪", "☆", "★", "Ⅱ", "Ⅲ", "2", "3", "S", "R")


def norm_title(s: str | None) -> str:
    """Normalised title key for matching. Not for display."""
    if not s:
        return ""
    t = unicodedata.normalize("NFKC", s)
    for a, b in (("〜", "~"), ("～", "~"), ("－", "-"), ("−", "-"), ("—", "-"), ("–", "-")):
        t = t.replace(a, b)
    t = _WS.sub("", t)
    t = _VOL_SUFFIX.sub("", t)
    return t.lower()


def norm_name(s: str | None) -> str:
    """Normalised person name key ('仲谷 鳰' -> '仲谷鳰')."""
    if not s:
        return ""
    t = unicodedata.normalize("NFKC", s)
    t = _WS.sub("", t)
    t = t.replace("・", "")
    for suf in ("先生", "氏"):
        if t.endswith(suf):
            t = t[: -len(suf)]
    return t.lower()


def norm_publisher(s: str | None) -> str:
    """Normalised publisher key (strips legal-form noise)."""
    if not s:
        return ""
    t = unicodedata.normalize("NFKC", s)
    for junk in ("株式会社", "(株)", "有限会社", "合同会社", "Inc.", "LLC"):
        t = t.replace(junk, "")
    t = _WS.sub("", t)
    return t.lower()


def isbn13(raw: str | None) -> str | None:
    """Normalise to a 13-digit ISBN string, or None when invalid.

    Never repairs a bad checksum: an invalid ISBN is dropped, not guessed
    (dedup doc §1 L1, test case U8).
    """
    if not raw:
        return None
    d = re.sub(r"[^0-9Xx]", "", raw).upper()
    if len(d) == 10:
        core = "978" + d[:9]
        chk = (10 - sum((3 if i % 2 else 1) * int(c) for i, c in enumerate(core)) % 10) % 10
        d = core + str(chk)
    if len(d) != 13 or not d.isdigit():
        return None
    s = sum((1 if i % 2 == 0 else 3) * int(c) for i, c in enumerate(d[:12]))
    if (10 - s % 10) % 10 != int(d[12]):
        return None
    return d


# Sequel markers must survive slugging too. `citrus+` -> /works/citrus would
# collide with a hypothetical `citrus` (dedup doc §5, trap T1), so encode them.
_SEQUEL_SLUG = {
    "+": "-plus",
    "♪": "-note",
    "☆": "-star",
    "★": "-star",
    "Ⅱ": "-2",
    "Ⅲ": "-3",
    "Ⅰ": "-1",
}


def make_slug(title: str, author: str | None = None) -> str:
    """ASCII slug: readable when the title is ASCII-representable, else a hash."""
    t = title
    for mark, repl in _SEQUEL_SLUG.items():
        t = t.replace(mark, repl)
    base = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-zA-Z0-9]+", "-", base).strip("-").lower()
    if len(base) >= 2:
        return base[:60]
    return "w-" + sha1(f"{title}|{author or ''}".encode()).hexdigest()[:10]


def make_id(key: str) -> str:
    return "c" + sha1(key.encode()).hexdigest()[:24]


_VOL_PATTERNS = (
    r"第\s*(\d{1,3})\s*[巻巻卷]",
    r"[（(]\s*(\d{1,3})\s*[)）]",
    r"(\d{1,3})\s*[巻巻卷]",
    r"(?:^|\s)(\d{1,3})(?:\s|$)",
)


def extract_volume_number(candidate_title: str, work_title: str) -> int | None:
    """Pull the volume number out of a catalogue title.

    'citrus+ 1' with work 'citrus+' -> 1
    '私の百合はお仕事です！ 3巻' -> 3
    Returns None rather than guessing when no number is present.
    """
    if not candidate_title:
        return None
    t = unicodedata.normalize("NFKC", candidate_title)
    w = unicodedata.normalize("NFKC", work_title or "")
    rest = t.replace(w, " ") if w else t
    for pat in _VOL_PATTERNS:
        m = re.search(pat, rest)
        if m:
            try:
                n = int(m.group(1))
            except (TypeError, ValueError):
                continue
            if 1 <= n <= 200:
                return n
    return None
