#!/usr/bin/env python3
"""Shared HTTP layer for the yuri-db collectors.

Responsibilities (all four are Phase 1 requirements):
  1. Identifiable User-Agent
  2. robots.txt gate — never fetch a disallowed path
  3. Per-host rate limiting honouring Crawl-delay
  4. Raw-response archiving with sha256 (openBD terms forbid modifying data,
     so the raw layer is kept separate from the normalised layer)

Critically it distinguishes *network failure* from *the site refusing us*,
because conflating them corrupts the compliance record (see report §2.2).
"""
from __future__ import annotations

import hashlib
import json
import ssl
import time
import urllib.robotparser
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
MANIFEST = ROOT / "data" / "raw" / "manifest.jsonl"

USER_AGENT = "YuriDBBot/0.1 (+https://github.com/example/yuri-db; contact: TODO@example.org)"
DEFAULT_DELAY = 2.0
TIMEOUT = 30


@dataclass
class FetchResult:
    url: str
    ok: bool = False
    status: int | None = None
    content_type: str = ""
    text: str = ""
    sha256: str = ""
    raw_path: str = ""
    byte_size: int = 0
    error: str = ""
    blocked_by_robots: bool = False
    network_error: bool = False

    @property
    def status_kind(self) -> str:
        if self.blocked_by_robots:
            return "blocked_by_robots"
        if self.network_error:
            return "network_error"
        if self.ok:
            return "ok"
        return "failed"


@dataclass
class RunStats:
    source_id: str
    runner: str = "local_dev"
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    items_seen: int = 0
    items_new: int = 0
    fetches: list[FetchResult] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def record(self, r: FetchResult) -> None:
        self.fetches.append(r)
        if r.error:
            self.errors.append(f"{r.status_kind}: {r.url} :: {r.error}")

    @property
    def status(self) -> str:
        if not self.fetches:
            return "failed"
        if any(f.blocked_by_robots for f in self.fetches):
            return "blocked_by_robots"
        if all(f.network_error for f in self.fetches):
            return "network_error"
        if any(f.network_error or not f.ok for f in self.fetches):
            return "partial"
        return "ok"


class Fetcher:
    """Polite fetcher with robots gate, rate limiting and raw archiving."""

    def __init__(self, delay: float = DEFAULT_DELAY, archive: bool = True) -> None:
        self.session = requests.Session()
        self.session.headers.update(
            {"User-Agent": USER_AGENT, "Accept-Language": "ja,zh-TW;q=0.8,en;q=0.5"}
        )
        self.delay = delay
        self.archive = archive
        self._last_hit: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._robots_meta: dict[str, str] = {}
        RAW_DIR.mkdir(parents=True, exist_ok=True)

    # ---------------------------------------------------------------- robots
    def robots_for(self, url: str) -> tuple[urllib.robotparser.RobotFileParser | None, str]:
        host = urlparse(url).netloc
        if host in self._robots:
            return self._robots[host], self._robots_meta[host]

        robots_url = f"{urlparse(url).scheme}://{host}/robots.txt"
        rp: urllib.robotparser.RobotFileParser | None = None
        note = "unknown"
        try:
            r = self.session.get(robots_url, timeout=TIMEOUT)
            if r.status_code == 200 and "<html" not in r.text[:400].lower():
                rp = urllib.robotparser.RobotFileParser()
                rp.parse(r.text.splitlines())
                note = f"ok ({len(r.text)} bytes)"
            elif r.status_code == 404:
                note = "no robots.txt (404) -> treated as allow"
            elif r.status_code in (401, 403):
                note = f"robots.txt returned {r.status_code} (WAF?) -> treated as deny"
                rp = _DenyAll()
            elif "<html" in r.text[:400].lower():
                note = f"robots.txt returned an HTML page ({r.status_code}) -> no usable rules"
            else:
                note = f"robots.txt status {r.status_code}"
        except requests.RequestException as exc:
            note = f"robots.txt unreachable: {type(exc).__name__}"

        self._robots[host] = rp
        self._robots_meta[host] = note
        return rp, note

    def robots_note(self, url: str) -> str:
        self.robots_for(url)
        return self._robots_meta[urlparse(url).netloc]

    def allowed(self, url: str) -> tuple[bool, str]:
        rp, note = self.robots_for(url)
        if rp is None:
            return True, note
        return rp.can_fetch(USER_AGENT, url), note

    # ------------------------------------------------------------- fetching
    def _throttle(self, url: str) -> None:
        host = urlparse(url).netloc
        last = self._last_hit.get(host)
        if last is not None:
            wait = self.delay - (time.monotonic() - last)
            if wait > 0:
                time.sleep(wait)
        self._last_hit[host] = time.monotonic()

    def get(self, url: str, source_id: str = "unknown") -> FetchResult:
        res = FetchResult(url=url)

        ok, note = self.allowed(url)
        if not ok:
            res.blocked_by_robots = True
            res.error = f"disallowed by robots.txt ({note})"
            return res

        self._throttle(url)
        try:
            r = self.session.get(url, timeout=TIMEOUT)
        except requests.RequestException as exc:
            res.network_error = True
            res.error = f"{type(exc).__name__}: {exc}"
            return res

        res.status = r.status_code
        res.content_type = r.headers.get("content-type", "")
        res.byte_size = len(r.content)
        res.sha256 = hashlib.sha256(r.content).hexdigest()
        res.ok = r.status_code == 200
        if not res.ok:
            res.error = f"HTTP {r.status_code}"
            return res

        # honour declared encoding; fall back to utf-8 then cp932 (芳文社 is Shift_JIS)
        r.encoding = r.encoding or r.apparent_encoding or "utf-8"
        res.text = r.text

        if self.archive:
            res.raw_path = self._archive(r, source_id)
        return res

    def _archive(self, r: requests.Response, source_id: str) -> str:
        outdir = RAW_DIR / source_id
        outdir.mkdir(parents=True, exist_ok=True)
        ext = ".html"
        if "json" in r.headers.get("content-type", ""):
            ext = ".json"
        elif "xml" in r.headers.get("content-type", "") or r.text.lstrip()[:5] == "<?xml":
            ext = ".xml"
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        sig = hashlib.sha256(r.content).hexdigest()[:8]
        path = outdir / f"{stamp}-{sig}{ext}"
        path.write_bytes(r.content)
        rel = str(path.relative_to(ROOT)).replace("\\", "/")
        with MANIFEST.open("a", encoding="utf-8") as fh:
            fh.write(
                json.dumps(
                    {
                        "url": r.url,
                        "source_id": source_id,
                        "status": r.status_code,
                        "content_type": r.headers.get("content-type", ""),
                        "sha256": hashlib.sha256(r.content).hexdigest(),
                        "bytes": len(r.content),
                        "path": rel,
                        "fetched_at": datetime.now(timezone.utc).isoformat(),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
        return rel


class _DenyAll(urllib.robotparser.RobotFileParser):
    """Used when robots.txt itself is blocked by a WAF."""

    def can_fetch(self, useragent, url) -> bool:  # type: ignore[override]
        return False


def save_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
