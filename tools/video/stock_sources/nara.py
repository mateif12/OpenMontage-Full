"""U.S. National Archives (NARA) stock source adapter.

Wraps the NARA Catalog record search behind the unified `StockSource`
protocol. NARA holds significant film and video holdings (WWII, Cold War,
Apollo era, presidential libraries, newsreels).

Endpoints
---------
- With ``NARA_API_KEY`` set: the documented Catalog API
  (``catalog.archives.gov/api/v2/records/search``, ``x-api-key`` header).
- Without a key: the same record search served to the public catalog
  website (``catalog.archives.gov/proxy/records/search``). It needs no
  key, but it is not a documented API and may change without notice.

Both return ``body.hits.hits[]._source.record`` documents.

Rights
------
Hosting by a government archive does NOT make a record public domain.
Every NARA description carries its own ``useRestriction.status``
("Unrestricted", "Restricted - Possibly", "Restricted - Fully",
"Undetermined", ...). This adapter reports that status verbatim in
``Candidate.license`` and ``Candidate.extra["rights"]``, and by default
returns only records whose use status is "Unrestricted". Set
``NARA_INCLUDE_RESTRICTED=1`` to also return the others (for research
only — they still need clearance before use).

Media files
-----------
``objectUrl`` values point at ``catalog.archives.gov/medialz/...``,
which serves byte ranges, so clips can be cut remotely with
``remote_clip`` instead of downloading whole reels.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from .base import Candidate, SearchFilters

_log = logging.getLogger(__name__)

_API_SEARCH_URL = "https://catalog.archives.gov/api/v2/records/search"
_PUBLIC_SEARCH_URL = "https://catalog.archives.gov/proxy/records/search"
_CLEARED_STATUS = "Unrestricted"
_VIDEO_EXTS = ("mp4", "mov", "avi", "wmv", "mkv", "webm", "m4v")
_IMAGE_EXTS = ("jpg", "jpeg", "png", "tif", "tiff", "gif")


def rights_from_record(record: dict) -> dict[str, Any]:
    """Extract the rights fields of a NARA description, verbatim."""
    use = record.get("useRestriction") or {}
    access = record.get("accessRestriction") or {}
    return {
        "use_status": use.get("status") or "Not stated",
        "use_note": use.get("note") or "",
        "specific_use_restrictions": use.get("specificUseRestrictions") or [],
        "access_status": access.get("status") or "Not stated",
        "cleared": (use.get("status") == _CLEARED_STATUS
                    and access.get("status") in (None, "Unrestricted")),
    }


class NARASource:
    """U.S. National Archives adapter. Satisfies `StockSource`."""

    name = "nara"
    display_name = "U.S. National Archives"
    provider = "nara"
    priority = 35
    install_instructions = (
        "NARA works without an API key. "
        "Set NARA_API_KEY in .env to use the documented Catalog API instead."
    )
    supports = {"video": True, "image": True}

    def is_available(self) -> bool:
        # NARA is always available (no key required)
        return True

    def search(self, query: str, filters: SearchFilters) -> list[Candidate]:
        import requests

        kind = (filters.kind or "video").lower()
        per_page = max(1, min(filters.per_page, 100))

        params: dict[str, Any] = {
            "q": query,
            "limit": per_page,
            "page": max(1, filters.page),
            "availableOnline": "true",
        }
        if kind == "video":
            params["typeOfMaterials"] = "Moving Images"
        elif kind == "image":
            params["typeOfMaterials"] = "Photographs and other Graphic Materials"

        headers: dict[str, str] = {"Accept": "application/json"}
        api_key = os.environ.get("NARA_API_KEY")
        if api_key:
            headers["x-api-key"] = api_key
            url = _API_SEARCH_URL
        else:
            url = _PUBLIC_SEARCH_URL

        try:
            r = requests.get(url, headers=headers, params=params, timeout=60)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            # Contract: an empty list means "nothing matched", so a
            # transport failure has to propagate. See `base.StockSource`.
            _log.warning("NARA search failed: %s", e)
            raise

        hits = ((data.get("body") or {}).get("hits") or {}).get("hits") or []
        include_restricted = os.environ.get("NARA_INCLUDE_RESTRICTED") == "1"

        out: list[Candidate] = []
        for hit in hits:
            record = (hit.get("_source") or {}).get("record") or {}
            rights = rights_from_record(record)
            if not rights["cleared"] and not include_restricted:
                continue
            out.extend(self._extract_candidates(record, rights, kind, filters))
        return out

    def _extract_candidates(
        self, record: dict, rights: dict, kind: str, filters: SearchFilters
    ) -> list[Candidate]:
        """Extract downloadable candidates from a NARA catalog record."""
        naid = str(record.get("naId", "") or "")
        if not naid:
            return []

        title = record.get("title", "") or ""
        description = record.get("scopeAndContentNote", "") or ""
        shot_list = record.get("shotList", "") or ""
        source_tags = f"{title} {description} {shot_list}".strip()
        source_url = f"https://catalog.archives.gov/id/{naid}"
        local_id = record.get("localIdentifier", "") or ""
        dates = [d.get("logicalDate") for d in record.get("productionDates") or []]
        series = [
            a.get("title") for a in record.get("ancestors") or []
            if a.get("levelOfDescription") in ("series", "recordGroup", "collection")
        ]

        license_text = f"NARA use restriction: {rights['use_status']}"
        if rights["use_note"]:
            license_text += f" ({rights['use_note']})"

        # The same object is often listed twice, sometimes with a bogus
        # tiny size; keep one entry per URL, preferring the largest size.
        objects: dict[str, dict] = {}
        for obj in record.get("digitalObjects") or []:
            file_url = obj.get("objectUrl") or ""
            if not file_url:
                continue
            prev = objects.get(file_url)
            if prev is None or (obj.get("objectFileSize") or 0) > (prev.get("objectFileSize") or 0):
                objects[file_url] = obj

        out: list[Candidate] = []
        for file_url, obj in objects.items():
            otype = (obj.get("objectType", "") or "").lower()
            ext = file_url.rsplit(".", 1)[-1].lower() if "." in file_url else ""
            is_video = "video" in otype or "audio/visual" in otype or ext in _VIDEO_EXTS
            is_image = "image" in otype or ext in _IMAGE_EXTS

            if kind == "video" and not is_video:
                continue
            if kind == "image" and not is_image:
                continue
            if not is_video and not is_image:
                continue

            out.append(
                Candidate(
                    source=self.name,
                    source_id=f"{naid}_{obj.get('objectId', len(out))}",
                    source_url=source_url,
                    download_url=file_url,
                    kind="video" if is_video else "image",
                    creator="U.S. National Archives and Records Administration",
                    license=license_text,
                    source_tags=source_tags,
                    extra={
                        "naId": naid,
                        "local_identifier": local_id,
                        "title": title,
                        "production_dates": dates,
                        "series": series,
                        "sound_type": record.get("soundType", ""),
                        "object_type": obj.get("objectType", ""),
                        "fileSize": obj.get("objectFileSize"),
                        # Some records link a file named for a different
                        # record; treat a mismatch as unverified footage.
                        "filename_matches_identifier": bool(local_id) and (
                            local_id.lower() in file_url.rsplit("/", 1)[-1].lower()
                        ),
                        "rights": rights,
                    },
                )
            )

        return out

    def download(self, candidate: Candidate, out_path: Path) -> Path:
        import requests

        out_path = Path(out_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)

        with requests.get(
            candidate.download_url, stream=True, timeout=180
        ) as r:
            r.raise_for_status()
            with open(out_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 16):
                    if chunk:
                        f.write(chunk)
        return out_path
