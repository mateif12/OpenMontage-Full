"""Remote clip tool: preview and cut archival footage straight from URLs.

Archive reels are often hundreds of megabytes, but a Short needs a few
seconds from each. When the server honours HTTP range requests and the
MP4 index (moov atom) sits at the front of the file, FFmpeg can seek
inside the remote file and read only the bytes around the requested
window. This tool wraps that with three operations:

- ``probe``          duration, streams, range support, bytes read.
- ``contact_sheet``  timestamped frame grid sampled every N seconds,
                     one keyframe seek per frame (no full download).
- ``extract``        cut ``[start, end)`` from the URL, optionally
                     reframed to a vertical target, re-encoded H.264.

Extracted clips are cached in the shared clip cache
(``~/.openmontage/clips_cache``) keyed by URL + window + framing, so a
repeat extraction in a later project is a local hard link, not a
network fetch. Every clip gets a ``<clip>.provenance.json`` sidecar
with the source URL, archive record, rights status and timestamps.

Rights are never inferred here: the caller passes the archive's own
rights fields in ``provenance``, and ``extract`` refuses to cut a clip
whose ``provenance.rights_cleared`` is not true unless
``allow_uncleared`` is set.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from tools.base_tool import (
    BaseTool,
    Determinism,
    ExecutionMode,
    ResourceProfile,
    RetryPolicy,
    ResumeSupport,
    ToolResult,
    ToolStability,
    ToolTier,
)

_BYTES_READ = re.compile(r"Statistics: (\d+) bytes read")
_CROP = re.compile(r"crop=(\d+):(\d+):(\d+):(\d+)")
_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _bytes_read(stderr: str) -> int:
    """Sum the input-side byte counters FFmpeg prints at -v verbose."""
    return sum(int(m) for m in _BYTES_READ.findall(stderr))


def _check_url(url: str) -> None:
    # A local file is accepted so final cuts can be taken from a window
    # extracted earlier (source framing) without reading the network again.
    if url.startswith(("https://", "http://")):
        return
    if not Path(url).is_file():
        raise ValueError(f"url must be http(s) or an existing local file: {url!r}")


class RemoteClip(BaseTool):
    name = "remote_clip"
    version = "0.1.0"
    tier = ToolTier.CORE
    capability = "video_post"
    provider = "ffmpeg"
    stability = ToolStability.EXPERIMENTAL
    execution_mode = ExecutionMode.SYNC
    determinism = Determinism.DETERMINISTIC

    dependencies = ["cmd:ffmpeg", "cmd:ffprobe"]
    install_instructions = (
        "Install FFmpeg: https://ffmpeg.org/download.html\n"
        "Linux: sudo apt install ffmpeg"
    )
    agent_skills = ["ffmpeg", "video-edit"]
    related_skills = ["skills/creative/historical-shorts.md"]
    best_for = [
        "cutting seconds of archival footage from large remote reels without downloading them",
        "previewing remote reels as contact sheets",
        "reframing 4:3 archive film into 9:16 vertical clips with provenance sidecars",
    ]

    capabilities = ["probe", "contact_sheet", "extract"]

    input_schema = {
        "type": "object",
        "required": ["operation", "url"],
        "properties": {
            "operation": {"type": "string", "enum": ["probe", "contact_sheet", "extract"]},
            "url": {
                "type": "string",
                "description": "Direct http(s) media URL, or a local window extracted earlier",
            },
            "output_path": {"type": "string"},
            "start_seconds": {"type": "number", "minimum": 0},
            "end_seconds": {"type": "number", "minimum": 0},
            "step_seconds": {
                "type": "number", "minimum": 0.5, "default": 15,
                "description": "contact_sheet: sampling interval",
            },
            "label": {"type": "string", "description": "contact_sheet: prefix for frame labels"},
            "columns": {"type": "integer", "minimum": 1, "default": 6},
            "target": {
                "type": "object",
                "description": "extract: output frame. Omit to keep the source framing.",
                "properties": {
                    "width": {"type": "integer"},
                    "height": {"type": "integer"},
                    "fps": {"type": "number"},
                },
            },
            "focus_x": {
                "type": "number", "minimum": 0, "maximum": 1, "default": 0.5,
                "description": "extract: horizontal crop position (0=left, 1=right)",
            },
            "focus_y": {"type": "number", "minimum": 0, "maximum": 1, "default": 0.5},
            "zoom": {
                "type": "number", "minimum": 1, "default": 1.0,
                "description": "extract: extra punch-in after the crop",
            },
            "active_area": {
                "type": "string",
                "description": "extract: 'auto' (cropdetect black bars), 'none', or 'w:h:x:y'",
                "default": "auto",
            },
            "video_filter": {
                "type": "string",
                "description": "extract: extra FFmpeg filters appended after framing (e.g. grading)",
            },
            "crf": {"type": "integer", "default": 17},
            "provenance": {
                "type": "object",
                "description": (
                    "extract: archive metadata carried into the sidecar. Expected keys: "
                    "source, record_id, catalog_url, title, creator, rights_status, "
                    "rights_note, rights_cleared (bool), attribution, notes. When url is a "
                    "local window, also media_url (the archive file) and "
                    "window_offset_seconds (where the window starts in it)."
                ),
            },
            "allow_uncleared": {"type": "boolean", "default": False},
            "use_cache": {"type": "boolean", "default": True},
        },
    }

    resource_profile = ResourceProfile(
        cpu_cores=2, ram_mb=1024, vram_mb=0, disk_mb=500, network_required=True
    )
    retry_policy = RetryPolicy(max_retries=2, retryable_errors=["Connection", "timed out"])
    resume_support = ResumeSupport.FROM_START
    idempotency_key_fields = [
        "operation", "url", "start_seconds", "end_seconds", "step_seconds",
        "target", "focus_x", "focus_y", "zoom", "active_area", "video_filter", "crf",
    ]
    side_effects = ["reads byte ranges from url", "writes output_path and a provenance sidecar"]
    user_visible_verification = ["Inspect contact sheets and extracted clips before editing"]

    def execute(self, inputs: dict[str, Any]) -> ToolResult:
        start = time.time()
        op = inputs.get("operation")
        try:
            _check_url(inputs.get("url", ""))
            if op == "probe":
                result = self._probe(inputs)
            elif op == "contact_sheet":
                result = self._contact_sheet(inputs)
            elif op == "extract":
                result = self._extract(inputs)
            else:
                return ToolResult(success=False, error=f"Unknown operation: {op}")
        except Exception as e:
            return ToolResult(success=False, error=str(e))
        result.duration_seconds = round(time.time() - start, 2)
        return result

    # ------------------------------------------------------------------
    # probe
    # ------------------------------------------------------------------

    def _probe(self, inputs: dict[str, Any]) -> ToolResult:
        import requests

        url = inputs["url"]
        total, ranges = None, None
        if url.startswith(("https://", "http://")):
            r = requests.get(url, headers={"Range": "bytes=0-15"}, timeout=30, stream=True)
            r.close()
            content_range = r.headers.get("Content-Range", "")
            total = int(content_range.rsplit("/", 1)[-1]) if "/" in content_range else None
            ranges = r.status_code == 206

        proc = subprocess.run(
            ["ffprobe", "-v", "verbose", "-print_format", "json",
             "-show_format", "-show_streams", url],
            capture_output=True, text=True, timeout=120,
        )
        if proc.returncode != 0:
            return ToolResult(success=False, error=f"ffprobe failed: {proc.stderr[-500:]}")
        info = json.loads(proc.stdout)
        video = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), {})
        audio = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)
        return ToolResult(
            success=True,
            data={
                "url": url,
                "range_requests": ranges,
                "size_bytes": total or int(info.get("format", {}).get("size", 0) or 0),
                "duration_seconds": float(info.get("format", {}).get("duration", 0) or 0),
                "width": video.get("width"),
                "height": video.get("height"),
                "sample_aspect_ratio": video.get("sample_aspect_ratio"),
                "avg_frame_rate": video.get("avg_frame_rate"),
                "codec": video.get("codec_name"),
                "has_audio_stream": audio is not None,
                "bytes_read": _bytes_read(proc.stderr),
            },
        )

    # ------------------------------------------------------------------
    # contact_sheet
    # ------------------------------------------------------------------

    def _contact_sheet(self, inputs: dict[str, Any]) -> ToolResult:
        url = inputs["url"]
        out = Path(inputs.get("output_path") or "contact_sheet.jpg")
        out.parent.mkdir(parents=True, exist_ok=True)
        step = float(inputs.get("step_seconds", 15))
        cols = int(inputs.get("columns", 6))
        label = str(inputs.get("label") or "")
        label = re.sub(r"[^A-Za-z0-9 ._-]", "", label)[:24]

        t0 = float(inputs.get("start_seconds", 0))
        t1 = inputs.get("end_seconds")
        if t1 is None:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "csv=p=0", url],
                capture_output=True, text=True, timeout=120,
            )
            t1 = float(probe.stdout.strip() or 0)
        t1 = float(t1)

        times = []
        t = t0
        while t < t1:
            times.append(round(t, 2))
            t += step
        if not times:
            return ToolResult(success=False, error="empty time range")

        total_bytes = 0
        with tempfile.TemporaryDirectory(prefix="om_sheet_") as tmp:
            for i, ts in enumerate(times):
                text = f"{label} t={ts:g}".strip().replace(":", r"\:")
                vf = (
                    "scale=360:-2,"
                    f"drawtext=fontfile={_FONT}:text='{text}':x=6:y=6:fontsize=18:"
                    "fontcolor=yellow:box=1:boxcolor=black@0.7"
                )
                proc = subprocess.run(
                    ["ffmpeg", "-nostdin", "-v", "verbose", "-y", "-ss", str(ts), "-i", url,
                     "-frames:v", "1", "-update", "1", "-vf", vf,
                     str(Path(tmp) / f"{i:05d}.jpg")],
                    capture_output=True, text=True, timeout=120,
                )
                total_bytes += _bytes_read(proc.stderr)
            frames = sorted(Path(tmp).glob("*.jpg"))
            if not frames:
                return ToolResult(success=False, error="no frames could be read")
            rows = math.ceil(len(frames) / cols)
            proc = subprocess.run(
                ["ffmpeg", "-nostdin", "-v", "error", "-y", "-pattern_type", "glob",
                 "-i", str(Path(tmp) / "*.jpg"),
                 "-vf", f"scale=360:-2,tile={cols}x{rows}", "-frames:v", "1", str(out)],
                capture_output=True, text=True, timeout=120,
            )
            if proc.returncode != 0:
                return ToolResult(success=False, error=f"tile failed: {proc.stderr[-500:]}")

        return ToolResult(
            success=True,
            data={"output": str(out), "frames": len(times), "timestamps": times,
                  "bytes_read": total_bytes},
            artifacts=[str(out)],
        )

    # ------------------------------------------------------------------
    # extract
    # ------------------------------------------------------------------

    @staticmethod
    def _detect_active_area(url: str, at: float, dur: float) -> str | None:
        """Find the picture area inside black pillar/letterbox bars."""
        proc = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "info", "-ss", str(at), "-i", url, "-t", str(min(dur, 2.0)),
             "-vf", "cropdetect=limit=24:round=2:reset=0", "-an", "-f", "null", "-"],
            capture_output=True, text=True, timeout=120,
        )
        crops = _CROP.findall(proc.stderr)
        if not crops:
            return None
        w, h, x, y = crops[-1]
        return f"{w}:{h}:{x}:{y}"

    def _framing_filter(self, inputs: dict[str, Any], active: str | None) -> str:
        parts: list[str] = []
        if active:
            parts.append(f"crop={active}")
        # Square the pixels first so aspect maths below is in display units.
        parts.append("scale=trunc(iw*sar/2)*2:ih,setsar=1")
        target = inputs.get("target") or {}
        if target.get("width") and target.get("height"):
            tw, th = int(target["width"]), int(target["height"])
            fx = float(inputs.get("focus_x", 0.5))
            fy = float(inputs.get("focus_y", 0.5))
            zoom = max(1.0, float(inputs.get("zoom", 1.0)))
            ar = f"{tw}/{th}"
            cw = f"min(iw\\,ih*{ar})/{zoom}"
            ch = f"min(ih\\,iw/({ar}))/{zoom}"
            parts.append(f"crop=w='{cw}':h='{ch}':x='(iw-ow)*{fx}':y='(ih-oh)*{fy}'")
            parts.append(f"scale={tw}:{th}:flags=lanczos")
        if target.get("fps"):
            parts.append(f"fps={target['fps']}")
        if inputs.get("video_filter"):
            parts.append(str(inputs["video_filter"]))
        parts.append("format=yuv420p")
        return ",".join(parts)

    def _extract(self, inputs: dict[str, Any]) -> ToolResult:
        url = inputs["url"]
        if "start_seconds" not in inputs or "end_seconds" not in inputs:
            return ToolResult(success=False, error="extract needs start_seconds and end_seconds")
        t0, t1 = float(inputs["start_seconds"]), float(inputs["end_seconds"])
        if t1 <= t0:
            return ToolResult(success=False, error="end_seconds must be after start_seconds")

        provenance = dict(inputs.get("provenance") or {})
        if not provenance.get("rights_cleared") and not inputs.get("allow_uncleared"):
            return ToolResult(
                success=False,
                error=(
                    "provenance.rights_cleared is not true. Record the archive's rights "
                    "status in provenance and set rights_cleared only when it documents "
                    "the intended use (or pass allow_uncleared for private review)."
                ),
            )

        out = Path(inputs.get("output_path") or "clip.mp4")
        out.parent.mkdir(parents=True, exist_ok=True)

        active_area = str(inputs.get("active_area", "auto"))
        if active_area == "auto":
            active = self._detect_active_area(url, t0 + min(1.0, (t1 - t0) / 2), t1 - t0)
        elif active_area == "none":
            active = None
        else:
            active = active_area
        vf = self._framing_filter(inputs, active)
        crf = int(inputs.get("crf", 17))

        key_src = json.dumps(
            {"url": url, "t0": t0, "t1": t1, "vf": vf, "crf": crf}, sort_keys=True
        )
        clip_id = "remote_" + hashlib.sha256(key_src.encode()).hexdigest()[:20]

        cache = None
        if inputs.get("use_cache", True):
            try:
                from tools.video.clip_cache import get_default_cache
                cache = get_default_cache()
            except Exception:
                cache = None

        from_cache = bool(cache and cache.try_link(clip_id, out))
        bytes_read = 0
        if not from_cache:
            tmp_out = out.with_name(f".{out.stem}.partial{out.suffix}")
            cmd = [
                # -t before -i bounds the demuxer too, so it stops reading
                # the remote file at the window end instead of reading ahead.
                "ffmpeg", "-nostdin", "-v", "verbose", "-y", "-ss", f"{t0:.3f}",
                "-t", f"{t1 - t0:.3f}", "-i", url, "-an", "-vf", vf,
                # No +faststart: its second pass re-reads the output and would
                # inflate the network byte count; local clips don't need it.
                "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), str(tmp_out),
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if url.startswith(("https://", "http://")):
                bytes_read = _bytes_read(proc.stderr)
            if proc.returncode != 0 or not tmp_out.exists():
                tmp_out.unlink(missing_ok=True)
                return ToolResult(success=False, error=f"ffmpeg failed: {proc.stderr[-800:]}")
            tmp_out.replace(out)
            if cache:
                cache.ingest(clip_id, out, {
                    "source": provenance.get("source", ""),
                    "source_id": provenance.get("record_id", ""),
                    "source_url": provenance.get("catalog_url", url),
                    "license": provenance.get("rights_status", ""),
                    "creator": provenance.get("creator", ""),
                    "source_tags": f"{t0:.3f}-{t1:.3f}s {provenance.get('title', '')}",
                })

        digest = hashlib.sha256(out.read_bytes()).hexdigest()
        remote = url.startswith(("https://", "http://"))
        sidecar = {
            **provenance,
            # For a local window, provenance already names the archive media
            # URL and the window's offset into it; keep those authoritative.
            "media_url": url if remote else provenance.get("media_url", ""),
            "input": url,
            "input_in_seconds": round(t0, 3),
            "input_out_seconds": round(t1, 3),
            # Position in the archive reel itself (window offset + cut point).
            "source_in_seconds": round(float(provenance.get("window_offset_seconds", 0)) + t0, 3),
            "source_out_seconds": round(float(provenance.get("window_offset_seconds", 0)) + t1, 3),
            "active_area": active,
            "framing_filter": vf,
            "clip_id": clip_id,
            "from_cache": from_cache,
            "bytes_read_from_network": bytes_read,
            "output_sha256": digest,
            "extracted_by": f"{self.name} {self.version}",
            "extracted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        sidecar_path = out.with_suffix(".provenance.json")
        sidecar_path.write_text(json.dumps(sidecar, indent=2), encoding="utf-8")

        return ToolResult(
            success=True,
            data={
                "output": str(out),
                "provenance_path": str(sidecar_path),
                "clip_id": clip_id,
                "from_cache": from_cache,
                "bytes_read": bytes_read,
                "active_area": active,
            },
            artifacts=[str(out)],
        )
