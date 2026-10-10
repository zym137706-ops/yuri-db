#!/usr/bin/env python3
"""Feasibility probe: cover images + Chinese titles per work."""
import io
import re
import sys

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

s = requests.Session()
s.headers["User-Agent"] = "YuriDBBot/0.1 (+https://example.org)"

print("--- 1) 東立 list page: cover img srcs ---")
r = s.get("https://www.tongli.com.tw/ThemeGL.aspx?page=1&s=1", timeout=30)
imgs = re.findall(r'<div class="pk_img"><a href="([^"]+)"><img src="([^"]+)"', r.text)
print("  cover pairs:", len(imgs))
for a, b in imgs[:3]:
    print("   ", a[:40], "|", b)

print("\n--- 2) 東立 detail page: cover / og:image ---")
r2 = s.get("https://www.tongli.com.tw/BooksDetail.aspx?Bd=BM0317009", timeout=30)
for pat in (r'<img[^>]+src="([^"]*ComicImages[^"]+)"', r'og:image"\s+content="([^"]+)"'):
    print("  ", pat[:34], "->", re.findall(pat, r2.text)[:3])

print("\n--- 3) openBD cover for a known Japanese ISBN ---")
r3 = s.get("https://api.openbd.jp/v1/get", params={"isbn": "9784825102033"}, timeout=40)
d = r3.json()
print("  http", r3.status_code, "| null entry?", d[0] is None)
if d and d[0]:
    sm = d[0].get("summary") or {}
    print("  cover:", sm.get("cover"))
    print("  title:", sm.get("title"), "| series:", sm.get("series"), "| pub:", sm.get("publisher"))

print("\n--- 4) cppinfo (simplified-Chinese official catalogue) search feasibility ---")
for url, params in (
    ("https://book.cppinfo.cn/Encyclopedias/home/index2", {"isbn": "9787559469337"}),
    ("https://book.cppinfo.cn/QHSearch", {"q": "百合"}),
):
    try:
        rr = s.get(url, params=params, timeout=25)
        txt = re.sub(r"<[^>]+>", " ", rr.text)
        txt = re.sub(r"\s+", " ", txt)
        print(f"  {url} -> {rr.status_code} len={len(rr.text)}  text[:120]={txt[:120]!r}")
    except Exception as exc:
        print(f"  {url} -> ERR {type(exc).__name__}: {str(exc)[:90]}")

print("\n--- 5) 台灣角川 百合館: product handles ---")
try:
    rr = s.get("https://www.kadokawa.com.tw/zh-hant/pages/girlslove", timeout=30)
    handles = re.findall(r"/zh-hant/products/([0-9]{13})", rr.text)
    print("  status", rr.status_code, "| ISBN-like handles:", len(set(handles)), sorted(set(handles))[:5])
except Exception as exc:
    print("  ERR", type(exc).__name__, str(exc)[:90])
