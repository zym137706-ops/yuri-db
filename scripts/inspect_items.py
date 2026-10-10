#!/usr/bin/env python3
"""Dump the text of repeated item containers, to derive a parser."""
import io
import sys

from lxml import html

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

path, selector = sys.argv[1], sys.argv[2]
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 3

# Accept either a raw XPath (starts with '/') or a bare class-name substring.
# The latter avoids PowerShell treating '@class' as a splat operator.
if selector.startswith("/"):
    xpath = selector
else:
    xpath = f"//*[contains(@class,'{selector}')]"

root = html.parse(path).getroot()
items = root.xpath(xpath)
print(f"matched {len(items)} nodes for {selector!r}  (xpath={xpath})")
if items:
    print("tags:", [(e.tag, e.get("class")) for e in items[:4]])
print()
for i, el in enumerate(items[:limit]):
    text = (el.text_content() or "").strip()
    text = "\n".join(l.strip() for l in text.splitlines() if l.strip())
    print(f"--- item {i} ---")
    print(text[:400])
    print()
