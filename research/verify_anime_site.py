#!/usr/bin/env python3
"""Lead's independent live check of the /anime section."""
import io
import re
import sys

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

B = "http://127.0.0.1:3114"
s = requests.Session()
s.headers["User-Agent"] = "Mozilla/5.0"

cases = [
    ("/anime", ["開播", "製作公司", "主要聲優", "改編", "劇場版", "原創", "已宣布", "Doga Kobo", "大坪由佳"]),
    ("/anime/yuru-yuri", ["歳納京子", "大坪由佳", "2011-07-05", "Doga Kobo", "third_party", "third-party", "未收錄"]),
    ("/anime?adaptation=original&format=tv", ["original", "tv"]),
    ("/anime?status=announced", ["announced", "2027"]),
    ("/anime?format=movie", ["movie"]),
    ("/anime?adaptation=manga&format=tv&year=2027", ["2027"]),
    ("/", ["百合動畫"]),
]
for path, needles in cases:
    r = s.get(B + path, timeout=40)
    h = r.text
    hits = {n: (n in h) for n in needles}
    print(f"== {path}  HTTP {r.status_code}  bytes={len(h)}")
    for n, ok in hits.items():
        print(f"     {'[+]' if ok else '[ ]'} {n}")
    if "搜尋結果" in h:
        m = re.search(r"搜尋結果[^0-9]{0,20}([0-9,]+)\s*/\s*([0-9,]+)", h)
        if m:
            print(f"     搜尋結果: {m.group(1)} / {m.group(2)}")
    print()

r = s.get(B + "/anime/does-not-exist-xyz", timeout=30)
print("unknown slug ->", r.status_code)
