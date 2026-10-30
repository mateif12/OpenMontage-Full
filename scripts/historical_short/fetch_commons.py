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

    # download many files in one go (metadata: library -> cache -> ONE API call)
    python scripts/historical_short/fetch_commons.py fetch-list --pack napoleonic \
        --ids wellington_lawrence,sadler_waterloo --out projects/<episode>/assets/images
    python scripts/historical_short/fetch_commons.py fetch-list --list ids.txt --out ...
        # ids.txt lines: "<asset_id>|File:<title>"

    # save verified metadata of titles you used into the repo library (text only)
    python scripts/historical_short/fetch_commons.py library-add "File:A.jpg" "File:B.jpg"

Speed notes (measured 2026-10-30): from shared cloud IPs Wikimedia answered
python-requests downloads with HTTP 429 while curl fetched the same URL with
the same User-Agent at once, so downloads go through curl when available and
fail fast (≈40 s) instead of looping for 10 minutes. Metadata is looked up in
the repo library (scripts/historical_short/library/commons) and the local
cache before the rate-limited API is called.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
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
# Repo-tracked, text-only library of verified Commons metadata (one JSON per
# file, exactly as returned by the imageinfo API) + curated packs per period.
LIBRARY = Path(__file__).resolve().parent / "library"
LIBRARY_COMMONS = LIBRARY / "commons"


def library_slug(title: str) -> str:
    name = title.split(":", 1)[-1]
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_")[:150] + ".json"


def _library_lookup(title: str) -> dict | None:
    lp = LIBRARY_COMMONS / library_slug(title)
    if lp.exists():
        return json.loads(lp.read_text())
    return None


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
        lib = _library_lookup(t) if use_cache else None
        if lib is not None:
            pages.append(lib)
        elif use_cache and cp.exists():
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


def _download_curl(url: str) -> bytes | None:
    """curl with the same User-Agent; returns None on HTTP error/429."""
    r = subprocess.run(["curl", "-sS", "-f", "-L", "--max-time", "120", "-A", USER_AGENT, url],
                       capture_output=True)
    return r.stdout if r.returncode == 0 and r.stdout else None


def _download(session: requests.Session, url: str) -> bytes:
    # Fail fast: ~40 s worst case, then the caller can move on (or the agent
    # replaces the scene) instead of a 10-minute retry loop.
    waits = [0, 5, 10, 20]
    for attempt, wait in enumerate(waits):
        if wait:
            print(f"  (upload rate limit, retrying in {wait}s)", file=sys.stderr)
            time.sleep(wait)
        if shutil.which("curl"):
            data = _download_curl(url)
            if data:
                return data
        r = session.get(url, timeout=180)
        if r.status_code == 429:
            continue
        r.raise_for_status()
        return r.content
    raise RuntimeError(f"download kept returning 429: {url}")


def _fetch_one(s: requests.Session, page: dict, asset_id: str, out_dir: Path,
               allow_manual_review: bool = False, extra: dict | None = None) -> int:
    title = page.get("title")
    if not page or page.get("missing"):
        print(f"not found: {title}", file=sys.stderr)
        return 2
    pv = provenance(page)
    if not pv["commercial_ok"] and not allow_manual_review:
        print(f"REFUSED {title}: {pv['licence_verdict']}", file=sys.stderr)
        return 3
    global MAX_WIDTH
    url, _w = thumb_url(pv["original_url"], pv["width"])
    ext = Path(url).suffix.lower() or ".jpg"
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{asset_id}{ext}"
    try:
        data = _download(s, url)
    except RuntimeError:
        # Some thumbnail widths of a file are throttled harder (not yet cached
        # at the edge); retry once at each smaller standard width.
        data, saved = None, MAX_WIDTH
        for w in [x for x in STANDARD_WIDTHS if x < (_w or 0)]:
            MAX_WIDTH = w
            url, _ = thumb_url(pv["original_url"], pv["width"])
            print(f"  (retrying at {w}px)", file=sys.stderr)
            data = _download_curl(url)
            if data:
                break
        MAX_WIDTH = saved
        if not data:
            raise
    dest.write_bytes(data)
    pv.update({"asset_id": asset_id, "local_path": str(dest), "downloaded_url": url,
               "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    if extra:
        pv["library_entry"] = extra
    (out_dir / f"{asset_id}.provenance.json").write_text(json.dumps(pv, indent=2, ensure_ascii=False))
    print(f"saved {dest}  [{pv['licence']}]  {pv['author'][:60]}", flush=True)
    return 0


def cmd_fetch(args: argparse.Namespace) -> int:
    global MAX_WIDTH
    MAX_WIDTH = args.max_width
    s = _session()
    pages = _imageinfo(s, [args.title])
    if not pages:
        print(f"not found: {args.title}", file=sys.stderr)
        return 2
    return _fetch_one(s, pages[0], args.id, Path(args.out), args.allow_manual_review)


def load_pack(name: str) -> dict:
    """Curated, pre-verified asset pack: scripts/historical_short/library/packs/<name>.yaml"""
    import yaml
    path = LIBRARY / "packs" / f"{name}.yaml"
    if not path.exists():
        raise SystemExit(f"no asset pack {path}")
    return yaml.safe_load(path.read_text())


def cmd_fetch_list(args: argparse.Namespace) -> int:
    """Batch fetch: one metadata pass (library/cache, then a single API call for
    the rest), then sequential curl downloads a few seconds apart. Files already
    present (provenance exists) are skipped, so re-running is cheap."""
    global MAX_WIDTH
    MAX_WIDTH = args.max_width
    jobs: list[tuple[str, str, dict | None]] = []
    if args.pack:
        pack = load_pack(args.pack)
        wanted = set(filter(None, (args.ids or "").split(","))) or None
        for e in pack["assets"]:
            if wanted is None or e["id"] in wanted:
                jobs.append((e["id"], e["title"], e))
        if wanted:
            missing = wanted - {j[0] for j in jobs}
            if missing:
                raise SystemExit(f"ids not in pack {args.pack}: {sorted(missing)}")
    if args.list:
        for ln in Path(args.list).read_text().splitlines():
            if ln.strip() and not ln.lstrip().startswith("#"):
                aid, title = ln.split("|", 1)
                jobs.append((aid.strip(), title.strip(), None))
    out_dir = Path(args.out)
    jobs = [j for j in jobs if not (out_dir / f"{j[0]}.provenance.json").exists()]
    if not jobs:
        print("nothing to fetch (all present)")
        return 0
    s = _session()
    pages = {p.get("title"): p for p in _imageinfo(s, [t for _, t, _ in jobs])}
    failed = []
    for i, (aid, title, entry) in enumerate(jobs):
        page = pages.get(title) or next((p for p in pages.values()
                                          if (p.get("title") or "").replace("_", " ") == title.replace("_", " ")), None)
        try:
            rc = _fetch_one(s, page or {"title": title, "missing": True}, aid, out_dir, False, entry)
        except Exception as exc:  # keep going; report at the end
            print(f"FAILED {aid}: {exc}", file=sys.stderr)
            rc = 1
        if rc:
            failed.append(aid)
        if i < len(jobs) - 1:
            time.sleep(args.gap)
    print(f"done: {len(jobs) - len(failed)} fetched, {len(failed)} failed {failed if failed else ''}")
    return 1 if failed else 0


def cmd_library_add(args: argparse.Namespace) -> int:
    """Copy verified metadata for titles into the repo library (text only)."""
    LIBRARY_COMMONS.mkdir(parents=True, exist_ok=True)
    pages = _imageinfo(_session(), list(args.titles))
    for pg in pages:
        if not pg.get("imageinfo"):
            print(f"skip (no metadata): {pg.get('title')}")
            continue
        pv = provenance(pg)
        if not pv["commercial_ok"]:
            print(f"skip (licence {pv['licence_verdict']}): {pg.get('title')}")
            continue
        dest = LIBRARY_COMMONS / library_slug(pg["title"])
        dest.write_text(json.dumps(pg, indent=1, ensure_ascii=False) + "\n")
        print(f"library: {dest.name}  [{pv['licence']}]")
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
    p = sub.add_parser("fetch-list"); p.add_argument("--pack"); p.add_argument("--ids")
    p.add_argument("--list"); p.add_argument("--out", required=True)
    p.add_argument("--gap", type=float, default=4.0, help="seconds between downloads")
    p.add_argument("--max-width", type=int, default=1920, choices=[960, 1280, 1920, 3840])
    p = sub.add_parser("library-add"); p.add_argument("titles", nargs="+")
    args = ap.parse_args()
    return {"search": cmd_search, "info": cmd_info, "prefetch": cmd_prefetch, "fetch": cmd_fetch,
            "fetch-list": cmd_fetch_list, "library-add": cmd_library_add}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
