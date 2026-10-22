#!/usr/bin/env python3
"""清掉 data/ndl_enrichment.json 里「书名与作品标题不一致」的错误补全。

    python research/clean_ndl_enrichment.py

背景：enrich_works_from_ndl.py 原先对 NDL 结果做**前缀匹配**，于是把漫画版、
分冊版、アンソロジー、甚至完全无关的作品当成了这本书。修复后的匹配器只接受
精确标题，但已经落盘的那 162 条里仍有 15 条是错的。

这些错误记录会把**漫画的レーベル / ISBN / 发售日**写进轻小说记录
（例如《安達としまむら》拿到 電撃コミックスNEXT 的 9784049525045）。

本脚本：
  1. 丢弃 title_ja 与 ndl_title 规范化后不相等的记录；
  2. 同时把对应的 `runs` 条目也移除，这样 `--only-missing` 会在下次运行时
     重新查询它们（用修好的精确匹配器）。
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collectors"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from normalize import norm_title  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "data" / "ndl_enrichment.json"


def main() -> int:
    doc = json.loads(PATH.read_text(encoding="utf-8"))
    records = doc.get("records") or []

    kept, dropped = [], []
    for r in records:
        q = norm_title(r.get("title_ja") or "")
        n = norm_title(r.get("ndl_title") or "")
        if q and n and q == n:
            kept.append(r)
        else:
            dropped.append(r)

    dropped_titles = {r.get("title_ja") for r in dropped}

    # 让被丢弃的标题在下次运行时重新查询
    last = doc.get("last_run") or {}
    runs = last.get("runs") or []
    kept_runs = [r for r in runs if r.get("title") not in dropped_titles]

    doc["records"] = kept
    doc["dropped_mismatched"] = len(dropped)
    doc["clean_note"] = (
        "已移除 ndl_title 与 title_ja 不一致的记录（前缀匹配时代的误配）；"
        "对应 runs 也已移除，下次 --only-missing 会重新查询。"
    )
    doc["last_run"] = {**last, "runs": kept_runs}
    for k in ("total", "by_media_type", "with_publisher", "with_label", "with_isbn"):
        if k in doc:
            doc.pop(k)
    doc["total"] = len(kept)
    doc["with_publisher"] = sum(1 for r in kept if r.get("publisher_ja"))
    doc["with_label"] = sum(1 for r in kept if r.get("label"))
    doc["with_isbn"] = sum(1 for r in kept if r.get("isbn"))

    PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"ndl_enrichment.json: {len(records)} -> {len(kept)} 条（移除 {len(dropped)} 条误配）")
    print(f"  runs 保留 {len(kept_runs)} / {len(runs)}（被移除的标题下次会重新查询）")
    for r in dropped[:12]:
        print(f"    移除: {str(r.get('title_ja'))[:26]:28} -> {str(r.get('ndl_title'))[:34]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
