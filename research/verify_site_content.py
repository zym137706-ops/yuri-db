#!/usr/bin/env python3
"""Verify the running site actually renders covers and all three titles."""
import io
import re
import sys

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:3112"
s = requests.Session()
s.headers["User-Agent"] = "Mozilla/5.0"

NEEDLES = [
    "日文原名", "繁體中文譯名", "簡體中文譯名",
    "封面", "暫無封面", "尚未查證", "官方譯名", "目前無官方版本",
    "已收錄", "不允許嵌入",
]

pages = ["/", "/works/w-0700dda8c0", "/works/citrus-plus", "/data-quality"]
for path in pages:
    r = s.get(BASE + path, timeout=25)
    h = r.text
    print(f"== {path}  HTTP {r.status_code}  bytes={len(h)}")
    for k in NEEDLES:
        if k in h:
            print(f"    [+] {k}")
    imgs = re.findall(r'<img[^>]+src="([^"]+)"', h)
    covers = [u for u in imgs if "ComicImages" in u or "shopline" in u or u.startswith("http")]
    print(f"    img tags: {len(imgs)}  (external {len(covers)})")
    for u in covers[:3]:
        print("       ", u[:88])
    # per-work title block on a detail page
    if path.startswith("/works/"):
        for label in ("日文原名", "繁體中文譯名", "簡體中文譯名"):
            m = re.search(label + r"</div><div[^>]*>([^<]{0,60})", h)
            print(f"    {label} -> {m.group(1) if m else 'NOT FOUND'}")
    print()
