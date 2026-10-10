#!/usr/bin/env python3
"""One-off structural inspection of a saved HTML page (development helper)."""
import io
import sys
from pathlib import Path

from lxml import html

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("research/raw/yurihime.html")
needle = sys.argv[2] if len(sys.argv) > 2 else "/yurihime/title/"

doc = html.parse(str(path))
root = doc.getroot()

links = root.xpath(f'//a[contains(@href,"{needle}")]')
print(f"anchors containing {needle!r}: {len(links)}")
for a in links[:8]:
    print(f"  href={a.get('href')!r} text={(a.text_content() or '').strip()[:50]!r}")

if links:
    print("\nancestor chain of first match:")
    node = links[0]
    for _ in range(4):
        node = node.getparent()
        if node is None:
            break
        print(f"  <{node.tag}> class={node.get('class')!r} children={len(node)}")

print("\nsection-ish containers:")
for cls in ("title", "works", "comic", "list", "post", "entry", "item", "news", "hon", "book"):
    els = root.xpath(f'//*[contains(@class,"{cls}")]')
    if els:
        print(f"  class~{cls}: {len(els)}  e.g. {[e.get('class') for e in els[:3]]}")
