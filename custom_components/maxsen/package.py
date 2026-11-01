"""Parse, validate, store and diff Maxsen home packages."""

from __future__ import annotations

import base64
import binascii
import json
import re
from pathlib import Path
from typing import Any, Literal

from homeassistant.core import HomeAssistant

from .const import MAX_PACKAGE_BYTES, PACKAGE_FORMAT, PACKAGE_SCHEMA_VERSION

PackageReason = Literal[
    "invalid_json",
    "wrong_format",
    "unsupported_version",
    "too_large",
    "missing_image",
]

# Image ids become file names, so they must not be able to leave the folder.
_SAFE_IMAGE_ID = re.compile(r"^[A-Za-z0-9._-]{1,200}$")

_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
}


class PackageError(Exception):
    """A home package was rejected."""

    def __init__(self, reason: PackageReason) -> None:
        super().__init__(reason)
        self.reason = reason


def parse_package(raw: bytes) -> dict:
    """Validate raw package bytes and return the package."""
    if len(raw) > MAX_PACKAGE_BYTES:
        raise PackageError("too_large")
    try:
        pkg = json.loads(raw)
    except ValueError as err:  # includes UnicodeDecodeError
        raise PackageError("invalid_json") from err
    if not isinstance(pkg, dict) or pkg.get("format") != PACKAGE_FORMAT:
        raise PackageError("wrong_format")
    if pkg.get("schemaVersion") != PACKAGE_SCHEMA_VERSION:
        raise PackageError("unsupported_version")

    try:
        images = pkg["images"]
        if not isinstance(images, dict):
            raise PackageError("wrong_format")
        for image_id, image in images.items():
            if (
                not _SAFE_IMAGE_ID.match(image_id)
                or not isinstance(image["mediaType"], str)
                or not isinstance(image["data"], str)
            ):
                raise PackageError("wrong_format")
        for level in pkg["levels"]:
            for plan in level["plans"]:
                if plan["background"]["imageId"] not in images:
                    raise PackageError("missing_image")
    except (KeyError, TypeError) as err:
        raise PackageError("wrong_format") from err
    return pkg


def _write_images(folder: Path, decoded: dict[str, tuple[str, bytes]]) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for file_name, (_, data) in decoded.items():
        (folder / file_name).write_bytes(data)


async def save_images(hass: HomeAssistant, entry_id: str, pkg: dict) -> dict:
    """Write the package images to disk and return the package without image data.

    The result has no ``images`` key; ``image_types`` maps image id to media type.
    """
    decoded: dict[str, tuple[str, bytes]] = {}
    image_types: dict[str, str] = {}
    for image_id, image in pkg["images"].items():
        media_type = image["mediaType"]
        try:
            data = base64.b64decode(image["data"], validate=True)
        except (binascii.Error, ValueError) as err:
            raise PackageError("wrong_format") from err
        ext = _EXTENSIONS.get(media_type, "bin")
        decoded[f"{image_id}.{ext}"] = (media_type, data)
        image_types[image_id] = media_type

    folder = Path(hass.config.path("maxsen", entry_id))
    await hass.async_add_executor_job(_write_images, folder, decoded)

    slim = {key: value for key, value in pkg.items() if key != "images"}
    slim["image_types"] = image_types
    return slim


def element_index(pkg: dict) -> dict[str, dict[str, Any]]:
    """Map element id to the element plus its level and plan."""
    index: dict[str, dict[str, Any]] = {}
    for level in pkg["levels"]:
        for plan in level["plans"]:
            for element in plan["elements"]:
                index[element["id"]] = {
                    **element,
                    "levelId": level["id"],
                    "planId": plan["id"],
                    "planType": plan["type"],
                }
    return index


def diff_packages(old: dict, new: dict) -> dict[str, list[str]]:
    """Compare two packages: added and removed element ids, redrawn plan ids."""
    old_elements = element_index(old)
    new_elements = element_index(new)
    old_revisions = {
        plan["id"]: plan["revision"]
        for level in old["levels"]
        for plan in level["plans"]
    }
    return {
        "added": [eid for eid in new_elements if eid not in old_elements],
        "removed": [eid for eid in old_elements if eid not in new_elements],
        "changed_drawings": [
            plan["id"]
            for level in new["levels"]
            for plan in level["plans"]
            if plan["id"] in old_revisions
            and old_revisions[plan["id"]] != plan["revision"]
        ],
    }
