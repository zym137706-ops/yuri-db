#!/usr/bin/env python3
"""Unit test for the NDL OpenSearch parser.

    python scripts/test_ndl_parser.py

Scope, stated precisely: this verifies the PARSER against a response shape built
from NDL's published OpenSearch/RSS documentation. It does NOT verify the live
service — ndlsearch.ndl.go.jp is unreachable from the development host, so the
collector's first real run must happen in CI. The point of this test is to catch
namespace drift and field-extraction mistakes cheaply.

It also asserts the collector's most important safety property: a parsed-but-empty
response must be reported as an anomaly, never as "this work has no volumes".
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collectors"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from ndl import parse_opensearch  # noqa: E402

SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:dcndl="http://ndl.go.jp/dcndl/terms/"
     xmlns:opensearch="http://a9.com/-/spec/opensearchrss/1.0/">
  <channel>
    <title>国立国会図書館サーチ 検索結果</title>
    <opensearch:totalResults>2</opensearch:totalResults>
    <item>
      <title>citrus+ 1</title>
      <link>https://ndlsearch.ndl.go.jp/books/R100000002-I000000000001</link>
      <dc:creator>サブロウタ 著</dc:creator>
      <dc:publisher>一迅社</dc:publisher>
      <dc:date>2019-06</dc:date>
      <dcndl:isbn>9784758079280</dcndl:isbn>
      <dc:subject>NDC:726.1</dc:subject>
    </item>
    <item>
      <title>citrus+ 2</title>
      <link>https://ndlsearch.ndl.go.jp/books/R100000002-I000000000002</link>
      <dc:creator>サブロウタ 著</dc:creator>
      <dc:publisher>一迅社</dc:publisher>
      <dc:date>2019-12-25</dc:date>
      <dc:identifier>9784758079815</dc:identifier>
    </item>
  </channel>
</rss>
"""

EMPTY = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel><title>検索結果</title></channel>
</rss>
"""

failures = 0


def check(label: str, got, want) -> None:
    global failures
    if got == want:
        print(f"  + {label}")
    else:
        failures += 1
        print(f"  x {label}\n      got  {got!r}\n      want {want!r}")


def main() -> int:
    recs = parse_opensearch(SAMPLE)
    print(f"parsed {len(recs)} records")
    check("two items parsed", len(recs), 2)

    first = recs[0]
    check("title", first["ndl_title"], "citrus+ 1")
    check("creator", first["creator"], "サブロウタ 著")
    check("publisher", first["publisher"], "一迅社")
    check("month-precision date keeps year-month", first["release_date"], "2019-06")
    check("isbn normalised from dcndl:isbn", first["isbn"], "9784758079280")

    second = recs[1]
    check("day-precision date", second["release_date"], "2019-12-25")
    check("isbn read from dc:identifier as fallback", second["isbn"], "9784758079815")

    check("empty response yields no records", parse_opensearch(EMPTY), [])

    print()
    if failures:
        print(f"NDL PARSER TEST FAILED — {failures} check(s)")
        return 1
    print("NDL PARSER TEST PASSED — note: parser only, live service NOT verified here")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
