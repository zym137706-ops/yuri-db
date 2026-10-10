#!/usr/bin/env python3
"""Add the cover / title-status fields to web/lib/schema-fields.json.

The web contract test proves this file is a bijection with the JSON Schema's
`properties`, so new schema fields MUST be registered here or the UI would
silently stop rendering them.
"""
import io
import json
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
P = ROOT / "web" / "lib" / "schema-fields.json"
d = json.loads(P.read_text(encoding="utf-8"))

NEW_AFTER_TITLE_ZH_TW = {"name": "title_zh_tw_status", "label": "繁中標題狀態",
                         "group": "identity", "kind": "enum"}
NEW_AFTER_TITLE_ZH_CN = {"name": "title_zh_cn_status", "label": "簡中標題狀態",
                         "group": "identity", "kind": "enum"}
COVER_FIELDS = [
    {"name": "cover_url", "label": "封面圖 URL", "group": "identity", "kind": "url"},
    {"name": "cover_source_url", "label": "封面出處頁", "group": "provenance", "kind": "url"},
    {"name": "cover_region", "label": "封面版本", "group": "identity", "kind": "enum"},
    {"name": "cover_display_allowed", "label": "允許嵌入封面", "group": "provenance", "kind": "boolean"},
    {"name": "cover_note", "label": "封面授權備註", "group": "provenance", "kind": "string"},
]

fields = d["workFields"]
existing = {f["name"] for f in fields}
out = []
for f in fields:
    out.append(f)
    if f["name"] == "title_zh_tw":
        out.append(NEW_AFTER_TITLE_ZH_TW)
    if f["name"] == "title_zh_cn":
        out.append(NEW_AFTER_TITLE_ZH_CN)
    if f["name"] == "title_en":
        out.extend(COVER_FIELDS)
d["workFields"] = out

# volume rows gained cover_url
for key in ("ja_volumes", "zh_tw_volumes", "zh_cn_volumes"):
    rows = d["nested"].get(key) or []
    if not any(r["name"] == "cover_url" for r in rows):
        rows.append({"name": "cover_url", "label": "封面 URL", "kind": "url"})
        d["nested"][key] = rows

added = [f["name"] for f in d["workFields"] if f["name"] not in existing]
print("added work fields:", added)
print("workFields now:", len(d["workFields"]))
P.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("written", P)
