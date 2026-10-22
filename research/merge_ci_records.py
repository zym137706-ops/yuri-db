#!/usr/bin/env python3
"""把 CI 期间抓取的记录并回本地（按稳定键求并集，不覆盖）。

    python research/merge_ci_records.py

背景：2026-10-22 的数据塌缩事故里，`data/` 被整体回滚到 10-10 的已验证状态。
结果表明**原始网页档案并没有丢**（`git checkout` 不删除新增文件），但两个配套
文件确实落后了：

  data/raw/manifest.jsonl   99 条 -> CI 有 118 条（超集，直接取 CI 的）
  data/raw_records.json     88 条 -> CI 41 条（丢了 48 条東立，但多了 1 条百合姫）

第二个既不是超集也不是子集，所以必须按稳定键求**并集**，简单地"取新的一份"
会丢掉東立（繁中标题就是从这来的），取旧的一份会丢掉新抓的百合姫。

run_stats.json 刻意不合并：它是**快照**而不是历史日志（10-10 那份是完整的 28 个
源，CI 那份只有 news 任务的 3 个源），合并会得到一个语义上不存在的混合快照。
"""
from __future__ import annotations

import io
import json
import subprocess
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

OURS = "3a2716b"      # 10-10 的已验证状态
CI = "18659b4"        # CI 最后一次提交（塌缩之后）


def git_show(ref: str, path: str) -> bytes:
    r = subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True, cwd=ROOT)
    if r.returncode != 0:
        raise SystemExit(f"git show {ref}:{path} failed: {r.stderr.decode(errors='replace')}")
    return r.stdout


def record_key(rec: dict) -> str:
    """整条记录的内容指纹（去掉每次抓取都会变的 retrieved_at）。

    这里刻意**不用 work_url / source_url 当键**。第一次尝试就是这么写的，
    结果 88 条被压缩成 59 条 —— 因为同一期杂志的多部作品共享同一个页面 URL，
    東立的中国部作品也是按列表页抓的。用 URL 当键 = 把不同作品合并成一条，
    直接导致繁中标题从 15 部掉到 1 部。

    内容指纹则只合并"完全相同的记录"，不可能误伤。
    """
    stripped = {k: v for k, v in rec.items() if k != "retrieved_at"}
    return json.dumps(stripped, sort_keys=True, ensure_ascii=False)


def merge_records() -> None:
    ours_doc = json.loads(git_show(OURS, "data/raw_records.json").decode("utf-8"))
    ci_doc = json.loads(git_show(CI, "data/raw_records.json").decode("utf-8"))

    ours = ours_doc.get("records") or []
    ci = ci_doc.get("records") or []

    merged: dict[str, dict] = {}
    for rec in ours:
        merged[record_key(rec)] = rec
    added: list[dict] = []
    for rec in ci:
        k = record_key(rec)
        if k not in merged:
            merged[k] = rec
            added.append(rec)

    out = dict(ours_doc)          # 保留 generated_at / runner 原样
    out["records"] = list(merged.values())

    # 按 collectors/run.py 的约定重算 counts：
    #   total_records = 不含 tongli_details（原逻辑就是 all_records，
    #   而 records = all_records + details，所以 64 + 24 = 88 是自洽的）。
    # 不重算的话报告里的来源统计会停留在合并前的数字。
    by_kind: dict[str, int] = {}
    by_source: dict[str, int] = {}
    for rec in out["records"]:
        by_kind[rec.get("kind") or "?"] = by_kind.get(rec.get("kind") or "?", 0) + 1
        by_source[rec.get("source_id") or "?"] = by_source.get(rec.get("source_id") or "?", 0) + 1
    out["counts"] = {
        "yurihime": by_source.get("ja_yurihime", 0),
        "galette": by_source.get("ja_galette", 0),
        "tongli_list": by_kind.get("zh_tw_volume", 0),
        "tongli_details": by_kind.get("zh_tw_volume_detail", 0),
        "total_records": len(out["records"]) - by_kind.get("zh_tw_volume_detail", 0),
    }
    out["merge_note"] = (
        f"merged CI records on top of {OURS}: "
        f"{len(ours)} existing + {len(added)} new from CI = {len(out['records'])}"
    )
    (DATA / "raw_records.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"raw_records.json: {len(ours)} (10-10) + {len(added)} new from CI = {len(out['records'])}")
    from collections import Counter

    print("  by source:", dict(Counter(r.get("source_id") or "?" for r in out["records"])))
    print("  by issue :", dict(Counter(
        (r.get("issue_title") or r.get("kind") or "?") for r in out["records"]
    )))


def merge_manifest() -> None:
    ours = [l for l in git_show(OURS, "data/raw/manifest.jsonl").decode("utf-8").splitlines() if l.strip()]
    ci = [l for l in git_show(CI, "data/raw/manifest.jsonl").decode("utf-8").splitlines() if l.strip()]

    seen = set(ours)
    merged = list(ours)
    added = 0
    for line in ci:
        if line not in seen:
            seen.add(line)
            merged.append(line)
            added += 1

    (DATA / "raw" / "manifest.jsonl").write_text("\n".join(merged) + "\n", encoding="utf-8")
    print(f"manifest.jsonl: {len(ours)} (10-10) + {added} new from CI = {len(merged)}")


if __name__ == "__main__":
    merge_records()
    merge_manifest()
