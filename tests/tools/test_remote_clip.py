"""remote_clip: framing, rights gating, cache reuse, provenance; NARA rights parsing.

All offline: a short synthetic 4:3-in-16:9 clip stands in for an archive file
(local paths are accepted as inputs alongside http(s) URLs).
"""
import json
import shutil
import subprocess

import pytest

from tools.video.clip_cache import ClipCache
from tools.video.remote_clip import RemoteClip, _bytes_read
from tools.video.stock_sources import SearchFilters
from tools.video.stock_sources.nara import NARASource, rights_from_record

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")

CLEARED = {"rights_cleared": True, "record_id": "TEST-1", "rights_status": "Unrestricted"}


@pytest.fixture()
def pillarboxed(tmp_path):
    """4 s, 1920x1080, 4:3 picture centred between black bars (like NARA HD scans)."""
    path = tmp_path / "reel.mp4"
    subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi",
        "-i", "testsrc2=size=1440x1080:rate=24:duration=4",
        "-vf", "pad=1920:1080:240:0:black", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path),
    ], check=True)
    return path


def _probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                          "stream=width,height,avg_frame_rate:format=duration", "-of", "json",
                          str(path)], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_extract_reframes_to_vertical_and_writes_provenance(pillarboxed, tmp_path):
    out = tmp_path / "clip.mp4"
    r = RemoteClip().execute({
        "operation": "extract", "url": str(pillarboxed), "start_seconds": 1, "end_seconds": 3,
        "target": {"width": 1080, "height": 1920, "fps": 30}, "provenance": dict(CLEARED),
        "use_cache": False, "output_path": str(out),
    })
    assert r.success, r.error
    info = _probe(out)
    assert (info["streams"][0]["width"], info["streams"][0]["height"]) == (1080, 1920)
    assert info["streams"][0]["avg_frame_rate"] == "30/1"
    assert abs(float(info["format"]["duration"]) - 2.0) < 0.05
    # The black pillarbox bars were detected and cropped away first.
    w, h, x, y = map(int, r.data["active_area"].split(":"))
    assert 1400 <= w <= 1460 and x >= 220

    side = json.loads(out.with_suffix(".provenance.json").read_text())
    assert side["record_id"] == "TEST-1"
    assert side["rights_status"] == "Unrestricted"
    assert (side["source_in_seconds"], side["source_out_seconds"]) == (1.0, 3.0)
    assert side["bytes_read_from_network"] == 0  # local input


def test_window_offset_maps_cut_back_to_archive_time(pillarboxed, tmp_path):
    prov = dict(CLEARED, window_offset_seconds=100.0, media_url="https://example.org/reel.mp4")
    out = tmp_path / "clip.mp4"
    r = RemoteClip().execute({
        "operation": "extract", "url": str(pillarboxed), "start_seconds": 0.5, "end_seconds": 1.5,
        "provenance": prov, "use_cache": False, "output_path": str(out),
    })
    assert r.success, r.error
    side = json.loads(out.with_suffix(".provenance.json").read_text())
    assert (side["source_in_seconds"], side["source_out_seconds"]) == (100.5, 101.5)
    assert side["media_url"] == "https://example.org/reel.mp4"


def test_extract_refuses_uncleared_rights(pillarboxed, tmp_path):
    r = RemoteClip().execute({
        "operation": "extract", "url": str(pillarboxed), "start_seconds": 0, "end_seconds": 1,
        "provenance": {"rights_cleared": False, "rights_status": "Restricted - Possibly"},
        "output_path": str(tmp_path / "x.mp4"),
    })
    assert not r.success
    assert "rights_cleared" in r.error
    assert not (tmp_path / "x.mp4").exists()


def test_repeat_extract_is_served_from_clip_cache(pillarboxed, tmp_path, monkeypatch):
    cache = ClipCache(cache_dir=tmp_path / "cache")
    monkeypatch.setattr("tools.video.clip_cache.get_default_cache", lambda: cache)
    args = {"operation": "extract", "url": str(pillarboxed), "start_seconds": 0,
            "end_seconds": 1, "provenance": dict(CLEARED)}
    first = RemoteClip().execute({**args, "output_path": str(tmp_path / "a.mp4")})
    second = RemoteClip().execute({**args, "output_path": str(tmp_path / "b.mp4")})
    assert first.success and second.success
    assert first.data["from_cache"] is False
    assert second.data["from_cache"] is True
    assert (tmp_path / "a.mp4").read_bytes() == (tmp_path / "b.mp4").read_bytes()


def test_contact_sheet_samples_frames(pillarboxed, tmp_path):
    out = tmp_path / "sheet.jpg"
    r = RemoteClip().execute({"operation": "contact_sheet", "url": str(pillarboxed),
                              "step_seconds": 1, "columns": 2, "output_path": str(out)})
    assert r.success, r.error
    assert r.data["timestamps"] == [0.0, 1.0, 2.0, 3.0]
    assert out.exists()


def test_rejects_non_url_non_file():
    r = RemoteClip().execute({"operation": "probe", "url": "/no/such/file.mp4"})
    assert not r.success


def test_bytes_read_sums_only_read_counters():
    err = ("[AVIOContext @ 0x1] Statistics: 1000 bytes read, 2 seeks\n"
           "[AVIOContext @ 0x2] Statistics: 5000 bytes written, 1 seeks, 3 writeouts\n"
           "[AVIOContext @ 0x3] Statistics: 250 bytes read, 0 seeks\n")
    assert _bytes_read(err) == 1250


def test_nara_rights_are_read_from_the_record():
    cleared = rights_from_record({"useRestriction": {"status": "Unrestricted"},
                                  "accessRestriction": {"status": "Unrestricted"}})
    assert cleared["cleared"] is True
    possibly = rights_from_record({
        "useRestriction": {"status": "Restricted - Possibly", "specificUseRestrictions": ["Copyright"],
                           "note": "Some or all of this material may be restricted by copyright."},
        "accessRestriction": {"status": "Unrestricted"}})
    assert possibly["cleared"] is False
    assert possibly["specific_use_restrictions"] == ["Copyright"]
    assert rights_from_record({})["cleared"] is False


def _hit(naid, status, url):
    return {"_source": {"record": {
        "naId": naid, "title": "Reel", "localIdentifier": f"428-NPC-{naid}",
        "useRestriction": {"status": status}, "accessRestriction": {"status": "Unrestricted"},
        "digitalObjects": [
            {"objectUrl": url, "objectType": "Audio/Visual File (MP4)", "objectFileSize": 1234},
            {"objectUrl": url, "objectType": "Audio/Visual File (MP4)", "objectFileSize": 99},
        ],
    }}}


def test_nara_search_keeps_only_cleared_records_and_dedupes(monkeypatch):
    payload = {"body": {"hits": {"hits": [
        _hit(1, "Unrestricted", "https://catalog.archives.gov/medialz/428-npc-1.mp4"),
        _hit(2, "Restricted - Possibly", "https://catalog.archives.gov/medialz/428-npc-2.mp4"),
        _hit(3, "Undetermined", "https://catalog.archives.gov/medialz/other-file.mp4"),
    ]}}}

    class Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return payload

    import requests
    monkeypatch.setattr(requests, "get", lambda *a, **k: Resp())
    monkeypatch.delenv("NARA_INCLUDE_RESTRICTED", raising=False)
    out = NARASource().search("normandy", SearchFilters())
    assert [c.extra["naId"] for c in out] == ["1"]
    assert out[0].license == "NARA use restriction: Unrestricted"
    assert "public domain" not in out[0].license.lower()
    assert out[0].extra["fileSize"] == 1234  # duplicate object collapsed to the larger one
    assert out[0].extra["filename_matches_identifier"] is True

    monkeypatch.setenv("NARA_INCLUDE_RESTRICTED", "1")
    out = NARASource().search("normandy", SearchFilters())
    assert {c.extra["naId"] for c in out} == {"1", "2", "3"}
    assert next(c for c in out if c.extra["naId"] == "3").extra["filename_matches_identifier"] is False
