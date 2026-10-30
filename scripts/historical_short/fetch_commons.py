#!/usr/bin/env python3
"""Search and fetch still images from Wikimedia Commons with a licence gate.

Part of the historical-short workflow
(skills/pipelines/documentary-montage/historical-short.md).

Every fetched file gets a provenance record (title, page URL, author, licence,
licence URL, credit line, description, date) read from the Commons
``extmetadata`` API — never typed in by hand. Files whose licence does not
permit commercial reuse (NC / ND / fair use / unknown) are refused.

Usage:
    # list candidates (no download)
    python scripts/historical_short/fetch_commons.py search "Cannae battlefield" --limit 15

    # cache metadata for several files in one API request (then fetch needs no API call)
    python scripts/historical_short/fetch_commons.py prefetch "File:A.jpg" "File:B.jpg"

    # inspect one file's licence/metadata (no download)
    python scripts/historical_short/fetch_commons.py info "File:Example.jpg"

    # download one file into the episode's image folder + provenance JSON
    python scripts/historical_short/fetch_commons.py fetch "File:Example.jpg" \
        --id s02_bust --out projects/<episode>/assets/images
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
from pathlib import Path

import requests

API = "https://commons.wikimedia.org/w/api.php"
# Wikimedia requires a descriptive User-Agent; anonymous requests get HTTP 429.
USER_AGENT = "OpenMontage-HistoricalShort/1.0 (https://github.com/calesthio/OpenMontage)"
# Wikimedia serves thumbnails only at standard widths (https://w.wiki/GHai) and
# throttles scripted downloads of full-size originals hard, so always request
# the largest standard width that does not upscale the original.
# 1920 covers a 1080-wide frame with headroom; 3840 thumbnails are throttled
# harder and are only requested with --max-width 3840.
STANDARD_WIDTHS = (3840, 1920, 1280, 960)
MAX_WIDTH = 1920

# Licences that allow commercial reuse (attribution / share-alike obligations
# are recorded and must be honoured in CREDITS.txt).
_ALLOWED = [
    r"^public domain$",
    r"^pd\b",
    r"^cc0",
    r"^cc by(-sa)? \d",
    r"^cc by(-sa)?$",
    r"^cc-by(-sa)?-\d",
    r"^attribution$",
    r"^no restrictions$",
]
_DENIED = [r"\bnc\b", r"\bnd\b", r"non-?commercial", r"no-?deriv", r"fair use", r"non-?free"]


def _session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    return s


def _get(session: requests.Session, params: dict) -> dict:
    params = {"format": "json", "formatversion": "2", **params}
    # Shared egress IPs (cloud sandboxes) are often throttled: back off patiently.
    for attempt in range(7):
        r = session.get(API, params=params, timeout=30)
        if r.status_code == 429:
            wait = max(int(r.headers.get("retry-after", "1") or 1), min(60, 4 * 2 ** attempt))
            print(f"  (Commons rate limit, retrying in {wait}s)", file=sys.stderr)
            time.sleep(wait)
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("Commons API kept returning 429 — wait a few minutes and retry")


def _clean(value: str) -> str:
    """Strip HTML tags/entities from an extmetadata value."""
    text = re.sub(r"<[^>]+>", "", value or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def licence_verdict(meta: dict) -> tuple[bool, str]:
    short = _clean(meta.get("LicenseShortName", {}).get("value", "")).lower()
    nonfree = _clean(meta.get("NonFree", {}).get("value", "")).lower()
    if nonfree in ("true", "1"):
        return False, f"marked non-free ({short})"
    if not short:
        return False, "no licence metadata"
    if any(re.search(p, short) for p in _DENIED):
        return False, f"licence not commercial-safe: {short}"
    if any(re.search(p, short) for p in _ALLOWED):
        return True, short
    return False, f"licence not on allow-list (review manually): {short}"


CACHE = Path.home() / ".cache" / "openmontage" / "commons"


def _cache_path(title: str) -> Path:
    import hashlib
    return CACHE / (hashlib.sha1(title.encode("utf-8")).hexdigest() + ".json")


def _imageinfo(session: requests.Session, titles: list[str], use_cache: bool = True) -> list[dict]:
    """imageinfo + extmetadata for titles. Every response is cached so a later
    `info`/`fetch` of a title already seen in `search` needs no API call (the
    Commons API is the part that gets rate-limited)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    pages, missing = [], []
    for t in titles:
        cp = _cache_path(t)
        if use_cache and cp.exists():
            pages.append(json.loads(cp.read_text()))
        else:
            missing.append(t)
    if missing:
        got = _get(session, {
            "action": "query",
            "titles": "|".join(missing),
            "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata",
        }).get("query", {}).get("pages", [])
        for pg in got:
            if pg.get("imageinfo"):
                _cache_path(pg["title"]).write_text(json.dumps(pg))
        pages += got
    return pages


def thumb_url(original_url: str, orig_width: int) -> tuple[str, int | None]:
    """Largest standard-width thumbnail on upload.wikimedia.org that does not
    upscale; (original_url, None) when the original is smaller than 960 px."""
    original_url = original_url.split("?")[0]  # drop utm_* tracking parameters
    width = next((w for w in STANDARD_WIDTHS if w <= min(orig_width or 0, MAX_WIDTH)), None)
    if not width or "/wikipedia/commons/" not in original_url:
        return original_url, None
    head, name = original_url.rsplit("/", 1)
    head = head.replace("/wikipedia/commons/", "/wikipedia/commons/thumb/", 1)
    suffix = ".jpg" if name.lower().endswith((".tif", ".tiff")) else ""
    prefix = "lossy-page1-" if suffix else ""
    return f"{head}/{name}/{prefix}{width}px-{name}{suffix}", width


def provenance(page: dict) -> dict:
    info = (page.get("imageinfo") or [{}])[0]
    meta = info.get("extmetadata") or {}
    ok, verdict = licence_verdict(meta)

    def m(key: str) -> str:
        return _clean(meta.get(key, {}).get("value", ""))

    return {
        "title": page.get("title"),
        "page_url": info.get("descriptionurl"),
        "original_url": info.get("url"),
        "thumb_url": info.get("thumburl"),
        "width": info.get("width"),
        "height": info.get("height"),
        "mime": info.get("mime"),
        "author": m("Artist"),
        "credit": m("Credit"),
        "licence": m("LicenseShortName"),
        "licence_url": m("LicenseUrl"),
        "attribution_required": m("AttributionRequired"),
        "usage_terms": m("UsageTerms"),
        "restrictions": m("Restrictions"),
        "description": m("ImageDescription")[:600],
        "object_name": m("ObjectName"),
        "date": m("DateTimeOriginal"),
        "categories": m("Categories")[:400],
        "commercial_ok": ok,
        "licence_verdict": verdict,
    }


def cmd_search(args: argparse.Namespace) -> int:
    s = _session()
    data = _get(s, {
        "action": "query",
        "list": "search",
        "srsearch": f"{args.query} filetype:bitmap",
        "srnamespace": "6",
        "srlimit": str(args.limit),
    })
    titles = [h["title"] for h in data.get("query", {}).get("search", [])]
    if not titles:
        print("no results")
        return 0
    pages = []
    for i in range(0, len(titles), 40):
        pages += _imageinfo(s, titles[i:i + 40])
    order = {t: i for i, t in enumerate(titles)}
    for p in sorted(pages, key=lambda p: order.get(p.get("title"), 999)):
        pv = provenance(p)
        flag = "OK " if pv["commercial_ok"] else "NO "
        print(f"{flag}{pv['width']}x{pv['height']}  {pv['title']}\n     {pv['licence_verdict']} | {pv['author'][:70]}")
    return 0


def cmd_info(args: argparse.Namespace) -> int:
    pages = _imageinfo(_session(), [args.title])
    print(json.dumps(provenance(pages[0]), indent=2, ensure_ascii=False))
    return 0


def cmd_prefetch(args: argparse.Namespace) -> int:
    """Cache metadata for many titles in ONE API request (rate-limit friendly)."""
    titles = list(args.titles)
    if args.from_file:
        titles += [ln.strip() for ln in Path(args.from_file).read_text().splitlines() if ln.strip()]
    s = _session()
    for i in range(0, len(titles), 40):
        for pg in _imageinfo(s, titles[i:i + 40]):
            pv = provenance(pg)
            print(f"{'OK ' if pv['commercial_ok'] else 'NO '}{pv['title']}  [{pv['licence_verdict']}]")
    return 0


def _download(session: requests.Session, url: str) -> bytes:
    for attempt in range(7):
        r = session.get(url, timeout=180)
        if r.status_code == 429:
            wait = min(90, 6 * 2 ** attempt)
            print(f"  (upload rate limit, retrying in {wait}s)", file=sys.stderr)
            time.sleep(wait)
            continue
        r.raise_for_status()
        return r.content
    raise RuntimeError(f"download kept returning 429: {url}")


def cmd_fetch(args: argparse.Namespace) -> int:
    global MAX_WIDTH
    MAX_WIDTH = args.max_width
    s = _session()
    pages = _imageinfo(s, [args.title])
    if not pages or pages[0].get("missing"):
        print(f"not found: {args.title}", file=sys.stderr)
        return 2
    pv = provenance(pages[0])
    if not pv["commercial_ok"] and not args.allow_manual_review:
        print(f"REFUSED {args.title}: {pv['licence_verdict']}", file=sys.stderr)
        return 3
    url, _w = thumb_url(pv["original_url"], pv["width"])
    ext = Path(url).suffix.lower() or ".jpg"
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{args.id}{ext}"
    dest.write_bytes(_download(s, url))
    pv.update({"asset_id": args.id, "local_path": str(dest), "downloaded_url": url,
               "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    (out_dir / f"{args.id}.provenance.json").write_text(json.dumps(pv, indent=2, ensure_ascii=False))
    print(f"saved {dest}  [{pv['licence']}]  {pv['author'][:60]}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("search"); p.add_argument("query"); p.add_argument("--limit", type=int, default=20)
    p = sub.add_parser("info"); p.add_argument("title")
    p = sub.add_parser("prefetch"); p.add_argument("titles", nargs="*"); p.add_argument("--from-file")
    p = sub.add_parser("fetch"); p.add_argument("title"); p.add_argument("--id", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--max-width", type=int, default=1920, choices=[960, 1280, 1920, 3840])
    p.add_argument("--allow-manual-review", action="store_true",
                   help="download a file whose licence is not auto-approved (record why in the episode file)")
    args = ap.parse_args()
    return {"search": cmd_search, "info": cmd_info, "prefetch": cmd_prefetch, "fetch": cmd_fetch}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
