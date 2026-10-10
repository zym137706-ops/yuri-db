#!/usr/bin/env python3
"""Minimal HTML -> text extractor for research evidence.

Usage: python extract_text.py <file.html> [max_chars]
Prints UTF-8 text so Japanese/Chinese content is readable regardless of
the Windows console code page.
"""
import re
import sys
import io
import html

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def strip_html(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?is)<!--.*?-->", " ", raw)
    raw = re.sub(r"(?i)<br\s*/?>", "\n", raw)
    raw = re.sub(r"(?i)</(p|div|li|tr|h[1-6]|section|article)>", "\n", raw)
    raw = re.sub(r"<[^>]+>", " ", raw)
    raw = html.unescape(raw)
    raw = raw.replace("\u00a0", " ")
    lines = []
    for line in raw.split("\n"):
        line = re.sub(r"[ \t\u3000]+", " ", line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    path = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 4000
    with open(path, "rb") as fh:
        blob = fh.read()
    for enc in ("utf-8", "cp932", "big5"):
        try:
            raw = blob.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raw = blob.decode("utf-8", errors="replace")
    text = strip_html(raw)
    if len(text) > limit:
        print(text[:limit] + f"\n... [truncated, total {len(text)} chars]")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
