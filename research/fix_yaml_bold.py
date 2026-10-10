#!/usr/bin/env python3
"""Quote YAML values that begin with '*' (Markdown bold) so they are not parsed
as aliases. Block-scalar content is left untouched.

Usage: python fix_yaml_bold.py <file.yaml> [--write]
"""
import io
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BLOCK_START = re.compile(r":\s*[|>][-+]?\d*\s*$")
SEQ_BOLD = re.compile(r'^(\s*-\s+)(\*\*.*?)\s*$')
MAP_BOLD = re.compile(r'^(\s*[A-Za-z_][A-Za-z0-9_]*:\s+)(\*\*.*?)\s*$')


def main() -> int:
    path = sys.argv[1]
    write = "--write" in sys.argv
    lines = open(path, encoding="utf-8").read().split("\n")

    out = []
    block_indent = None      # indentation of the key that opened a block scalar
    fixed = []

    for idx, line in enumerate(lines, start=1):
        stripped = line.strip()
        indent = len(line) - len(line.lstrip())

        if block_indent is not None:
            # inside a block scalar: content is any non-empty line indented deeper
            if stripped == "" or indent > block_indent:
                out.append(line)
                continue
            block_indent = None  # dedent ends the block scalar

        if stripped and not stripped.startswith("#") and BLOCK_START.search(line):
            block_indent = indent
            out.append(line)
            continue

        m = SEQ_BOLD.match(line) or MAP_BOLD.match(line)
        if m:
            prefix, value = m.group(1), m.group(2)
            quoted = '"' + value.replace('"', '\\"') + '"'
            out.append(prefix + quoted)
            fixed.append((idx, line, prefix + quoted))
        else:
            out.append(line)

    print(f"lines: {len(lines)}  fixed: {len(fixed)}")
    for idx, before, after in fixed:
        print(f"  L{idx}: {before.strip()[:80]}")
        print(f"     -> {after.strip()[:80]}")

    if write:
        open(path, "w", encoding="utf-8").write("\n".join(out))
        print("written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
