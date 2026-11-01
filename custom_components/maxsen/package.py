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

# Image ids become file names and URL segments, so they must not be able to
# leave the folder. The image view serves exactly what this accepts.
IMAGE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

PLAN_TYPES = ("smart-home", "lighting")

# The only image types a package may carry, with the extension they are saved as.
IMAGE_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}


class PackageError(Exception):
    """A home package was rejected."""

    def __init__(self, reason: PackageReason) -> None:
        super().__init__(reason)
        self.reason = reason


def _check(condition: bool) -> None:
    if not condition:
        raise PackageError("wrong_format")


def _is_str(value: Any) -> bool:
    return isinstance(value, str)


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _validate_structure(pkg: dict) -> None:
    """Check the fields the rest of the integration relies on (wrong_format if absent)."""
    project = pkg.get("project")
    _check(isinstance(project, dict))
    _check(_is_str(project.get("id")) and _is_str(project.get("title")))

    images = pkg.get("images")
    _check(isinstance(images, dict))
    for image_id, image in images.items():
        _check(bool(IMAGE_ID_PATTERN.match(image_id)))
        _check(isinstance(image, dict))
        media_type = image.get("mediaType")
        _check(_is_str(media_type) and media_type in IMAGE_EXTENSIONS)
        _check(_is_str(image.get("data")))

    levels = pkg.get("levels")
    _check(isinstance(levels, list))
    for level in levels:
        _check(isinstance(level, dict))
        _check(_is_str(level.get("id")) and _is_str(level.get("name")))
        plans = level.get("plans")
        _check(isinstance(plans, list))
        for plan in plans:
            _check(isinstance(plan, dict))
            _check(_is_str(plan.get("id")))
            _check(plan.get("type") in PLAN_TYPES)
            _check(_is_int(plan.get("revision")))
            background = plan.get("background")
            _check(isinstance(background, dict))
            image_id = background.get("imageId")
            _check(_is_str(image_id) and bool(IMAGE_ID_PATTERN.match(image_id)))
            elements = plan.get("elements")
            _check(isinstance(elements, list))
            for element in elements:
                _check(isinstance(element, dict) and _is_str(element.get("id")))


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

    _validate_structure(pkg)
    images = pkg["images"]
    for level in pkg["levels"]:
        for plan in level["plans"]:
            if plan["background"]["imageId"] not in images:
                raise PackageError("missing_image")
    for image in images.values():
        try:
            base64.b64decode(image["data"], validate=True)
        except (binascii.Error, ValueError) as err:
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
        if media_type not in IMAGE_EXTENSIONS or not IMAGE_ID_PATTERN.match(image_id):
            raise PackageError("wrong_format")
        ext = IMAGE_EXTENSIONS[media_type]
        decoded[f"{image_id}.{ext}"] = (media_type, data)
        image_types[image_id] = media_type

    folder = Path(hass.config.path("maxsen", entry_id))
    await hass.async_add_executor_job(_write_images, folder, decoded)

    slim = {key: value for key, value in pkg.items() if key != "images"}
    slim["image_types"] = image_types
    return slim


def _remove_unreferenced(folder: Path, keep: set[str]) -> None:
    if not folder.is_dir():
        return
    for path in folder.iterdir():
        if path.is_file() and path.name not in keep:
            path.unlink()


async def remove_unreferenced_images(
    hass: HomeAssistant, entry_id: str, slim: dict
) -> None:
    """Delete saved image files that the (slim) package no longer references."""
    keep = {
        f"{image_id}.{IMAGE_EXTENSIONS[media_type]}"
        for image_id, media_type in slim["image_types"].items()
    }
    folder = Path(hass.config.path("maxsen", entry_id))
    await hass.async_add_executor_job(_remove_unreferenced, folder, keep)


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


def describe_changes(old: dict | None, new: dict) -> dict[str, list[dict[str, str]]]:
    """What changes from ``old`` to ``new``, with names an installer recognises.

    Removed elements are described from the old package, added ones from the new.
    """
    old = old or {"levels": []}
    diff = diff_packages(old, new)
    old_elements = element_index(old)
    new_elements = element_index(new)
    old_levels = {level["id"]: level["name"] for level in old["levels"]}
    new_levels = {level["id"]: level["name"] for level in new["levels"]}

    def element(element_id: str, elements: dict, levels: dict) -> dict[str, str]:
        found = elements[element_id]
        return {
            "id": element_id,
            "productName": found.get("productName", ""),
            "label": found.get("label", ""),
            "levelName": levels[found["levelId"]],
        }

    plans = {
        plan["id"]: (level["name"], plan["type"])
        for level in new["levels"]
        for plan in level["plans"]
    }
    return {
        "added": [element(i, new_elements, new_levels) for i in diff["added"]],
        "removed": [element(i, old_elements, old_levels) for i in diff["removed"]],
        "changed_drawings": [
            {"planId": plan_id, "levelName": plans[plan_id][0], "type": plans[plan_id][1]}
            for plan_id in diff["changed_drawings"]
        ],
    }
