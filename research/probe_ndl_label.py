#!/usr/bin/env python3
"""Probe: does NDL give us the 文庫 (label) / 叢書名 for light novels?"""
import io
import sys
from collections import Counter
from pathlib import Path

import requests

# 相对本文件解析，而不是写死本机路径（写死会在其它机器上直接 ImportError）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collectors"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from ndl import parse_opensearch  # noqa: E402

s = requests.Session()
s.headers["User-Agent"] = "YuriDBBot/0.1 (+https://example.org)"

for title in ("私の推しは悪役令嬢。", "わたしが恋人になれるわけじゃないんだが"):
    r = s.get("https://ndlsearch.ndl.go.jp/api/opensearch",
              params={"title": title, "cnt": 20, "idx": 1}, timeout=45)
    print(f"=== {title}  HTTP {r.status_code} bytes={len(r.text)}")
    if r.status_code != 200:
        print("   ", r.text[:200])
        continue
    recs = parse_opensearch(r.text)
    print("    records:", len(recs))
    # dump every element local-name so we can see what NDL actually exposes
    import xml.etree.ElementTree as ET
    keys = Counter()
    root = ET.fromstring(r.text.encode("utf-8", "replace"))
    for el in root.iter():
        if (el.text or "").strip():
            keys[el.tag.rsplit("}", 1)[-1]] += 1
    print("    element names:", dict(keys.most_common(20)))
    for rec in recs[:4]:
        print(f"      - {rec['ndl_title'][:44]:46} pub={rec['publisher']} date={rec['date_raw']} isbn={rec['isbn']}")
    # print raw sample so series/label fields are visible
    i = r.text.find("<item")
    print("    RAW SAMPLE:", r.text[i:i + 900].replace("\n", " ")[:900])
    print()
