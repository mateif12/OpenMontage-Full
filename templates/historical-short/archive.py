"""Archive research for a historical Short: search, records, previews, windows.

Run from the repository root with the project venv. <project> is the
project directory, e.g. projects/my-short.

  search   <project> "<query>" ["<query>" ...]
      Search the NARA catalog for moving images that are online, keep
      only records whose use AND access restrictions are "Unrestricted",
      and write artifacts/candidates.json (record id, title, dates,
      media URL, size, rights, filename check).

  records  <project> <naid> [<naid> ...]
      Save each full catalog record to research/nara_record_<naid>.json.
      Read the shot list and rights fields before using a reel.

  sheets   <project> <naid> [<naid> ...] [--step 15]
      Contact sheet per reel (one frame every --step seconds) via
      remote_clip; reads ~0.4 MB per frame instead of the whole reel.

  windows  <project>
      Extract every review window listed in artifacts/windows.json
      ([{"naid": "78975", "start": 33, "end": 85}, ...]) at source
      framing into assets/windows/, plus a 1 fps contact sheet each
      under research/window_sheets/. These cached windows are the only
      footage that crosses the network; final cuts are taken from them.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tools.video.remote_clip import RemoteClip  # noqa: E402
from tools.video.stock_sources.nara import rights_from_record  # noqa: E402

# Record search as served to the public catalog website (no API key).
SEARCH = "https://catalog.archives.gov/proxy/records/search"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _get(params: dict) -> dict:
    url = SEARCH + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def fetch_record(naid: str) -> dict:
    data = _get({"naId_is": naid, "allowLegacyOrgNames": "true"})
    hits = data["body"]["hits"]["hits"]
    if not hits:
        raise SystemExit(f"NARA record {naid} not found")
    return hits[0]["_source"]["record"]


def media_url(record: dict) -> str:
    """Largest MP4 digital object of a record (records often list duplicates)."""
    objs = [o for o in record.get("digitalObjects") or []
            if (o.get("objectUrl") or "").lower().endswith(".mp4")]
    if not objs:
        raise SystemExit(f"record {record.get('naId')} has no MP4 object")
    return max(objs, key=lambda o: o.get("objectFileSize") or 0)["objectUrl"]


def provenance(record: dict) -> dict:
    rights = rights_from_record(record)
    rid = record.get("localIdentifier") or str(record["naId"])
    return {
        "source": "nara",
        "record_id": rid,
        "naid": str(record["naId"]),
        "catalog_url": f"https://catalog.archives.gov/id/{record['naId']}",
        "title": record.get("title", ""),
        "creator": "; ".join(a.get("title", "") for a in record.get("ancestors") or []
                             if a.get("levelOfDescription") in ("series", "recordGroup")),
        "rights_status": rights["use_status"],
        "rights_note": rights["use_note"],
        "access_status": rights["access_status"],
        "rights_cleared": rights["cleared"],
        "sound_type": record.get("soundType", ""),
        "attribution": f"National Archives and Records Administration, {rid}",
        "media_url": media_url(record),
    }


def cmd_search(project: Path, queries: list[str]) -> None:
    seen: dict[str, dict] = {}
    for q in queries:
        for page in (1, 2, 3):
            data = _get({"q": q, "page": page, "limit": 100, "availableOnline": "true",
                         "typeOfMaterials": "Moving Images"})
            hits = data["body"]["hits"]["hits"]
            for h in hits:
                rec = h["_source"]["record"]
                seen[str(rec["naId"])] = rec
            if len(hits) < 100:
                break
    out, skipped = [], 0
    for rec in seen.values():
        rights = rights_from_record(rec)
        if not rights["cleared"]:
            skipped += 1
            continue
        try:
            url = media_url(rec)
        except SystemExit:
            continue
        local_id = rec.get("localIdentifier") or ""
        out.append({
            "naid": str(rec["naId"]), "record_id": local_id, "title": rec.get("title"),
            "dates": [d.get("logicalDate") for d in rec.get("productionDates") or []],
            "media_url": url,
            "filename_matches_identifier": bool(local_id) and local_id.lower() in url.lower(),
            "rights": rights,
        })
    out.sort(key=lambda r: r["record_id"])
    path = project / "artifacts" / "candidates.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=1))
    print(f"{len(seen)} records found; {len(out)} cleared (Unrestricted) with MP4; "
          f"{skipped} excluded for rights -> {path}")
    for r in out:
        flag = "" if r["filename_matches_identifier"] else "  [file name does not match record!]"
        print(f"  {r['naid']:>10}  {r['record_id']:<18} {r['dates']}  {r['title'][:60]}{flag}")


def cmd_records(project: Path, naids: list[str]) -> None:
    (project / "research").mkdir(parents=True, exist_ok=True)
    for naid in naids:
        rec = fetch_record(naid)
        (project / "research" / f"nara_record_{naid}.json").write_text(json.dumps(rec, indent=1))
        rights = rights_from_record(rec)
        print(f"{naid} {rec.get('localIdentifier')}: use={rights['use_status']} "
              f"access={rights['access_status']} note={rights['use_note']!r} "
              f"sound={rec.get('soundType')}")


def _record(project: Path, naid: str) -> dict:
    path = project / "research" / f"nara_record_{naid}.json"
    if not path.exists():
        cmd_records(project, [naid])
    return json.loads(path.read_text())


def cmd_sheets(project: Path, naids: list[str], step: float) -> None:
    out_dir = project / "research"
    total = 0
    for naid in naids:
        rec = _record(project, naid)
        r = RemoteClip().execute({
            "operation": "contact_sheet", "url": media_url(rec), "step_seconds": step,
            "label": rec.get("localIdentifier", naid),
            "output_path": str(out_dir / f"sheet_{naid}.jpg"),
        })
        if not r.success:
            raise SystemExit(f"{naid}: {r.error}")
        total += r.data["bytes_read"]
        print(f"{naid}: {r.data['frames']} frames, {r.data['bytes_read'] / 1e6:.1f} MB read")
    print(f"total read: {total / 1e6:.1f} MB")


def cmd_windows(project: Path) -> None:
    plan = json.loads((project / "artifacts" / "windows.json").read_text())
    wdir = project / "assets" / "windows"
    sdir = project / "research" / "window_sheets"
    wdir.mkdir(parents=True, exist_ok=True)
    sdir.mkdir(parents=True, exist_ok=True)

    def one(w: dict):
        rec = _record(project, str(w["naid"]))
        prov = provenance(rec)
        if not prov["rights_cleared"]:
            return w, None, f"rights not cleared ({prov['rights_status']})"
        name = f"w_{w['naid']}_{int(w['start']):04d}-{int(w['end']):04d}.mp4"
        r = RemoteClip().execute({
            "operation": "extract", "url": prov["media_url"], "start_seconds": w["start"],
            "end_seconds": w["end"], "active_area": "none", "crf": 16, "provenance": prov,
            "output_path": str(wdir / name),
        })
        if not r.success:
            return w, None, r.error
        # 1 fps sheet labelled with archive time, for picking exact in/out points.
        subprocess.run([
            "ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(wdir / name), "-vf",
            f"fps=1,scale=300:-2,drawtext=fontfile={FONT}:text='%{{eif\\:t+{w['start']}\\:d}}':"
            "x=4:y=4:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.7,tile=8x8",
            "-frames:v", "1", str(sdir / name.replace(".mp4", ".jpg")),
        ], check=True)
        return w, r.data, None

    total = 0
    with cf.ThreadPoolExecutor(3) as ex:
        for w, data, err in ex.map(one, plan):
            if err:
                print(f"{w}: FAILED {err}")
                continue
            total += data["bytes_read"]
            print(f"{w['naid']} {w['start']}-{w['end']}s: {data['bytes_read'] / 1e6:.1f} MB"
                  + (" (cache)" if data["from_cache"] else ""))
    print(f"total read from network: {total / 1e6:.1f} MB")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["search", "records", "sheets", "windows"])
    ap.add_argument("project", type=Path)
    ap.add_argument("args", nargs="*")
    ap.add_argument("--step", type=float, default=15)
    a = ap.parse_args()
    if a.command == "search":
        cmd_search(a.project, a.args)
    elif a.command == "records":
        cmd_records(a.project, a.args)
    elif a.command == "sheets":
        cmd_sheets(a.project, a.args, a.step)
    else:
        cmd_windows(a.project)


if __name__ == "__main__":
    main()
