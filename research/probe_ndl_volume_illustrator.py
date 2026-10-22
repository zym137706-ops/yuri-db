#!/usr/bin/env python3
"""Probe: NDL 是否给出「逐卷」的插画师？以及区分 LN / 漫画的关键字段。

两个问题：
  1. 安達としまむら 不同卷的插画师不同（逢坂望美 / Raemz 等），
     NDL 的 creator 字段能否给出每卷的イラストレーター？
  2. 我们现在的匹配器把「安達としまむら（９）」这个**漫画**卷当成了轻小说本体。
     哪一列可以用来区分 LN 与漫画？
"""
from __future__ import annotations

import io
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collectors"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import requests  # noqa: E402

from base import USER_AGENT  # noqa: E402

s = requests.Session()
s.headers["User-Agent"] = USER_AGENT

TITLE = "安達としまむら"

r = s.get(
    "https://ndlsearch.ndl.go.jp/api/opensearch",
    params={"title": TITLE, "cnt": 40, "idx": 1},
    timeout=60,
)
print("HTTP", r.status_code, "bytes", len(r.text))

root = ET.fromstring(r.text.encode("utf-8", "replace"))


def txt(el, name):
    for c in el:
        if c.tag.rsplit("}", 1)[-1] == name and (c.text or "").strip():
            return c.text.strip()
    return None


def all_txt(el, name):
    out = []
    for c in el:
        if c.tag.rsplit("}", 1)[-1] == name and (c.text or "").strip():
            out.append(c.text.strip())
    return out


print("\n=== 每条书志的关键字段（看 creator / seriesTitle / category）===")
n = 0
for item in root.iter():
    if item.tag.rsplit("}", 1)[-1] != "item":
        continue
    title = txt(item, "title")
    if not title or TITLE not in title:
        continue
    n += 1
    print(f"\n[{n}] {title}")
    print(f"    creators   : {all_txt(item, 'creator')}")
    print(f"    publisher  : {txt(item, 'publisher')}")
    print(f"    seriesTitle: {txt(item, 'seriesTitle')}")
    print(f"    category   : {all_txt(item, 'category')}")
    print(f"    isbn       : {txt(item, 'isbn') or txt(item, 'identifier')}")
    print(f"    date       : {txt(item, 'date')}")
    if n >= 12:
        break
