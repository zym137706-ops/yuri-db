#!/usr/bin/env python3
"""Probe 2: openBD hit rate, cppinfo retry, 台灣角川 product detail."""
import io
import json
import re
import sys
from pathlib import Path

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
s = requests.Session()
s.headers["User-Agent"] = "YuriDBBot/0.1 (+https://example.org)"

works = json.loads((ROOT / "data" / "works.json").read_text(encoding="utf-8"))["works"]
isbns = sorted({v["isbn"] for w in works for v in w["ja_volumes"] if v.get("isbn")})
print(f"--- openBD hit rate over our {len(isbns)} Japanese ISBNs ---")
for isbn in isbns:
    try:
        r = s.get("https://api.openbd.jp/v1/get", params={"isbn": isbn}, timeout=40)
        d = r.json()
        rec = d[0] if d else None
        sm = (rec or {}).get("summary") or {}
        print(f"  {isbn} http={r.status_code} hit={rec is not None} "
              f"cover={'YES' if sm.get('cover') else 'no'} title={sm.get('title')}")
    except Exception as exc:
        print(f"  {isbn} ERR {type(exc).__name__}: {str(exc)[:60]}")

print("\n--- cppinfo retry (longer timeout, http/https) ---")
for url in (
    "https://book.cppinfo.cn/Encyclopedias/home/index2?isbn=9787559469337",
    "http://book.cppinfo.cn/Encyclopedias/home/index2?isbn=9787559469337",
    "https://book.cppinfo.cn/",
):
    try:
        r = s.get(url, timeout=60, allow_redirects=True)
        txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", r.text))
        print(f"  {url[:64]} -> {r.status_code} len={len(r.text)} {txt[:100]!r}")
    except Exception as exc:
        print(f"  {url[:64]} -> ERR {type(exc).__name__}: {str(exc)[:70]}")

print("\n--- 台灣角川 product page: does it expose title / ISBN / cover? ---")
for handle in ("9786264356503", "4711289618003"):
    try:
        r = s.get(f"https://www.kadokawa.com.tw/zh-hant/products/{handle}", timeout=30)
        title = re.search(r"<title>(.*?)</title>", r.text)
        ogimg = re.search(r'property="og:image"\s+content="([^"]+)"', r.text)
        price = re.findall(r'"price"\s*:\s*"?([0-9]+)', r.text)[:2]
        print(f"  {handle} http={r.status_code} title={title.group(1)[:52] if title else None!r}")
        print(f"      og:image={ogimg.group(1)[:80] if ogimg else None} price={price}")
    except Exception as exc:
        print(f"  {handle} ERR {type(exc).__name__}: {str(exc)[:70]}")
