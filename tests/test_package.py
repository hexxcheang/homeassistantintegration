"""Tests for home package parsing, image saving and diffing."""

import base64
import copy
import json
from pathlib import Path

import pytest

from custom_components.maxsen.package import (
    PackageError,
    diff_packages,
    element_index,
    parse_package,
    save_images,
)

MAX_BYTES = 100 * 1024 * 1024


def to_raw(pkg: dict) -> bytes:
    return json.dumps(pkg).encode()


def reason_of(raw: bytes) -> str:
    with pytest.raises(PackageError) as err:
        parse_package(raw)
    return err.value.reason


def test_valid_fixture_parses(home_package):
    pkg = parse_package(to_raw(home_package))
    assert pkg["format"] == "maxsen-home"
    assert [level["name"] for level in pkg["levels"]] == ["Level 1", "Level 2"]
    assert set(pkg["images"]) == {"file-l1", "file-l2"}


def test_invalid_json():
    assert reason_of(b"{") == "invalid_json"


def test_non_object_json_is_wrong_format():
    assert reason_of(b"[1, 2]") == "wrong_format"


def test_wrong_format(home_package):
    home_package["format"] = "other"
    assert reason_of(to_raw(home_package)) == "wrong_format"


def test_unsupported_version(home_package):
    home_package["schemaVersion"] = 2
    assert reason_of(to_raw(home_package)) == "unsupported_version"


def test_too_large():
    assert reason_of(b"x" * (MAX_BYTES + 1)) == "too_large"


def test_exactly_the_limit_is_not_too_large():
    # Not valid JSON, but the size check must not trigger at the limit.
    assert reason_of(b"x" * MAX_BYTES) == "invalid_json"


def test_missing_image(home_package):
    del home_package["images"]["file-l2"]
    assert reason_of(to_raw(home_package)) == "missing_image"


def _drop(pkg, path):
    """Delete the key at ``path`` (a list of keys/indexes) from ``pkg``."""
    node = pkg
    for key in path[:-1]:
        node = node[key]
    del node[path[-1]]


MISSING_FIELDS = {
    "project": ["project"],
    "project id": ["project", "id"],
    "project title": ["project", "title"],
    "images": ["images"],
    "image data": ["images", "file-l1", "data"],
    "image mediaType": ["images", "file-l1", "mediaType"],
    "levels": ["levels"],
    "level id": ["levels", 0, "id"],
    "level name": ["levels", 0, "name"],
    "level plans": ["levels", 0, "plans"],
    "plan id": ["levels", 0, "plans", 0, "id"],
    "plan type": ["levels", 0, "plans", 0, "type"],
    "plan revision": ["levels", 0, "plans", 0, "revision"],
    "plan background": ["levels", 0, "plans", 0, "background"],
    "plan background imageId": ["levels", 0, "plans", 0, "background", "imageId"],
    "plan elements": ["levels", 0, "plans", 0, "elements"],
    "element id": ["levels", 0, "plans", 0, "elements", 0, "id"],
}


@pytest.mark.parametrize("path", MISSING_FIELDS.values(), ids=MISSING_FIELDS.keys())
def test_missing_required_field_is_wrong_format(home_package, path):
    _drop(home_package, path)
    assert reason_of(to_raw(home_package)) == "wrong_format"


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (["levels"], {"not": "a list"}),
        (["levels", 0], "level"),
        (["levels", 0, "plans", 0], None),
        (["levels", 0, "plans", 0, "type"], "elevation"),
        (["levels", 0, "plans", 0, "revision"], "2"),
        (["levels", 0, "plans", 0, "revision"], True),
        (["levels", 0, "plans", 0, "elements"], {"id": "x"}),
        (["levels", 0, "plans", 0, "elements", 0], "sw1"),
        (["levels", 0, "plans", 0, "elements", 0, "id"], 5),
        (["images", "file-l1"], "data"),
    ],
)
def test_wrong_field_type_is_wrong_format(home_package, path, value):
    node = home_package
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value
    assert reason_of(to_raw(home_package)) == "wrong_format"


def test_validated_package_never_breaks_element_index_or_diff(home_package):
    pkg = parse_package(to_raw(home_package))
    assert diff_packages(pkg, pkg) == {
        "added": [],
        "removed": [],
        "changed_drawings": [],
    }


def test_unsafe_image_id_is_wrong_format(home_package):
    home_package["images"]["../evil"] = home_package["images"]["file-l1"]
    home_package["levels"][0]["plans"][0]["background"]["imageId"] = "../evil"
    assert reason_of(to_raw(home_package)) == "wrong_format"


async def test_save_images_writes_files_and_strips_data(hass, home_package, tmp_path):
    hass.config.config_dir = str(tmp_path)
    original = copy.deepcopy(home_package)

    saved = await save_images(hass, "entry1", home_package)

    folder = tmp_path / "maxsen" / "entry1"
    assert sorted(p.name for p in folder.iterdir()) == ["file-l1.png", "file-l2.png"]
    assert (folder / "file-l1.png").read_bytes() == base64.b64decode(
        original["images"]["file-l1"]["data"]
    )
    assert "images" not in saved
    assert saved["image_types"] == {"file-l1": "image/png", "file-l2": "image/png"}
    assert "data" not in json.dumps(saved["levels"]) + json.dumps(saved["image_types"])
    assert saved["levels"] == original["levels"]
    assert saved["project"] == original["project"]
    # The input package is left untouched.
    assert home_package == original


async def test_save_images_extension_follows_media_type(hass, home_package, tmp_path):
    hass.config.config_dir = str(tmp_path)
    home_package["images"]["file-l1"]["mediaType"] = "image/jpeg"
    home_package["images"]["file-l2"]["mediaType"] = "image/webp"

    saved = await save_images(hass, "entry1", home_package)

    folder = tmp_path / "maxsen" / "entry1"
    assert sorted(p.name for p in folder.iterdir()) == ["file-l1.jpg", "file-l2.webp"]
    assert saved["image_types"] == {
        "file-l1": "image/jpeg",
        "file-l2": "image/webp",
    }


def _rename_image(pkg, old, new):
    pkg["images"][new] = pkg["images"].pop(old)
    for level in pkg["levels"]:
        for plan in level["plans"]:
            if plan["background"]["imageId"] == old:
                plan["background"]["imageId"] = new


@pytest.mark.parametrize("image_id", ["floor.1", "x" * 65, "a b", "a/b", ""])
def test_parse_rejects_image_ids_the_image_view_would_not_serve(home_package, image_id):
    _rename_image(home_package, "file-l1", image_id)
    assert reason_of(to_raw(home_package)) == "wrong_format"


def test_parse_accepts_the_longest_allowed_image_id(home_package):
    _rename_image(home_package, "file-l1", "A_b-" * 16)
    assert parse_package(to_raw(home_package))


def test_parse_rejects_a_background_image_id_outside_the_pattern(home_package):
    home_package["levels"][0]["plans"][0]["background"]["imageId"] = "floor.1"
    home_package["images"]["floor.1"] = home_package["images"]["file-l1"]
    del home_package["images"]["file-l1"]
    assert reason_of(to_raw(home_package)) == "wrong_format"


@pytest.mark.parametrize(
    "media_type", ["image/gif", "image/jpg", "image/svg+xml", "text/html", ""]
)
def test_parse_rejects_media_types_outside_png_jpeg_webp(home_package, media_type):
    home_package["images"]["file-l1"]["mediaType"] = media_type
    assert reason_of(to_raw(home_package)) == "wrong_format"


@pytest.mark.parametrize("media_type", [["image/png"], {}, None, 5])
def test_parse_rejects_a_non_string_media_type_as_wrong_format(home_package, media_type):
    home_package["images"]["file-l1"]["mediaType"] = media_type
    assert reason_of(to_raw(home_package)) == "wrong_format"


@pytest.mark.parametrize("media_type", ["image/png", "image/jpeg", "image/webp"])
def test_parse_accepts_png_jpeg_webp(home_package, media_type):
    home_package["images"]["file-l1"]["mediaType"] = media_type
    assert parse_package(to_raw(home_package))


async def test_save_images_refuses_a_type_it_has_no_extension_for(
    hass, home_package, tmp_path
):
    hass.config.config_dir = str(tmp_path)
    home_package["images"]["file-l1"]["mediaType"] = "image/gif"
    with pytest.raises(PackageError) as err:
        await save_images(hass, "entry1", home_package)
    assert err.value.reason == "wrong_format"
    assert not (tmp_path / "maxsen").exists()


async def test_save_images_bad_base64_writes_nothing(hass, home_package, tmp_path):
    hass.config.config_dir = str(tmp_path)
    home_package["images"]["file-l2"]["data"] = "***not base64***"

    with pytest.raises(PackageError) as err:
        await save_images(hass, "entry1", home_package)

    assert err.value.reason == "wrong_format"
    assert not (tmp_path / "maxsen").exists()


def test_corrupt_base64_is_wrong_format(home_package):
    home_package["images"]["file-l2"]["data"] = "***not base64***"
    assert reason_of(to_raw(home_package)) == "wrong_format"


def test_element_index(home_package):
    index = element_index(home_package)
    assert set(index) == {
        "sw1", "sen1", "cur1", "dl1", "dl2", "dl3", "led1", "sen2",
    }  # fmt: skip
    assert index["dl2"]["levelId"] == "level-1"
    assert index["dl2"]["planId"] == "plan-1-lt"
    assert index["dl2"]["planType"] == "lighting"
    assert index["dl2"]["categoryId"] == "downlights"
    assert index["cur1"]["kind"] == "curtain"
    assert index["cur1"]["planType"] == "smart-home"
    assert index["sen2"]["levelId"] == "level-2"
    assert index["sen2"]["planId"] == "plan-2-sh"


def test_diff_packages_detects_added_removed_and_changed(home_package):
    new = copy.deepcopy(home_package)
    # remove dl3, add dl4 and bump the revision of the level 2 plan
    lighting = new["levels"][0]["plans"][1]
    lighting["elements"] = [e for e in lighting["elements"] if e["id"] != "dl3"]
    lighting["elements"].append({**lighting["elements"][0], "id": "dl4"})
    new["levels"][1]["plans"][0]["revision"] += 1

    assert diff_packages(home_package, new) == {
        "added": ["dl4"],
        "removed": ["dl3"],
        "changed_drawings": ["plan-2-sh"],
    }


def test_diff_identical_packages_is_empty(home_package):
    assert diff_packages(home_package, copy.deepcopy(home_package)) == {
        "added": [],
        "removed": [],
        "changed_drawings": [],
    }
