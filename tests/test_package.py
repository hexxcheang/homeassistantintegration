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
    assert set(pkg["images"]) == {"img-1", "img-2"}


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
    del home_package["images"]["img-2"]
    assert reason_of(to_raw(home_package)) == "missing_image"


def test_malformed_structure_is_wrong_format(home_package):
    del home_package["levels"][0]["plans"][0]["background"]
    assert reason_of(to_raw(home_package)) == "wrong_format"


def test_unsafe_image_id_is_wrong_format(home_package):
    home_package["images"]["../evil"] = home_package["images"]["img-1"]
    home_package["levels"][0]["plans"][0]["background"]["imageId"] = "../evil"
    assert reason_of(to_raw(home_package)) == "wrong_format"


async def test_save_images_writes_files_and_strips_data(hass, home_package, tmp_path):
    hass.config.config_dir = str(tmp_path)
    original = copy.deepcopy(home_package)

    saved = await save_images(hass, "entry1", home_package)

    folder = tmp_path / "maxsen" / "entry1"
    assert sorted(p.name for p in folder.iterdir()) == ["img-1.png", "img-2.png"]
    assert (folder / "img-1.png").read_bytes() == base64.b64decode(
        original["images"]["img-1"]["data"]
    )
    assert "images" not in saved
    assert saved["image_types"] == {"img-1": "image/png", "img-2": "image/png"}
    assert "data" not in json.dumps(saved["levels"]) + json.dumps(saved["image_types"])
    assert saved["levels"] == original["levels"]
    assert saved["project"] == original["project"]
    # The input package is left untouched.
    assert home_package == original


async def test_save_images_extension_follows_media_type(hass, home_package, tmp_path):
    hass.config.config_dir = str(tmp_path)
    home_package["images"]["img-1"]["mediaType"] = "image/jpeg"
    home_package["images"]["img-2"]["mediaType"] = "application/x-weird"

    saved = await save_images(hass, "entry1", home_package)

    folder = tmp_path / "maxsen" / "entry1"
    assert sorted(p.name for p in folder.iterdir()) == ["img-1.jpg", "img-2.bin"]
    assert saved["image_types"] == {
        "img-1": "image/jpeg",
        "img-2": "application/x-weird",
    }


async def test_save_images_bad_base64_writes_nothing(hass, home_package, tmp_path):
    hass.config.config_dir = str(tmp_path)
    home_package["images"]["img-2"]["data"] = "***not base64***"

    with pytest.raises(PackageError) as err:
        await save_images(hass, "entry1", home_package)

    assert err.value.reason == "wrong_format"
    assert not (tmp_path / "maxsen").exists()


def test_element_index(home_package):
    index = element_index(home_package)
    assert set(index) == {"e1", "e2", "e3", "e4", "e5"}
    assert index["e2"]["levelId"] == "level-1"
    assert index["e2"]["planId"] == "plan-1-lt"
    assert index["e2"]["planType"] == "lighting"
    assert index["e2"]["categoryId"] == "downlights"
    assert index["e5"]["levelId"] == "level-2"
    assert index["e5"]["planType"] == "smart-home"


def test_diff_packages_detects_added_removed_and_changed(home_package):
    new = copy.deepcopy(home_package)
    # remove e3, add e6 and bump the revision of the level 2 plan
    lighting = new["levels"][0]["plans"][1]
    lighting["elements"] = [e for e in lighting["elements"] if e["id"] != "e3"]
    lighting["elements"].append(
        {**lighting["elements"][0], "id": "e6", "label": "Hall light"}
    )
    new["levels"][1]["plans"][0]["revision"] += 1

    assert diff_packages(home_package, new) == {
        "added": ["e6"],
        "removed": ["e3"],
        "changed_drawings": ["plan-2-sh"],
    }


def test_diff_identical_packages_is_empty(home_package):
    assert diff_packages(home_package, copy.deepcopy(home_package)) == {
        "added": [],
        "removed": [],
        "changed_drawings": [],
    }
