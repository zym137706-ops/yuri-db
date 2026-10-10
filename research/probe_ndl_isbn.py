#!/usr/bin/env python3
"""Inspect NDL identifiers/seriesTitle for one LN to fix cleaning + ISBN."""
import io
import re
import sys
import xml.etree.ElementTree as ET

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

s = requests.Session()
s.headers["User-Agent"] = "YuriDBBot/0.1 (+https://example.org)"
r = s.get("https://ndlsearch.ndl.go.jp/api/opensearch",
          params={"title": "わたしの百合も、営業だと思った？", "cnt": 5, "idx": 1}, timeout=45)
print("HTTP", r.status_code, "bytes", len(r.text))
root = ET.fromstring(r.text.encode("utf-8", "replace"))

for item in root.iter():
    if item.tag.rsplit("}", 1)[-1] != "item":
        continue
    title = ""
    for el in item.iter():
        ln = el.tag.rsplit("}", 1)[-1]
        txt = (el.text or "").strip()
        if not txt:
            continue
        if ln in ("title", "dc:title") or ln == "title":
            title = txt
            break
    print("\n=== item:", title[:60])
    for el in item.iter():
        ln = el.tag.rsplit("}", 1)[-1]
        txt = (el.text or "").strip()
        if not txt:
            continue
        if ln in ("identifier", "isbn", "seriesTitle", "seriesTitleTranscription",
                  "publisher", "date", "issued", "category", "extent", "price"):
            print(f"    {ln:26} = {txt[:90]}")
    break

print("\n--- raw chunk with isbn/identifier ---")
for m in re.finditer(r"<[^>]*(?:isbn|identifier)[^>]*>[^<]*<", r.text, re.I):
    print("   ", m.group(0)[:140])
