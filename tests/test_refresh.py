"""Tests for maxsen/refresh/preview and maxsen/refresh/apply."""

import asyncio
import copy
import json
import threading
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.maxsen.const import DOMAIN
from custom_components.maxsen.store import MaxsenStore

BASE = "https://planner.example.com"
HOME_URL = f"{BASE}/api/public/home-assistant/home"
PROJECT_ID = "proj-test-house"
FILE_ID = "0e8f2c1a-5b7d-4f6a-9c3e-1b2d4a6c8e0f"


async def setup_entry(
    hass, package, *, source="planner", installer_mode=True
) -> MockConfigEntry:
    data = {"source": source, "project_id": PROJECT_ID, "title": "Test House"}
    if source == "planner":
        data |= {"planner_url": BASE, "token": "secret-token"}
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id=PROJECT_ID,
        title="Test House",
        data=data,
        options={"installer_mode": installer_mode},
    )
    entry.add_to_hass(hass)
    hass.data.setdefault(DOMAIN, {}).setdefault("pending", {})[PROJECT_ID] = package
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


@pytest.fixture
async def entry(hass, home_package) -> MockConfigEntry:
    """A planner-paired home with links, a quick panel and an all-off scene entity."""
    entry = await setup_entry(hass, home_package)
    await entry.runtime_data.async_set_links(
        {
            "dl1": {"type": "entity", "id": "light.one"},
            "dl2": {"type": "entity", "id": "light.two"},
            "sw1": {"type": "device", "id": "dev-sw1"},
            "sen2": {"type": "device", "id": "dev-sen2"},
        }
    )
    await entry.runtime_data.async_set_quick_panel(
        [
            {"type": "element", "id": "dl2"},
            {"type": "element", "id": "sw1"},
            {"type": "entity", "id": "scene.all_off"},
        ]
    )
    return entry


def changed_package(home_package) -> dict:
    """The fixture with dl2 and all of level 2 gone, dl9 added and lighting redrawn."""
    pkg = copy.deepcopy(home_package)
    pkg["levels"] = pkg["levels"][:1]
    del pkg["images"]["file-l2"]
    lighting = next(p for p in pkg["levels"][0]["plans"] if p["type"] == "lighting")
    lighting["elements"] = [e for e in lighting["elements"] if e["id"] != "dl2"]
    lighting["elements"].append(
        {**lighting["elements"][0], "id": "dl9", "label": "Porch light"}
    )
    lighting["revision"] += 1
    return pkg


async def call(ws, type_, **fields):
    await ws.send_json_auto_id({"type": type_, **fields})
    return await ws.receive_json()


async def preview(ws, entry, **fields):
    return await call(ws, "maxsen/refresh/preview", entry_id=entry.entry_id, **fields)


async def apply(ws, entry, preview_id):
    return await call(
        ws, "maxsen/refresh/apply", entry_id=entry.entry_id, preview_id=preview_id
    )


def image_files(hass, entry) -> set[str]:
    return {p.name for p in Path(hass.config.path("maxsen", entry.entry_id)).iterdir()}


def upload_file(tmp_path: Path, content: bytes):
    """Patch the uploaded-file helper so it serves ``content``."""
    path = tmp_path / "home.json"
    path.write_bytes(content)

    class _Uploaded:
        def __enter__(self):
            return path

        def __exit__(self, *exc):
            return False

    return patch(
        "custom_components.maxsen.websocket.process_uploaded_file",
        return_value=_Uploaded(),
    )


# --------------------------------------------------------------- preview


async def test_preview_fetches_with_the_stored_token_and_summarises(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    aioclient_mock.get(HOME_URL, json=changed_package(home_package))
    ws = await hass_ws_client()

    resp = await preview(ws, entry)

    assert resp["success"]
    assert aioclient_mock.mock_calls[0][3]["Authorization"] == "Bearer secret-token"
    result = resp["result"]
    assert isinstance(result["preview_id"], str) and result["preview_id"]
    assert result["added"] == [
        {
            "id": "dl9",
            "productName": "Luna Downlight",
            "label": "Porch light",
            "levelName": "Level 1",
        }
    ]
    # Removed elements are described from the old package.
    assert sorted(result["removed"], key=lambda e: e["id"]) == [
        {
            "id": "dl2",
            "productName": "Luna Downlight",
            "label": "",
            "levelName": "Level 1",
        },
        {
            "id": "sen2",
            "productName": "Motion Sensor",
            "label": "",
            "levelName": "Level 2",
        },
    ]
    assert result["changed_drawings"] == [
        {"planId": "plan-1-lt", "levelName": "Level 1", "type": "lighting"}
    ]


async def test_preview_of_an_identical_home_is_empty(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    aioclient_mock.get(HOME_URL, json=home_package)
    ws = await hass_ws_client()
    resp = await preview(ws, entry)
    assert resp["result"] == {
        "preview_id": resp["result"]["preview_id"],
        "added": [],
        "removed": [],
        "changed_drawings": [],
    }


async def test_preview_changes_nothing(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    before = copy.deepcopy(entry.runtime_data.data)
    files = image_files(hass, entry)
    aioclient_mock.get(HOME_URL, json=changed_package(home_package))
    ws = await hass_ws_client()

    assert (await preview(ws, entry))["success"]

    assert entry.runtime_data.data == before
    assert image_files(hass, entry) == files


@pytest.mark.parametrize(
    ("mock", "code", "message"),
    [
        (
            {"status": 401, "json": {"error": "revoked"}},
            "revoked",
            (
                "Connection revoked: ask Maxsen for a new pairing code, then use "
                "Reconfigure on the Maxsen Home integration."
            ),
        ),
        (
            {"status": 401, "json": {"error": "unknown"}},
            "revoked",
            (
                "Connection revoked: ask Maxsen for a new pairing code, then use "
                "Reconfigure on the Maxsen Home integration."
            ),
        ),
        (
            {"status": 429, "json": {"error": "too-many"}},
            "too_many",
            "The planner is busy. Try again in 15 minutes.",
        ),
        ({"exc": TimeoutError()}, "cannot_connect", "Can't reach the planner"),
        ({"status": 500}, "cannot_connect", "Can't reach the planner"),
        (
            {"status": 409, "json": {"error": "not-saved", "message": "Save the project first"}},
            "not_ready",
            "Save the project first",
        ),
    ],
)
async def test_planner_errors_leave_the_home_unchanged(
    hass, hass_ws_client, aioclient_mock, entry, mock, code, message
):
    before = copy.deepcopy(entry.runtime_data.data)
    files = image_files(hass, entry)
    aioclient_mock.get(HOME_URL, **mock)
    ws = await hass_ws_client()

    resp = await preview(ws, entry)

    assert not resp["success"]
    assert resp["error"]["code"] == code
    assert resp["error"]["message"] == message
    assert entry.runtime_data.data == before
    assert entry.runtime_data.data["links"]["dl2"] == {"type": "entity", "id": "light.two"}
    assert image_files(hass, entry) == files


async def test_an_unusable_package_is_invalid_package_with_the_reason(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    aioclient_mock.get(HOME_URL, json={**home_package, "schemaVersion": 2})
    ws = await hass_ws_client()

    resp = await preview(ws, entry)

    assert resp["error"]["code"] == "invalid_package"
    assert "unsupported_version" in resp["error"]["message"]


async def test_garbage_from_the_planner_is_invalid_package(
    hass, hass_ws_client, aioclient_mock, entry
):
    aioclient_mock.get(HOME_URL, text="<html>proxy error</html>")
    ws = await hass_ws_client()
    resp = await preview(ws, entry)
    assert resp["error"]["code"] == "invalid_package"
    assert "invalid_json" in resp["error"]["message"]


# ------------------------------------------------ who may refresh, and which home


async def test_refresh_needs_an_admin_and_never_calls_the_planner(
    hass, hass_ws_client, hass_read_only_access_token, aioclient_mock, entry
):
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    for resp in (
        await preview(ws, entry),
        await apply(ws, entry, "whatever"),
    ):
        assert not resp["success"]
        assert resp["error"]["code"] == "not_allowed"
    assert aioclient_mock.call_count == 0


async def test_refresh_needs_installer_mode(
    hass, hass_ws_client, aioclient_mock, home_package
):
    entry = await setup_entry(hass, home_package, installer_mode=False)
    ws = await hass_ws_client()
    for resp in (await preview(ws, entry), await apply(ws, entry, "whatever")):
        assert resp["error"]["code"] == "not_allowed"
    assert aioclient_mock.call_count == 0


async def test_refresh_of_an_unknown_home_is_not_found(hass, hass_ws_client, entry):
    ws = await hass_ws_client()
    resp = await call(ws, "maxsen/refresh/preview", entry_id="does-not-exist")
    assert resp["error"]["code"] == "not_found"
    resp = await call(
        ws, "maxsen/refresh/apply", entry_id="does-not-exist", preview_id="x"
    )
    assert resp["error"]["code"] == "not_found"


# ------------------------------------------------------------------ apply


async def test_apply_saves_the_new_home_and_drops_what_belonged_to_removed_elements(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    aioclient_mock.get(HOME_URL, json=changed_package(home_package))
    ws = await hass_ws_client()
    previewed = (await preview(ws, entry))["result"]

    resp = await apply(ws, entry, previewed["preview_id"])

    assert resp["success"]
    assert resp["result"] == previewed
    removed_ids = {e["id"] for e in resp["result"]["removed"]}
    assert removed_ids == {"dl2", "sen2"}

    data = entry.runtime_data.data
    # Links and quick-panel items of removed elements are gone, the others kept.
    assert data["links"] == {
        "dl1": {"type": "entity", "id": "light.one"},
        "sw1": {"type": "device", "id": "dev-sw1"},
    }
    assert data["quick_panel"] == [
        {"type": "element", "id": "sw1"},
        {"type": "entity", "id": "scene.all_off"},
    ]
    # The new package is the saved one, without image data.
    assert [level["id"] for level in data["package"]["levels"]] == ["level-1"]
    assert "images" not in data["package"]
    assert data["package"]["image_types"] == {"file-l1": "image/png"}

    # It is persisted, not just in memory.
    reloaded = MaxsenStore(hass, entry.entry_id)
    await reloaded.async_load()
    assert reloaded.data["links"] == data["links"]
    assert reloaded.data["quick_panel"] == data["quick_panel"]
    assert [lv["id"] for lv in reloaded.data["package"]["levels"]] == ["level-1"]


async def test_apply_replaces_the_images_folder_contents(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    assert image_files(hass, entry) == {"file-l1.png", "file-l2.png"}
    new = changed_package(home_package)
    aioclient_mock.get(HOME_URL, json=new)
    ws = await hass_ws_client()
    previewed = (await preview(ws, entry))["result"]
    # Nothing is touched until apply.
    assert image_files(hass, entry) == {"file-l1.png", "file-l2.png"}

    assert (await apply(ws, entry, previewed["preview_id"]))["success"]

    assert image_files(hass, entry) == {"file-l1.png"}


async def test_apply_keeps_links_for_surviving_elements(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    aioclient_mock.get(HOME_URL, json=home_package)
    ws = await hass_ws_client()
    previewed = (await preview(ws, entry))["result"]
    before = copy.deepcopy(entry.runtime_data.data)

    assert (await apply(ws, entry, previewed["preview_id"]))["success"]

    assert entry.runtime_data.data["links"] == before["links"]
    assert entry.runtime_data.data["quick_panel"] == before["quick_panel"]


async def test_apply_announces_home_links_and_quick_panel(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    aioclient_mock.get(HOME_URL, json=changed_package(home_package))
    ws = await hass_ws_client()
    await ws.send_json_auto_id({"type": "maxsen/subscribe", "entry_id": entry.entry_id})
    assert (await ws.receive_json())["success"]
    bus_events = async_capture_events(hass, "maxsen_quick_panel_updated")
    previewed = (await preview(ws, entry))["result"]

    await ws.send_json_auto_id(
        {
            "type": "maxsen/refresh/apply",
            "entry_id": entry.entry_id,
            "preview_id": previewed["preview_id"],
        }
    )
    # Three events and the result, in whatever order they arrive.
    received = [await ws.receive_json() for _ in range(4)]
    assert [m["success"] for m in received if m["type"] == "result"] == [True]
    events = [m["event"]["event"] for m in received if m["type"] == "event"]
    assert sorted(events) == ["home", "links", "quick_panel"]
    assert len(bus_events) == 1


async def test_a_failed_save_reports_save_failed_and_keeps_the_old_home(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    aioclient_mock.get(HOME_URL, json=changed_package(home_package))
    ws = await hass_ws_client()
    previewed = (await preview(ws, entry))["result"]
    before = copy.deepcopy(entry.runtime_data.data)

    with patch(
        "custom_components.maxsen.websocket.save_images", side_effect=OSError("disk full")
    ):
        resp = await apply(ws, entry, previewed["preview_id"])

    assert resp["error"]["code"] == "save_failed"
    assert entry.runtime_data.data == before


async def test_a_failed_store_save_leaves_memory_as_it_was(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    aioclient_mock.get(HOME_URL, json=changed_package(home_package))
    ws = await hass_ws_client()
    previewed = (await preview(ws, entry))["result"]
    before = copy.deepcopy(entry.runtime_data.data)

    with patch(
        "homeassistant.helpers.storage.Store.async_save", side_effect=OSError("disk full")
    ):
        resp = await apply(ws, entry, previewed["preview_id"])

    assert resp["error"]["code"] == "save_failed"
    data = entry.runtime_data.data
    assert data["package"] == before["package"]
    assert data["links"] == before["links"]
    assert data["quick_panel"] == before["quick_panel"]


async def test_overlapping_applies_never_delete_each_others_images(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    first = changed_package(home_package)
    second = copy.deepcopy(home_package)
    second["images"]["file-l3"] = second["images"]["file-l2"]
    second["levels"][1]["plans"][0]["background"]["imageId"] = "file-l3"
    del second["images"]["file-l2"]
    second["levels"][1]["plans"][0]["revision"] += 1

    reached, release = threading.Event(), threading.Event()
    import custom_components.maxsen.package as package_module

    real_cleanup = package_module._remove_unreferenced
    calls = []

    def slow_first_cleanup(folder, keep):
        calls.append(keep)
        if len(calls) == 1:  # the first apply stalls while deleting old images
            reached.set()
            release.wait(5)
        real_cleanup(folder, keep)

    ws = await hass_ws_client()
    aioclient_mock.get(HOME_URL, json=first)
    id_a = (await preview(ws, entry))["result"]["preview_id"]
    with patch.object(package_module, "_remove_unreferenced", slow_first_cleanup):
        await ws.send_json_auto_id(
            {"type": "maxsen/refresh/apply", "entry_id": entry.entry_id, "preview_id": id_a}
        )
        assert await hass.async_add_executor_job(reached.wait, 5)

        aioclient_mock.clear_requests()
        aioclient_mock.get(HOME_URL, json=second)
        id_b = (await preview(ws, entry))["result"]["preview_id"]
        await ws.send_json_auto_id(
            {"type": "maxsen/refresh/apply", "entry_id": entry.entry_id, "preview_id": id_b}
        )
        await asyncio.sleep(0.1)  # let the second apply run as far as it can
        release.set()
        results = [await ws.receive_json(), await ws.receive_json()]

    assert all(r["success"] for r in results), results
    package = entry.runtime_data.data["package"]
    expected = {f"{image_id}.png" for image_id in package["image_types"]}
    assert expected  # the final home has images
    assert image_files(hass, entry) == expected


async def test_edits_made_while_an_apply_is_saving_are_not_lost(
    hass, hass_ws_client, hass_read_only_access_token, aioclient_mock, entry, home_package
):
    aioclient_mock.get(HOME_URL, json=changed_package(home_package))
    admin_ws = await hass_ws_client()
    user_ws = await hass_ws_client(hass, hass_read_only_access_token)
    previewed = (await preview(admin_ws, entry))["result"]

    from homeassistant.helpers.storage import Store

    real_save = Store.async_save
    reached, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def stalled_first_save(self, data):
        calls.append(data)
        if len(calls) == 1:  # the apply's own save
            reached.set()
            await release.wait()
        return await real_save(self, data)

    new_link = {"type": "device", "id": "dev-replaced"}
    new_item = {"type": "entity", "id": "scene.movie_night"}
    with patch.object(Store, "async_save", stalled_first_save):
        await admin_ws.send_json_auto_id(
            {
                "type": "maxsen/refresh/apply",
                "entry_id": entry.entry_id,
                "preview_id": previewed["preview_id"],
            }
        )
        await asyncio.wait_for(reached.wait(), 5)
        await user_ws.send_json_auto_id(
            {
                "type": "maxsen/quick_panel/set",
                "entry_id": entry.entry_id,
                "items": [{"type": "element", "id": "sw1"}, new_item],
            }
        )
        await admin_ws.send_json_auto_id(
            {
                "type": "maxsen/links/set",
                "entry_id": entry.entry_id,
                "updates": {"sw1": new_link},
            }
        )
        await asyncio.sleep(0.1)  # let both edits run as far as they can
        release.set()
        results = [await admin_ws.receive_json(), await admin_ws.receive_json()]
        results.append(await user_ws.receive_json())

    assert all(r["success"] for r in results), results

    reloaded = MaxsenStore(hass, entry.entry_id)
    await reloaded.async_load()
    for data in (entry.runtime_data.data, reloaded.data):
        assert [level["id"] for level in data["package"]["levels"]] == ["level-1"]
        assert data["links"]["sw1"] == new_link
        assert "dl2" not in data["links"]  # still pruned by the apply
        assert data["quick_panel"] == [{"type": "element", "id": "sw1"}, new_item]


# ------------------------------------------------------- the preview lifetime


async def test_apply_with_an_unknown_preview_is_preview_expired(
    hass, hass_ws_client, entry
):
    ws = await hass_ws_client()
    resp = await apply(ws, entry, "no-such-preview")
    assert not resp["success"]
    assert resp["error"]["code"] == "preview_expired"


async def test_a_preview_can_only_be_applied_once(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    aioclient_mock.get(HOME_URL, json=changed_package(home_package))
    ws = await hass_ws_client()
    previewed = (await preview(ws, entry))["result"]
    assert (await apply(ws, entry, previewed["preview_id"]))["success"]
    resp = await apply(ws, entry, previewed["preview_id"])
    assert resp["error"]["code"] == "preview_expired"


async def test_a_preview_expires_after_ten_minutes(
    hass, hass_ws_client, aioclient_mock, entry, home_package, freezer
):
    aioclient_mock.get(HOME_URL, json=changed_package(home_package))
    ws = await hass_ws_client()
    previewed = (await preview(ws, entry))["result"]

    freezer.tick(timedelta(minutes=10, seconds=1))
    resp = await apply(ws, entry, previewed["preview_id"])

    assert resp["error"]["code"] == "preview_expired"
    assert entry.runtime_data.data["links"]["dl2"] == {"type": "entity", "id": "light.two"}


async def test_a_preview_still_works_just_inside_ten_minutes(
    hass, hass_ws_client, aioclient_mock, entry, home_package, freezer
):
    aioclient_mock.get(HOME_URL, json=changed_package(home_package))
    ws = await hass_ws_client()
    previewed = (await preview(ws, entry))["result"]
    freezer.tick(timedelta(minutes=9, seconds=59))
    assert (await apply(ws, entry, previewed["preview_id"]))["success"]


async def test_a_new_preview_replaces_the_old_one(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    aioclient_mock.get(HOME_URL, json=changed_package(home_package))
    ws = await hass_ws_client()
    first = (await preview(ws, entry))["result"]
    second = (await preview(ws, entry))["result"]
    assert first["preview_id"] != second["preview_id"]

    assert (await apply(ws, entry, first["preview_id"]))["error"]["code"] == "preview_expired"
    assert (await apply(ws, entry, second["preview_id"]))["success"]


async def test_a_preview_belongs_to_its_own_home(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    aioclient_mock.get(HOME_URL, json=changed_package(home_package))
    other_package = copy.deepcopy(home_package)
    other_package["project"]["id"] = "proj-other"
    other = MockConfigEntry(
        domain=DOMAIN,
        unique_id="proj-other",
        title="Other",
        data={"source": "planner", "project_id": "proj-other", "title": "Other",
              "planner_url": BASE, "token": "other-token"},
        options={"installer_mode": True},
    )
    other.add_to_hass(hass)
    hass.data[DOMAIN]["pending"]["proj-other"] = other_package
    assert await hass.config_entries.async_setup(other.entry_id)
    await hass.async_block_till_done()
    ws = await hass_ws_client()

    previewed = (await preview(ws, entry))["result"]
    # Previewing another home does not drop it, and it cannot be applied to the other home.
    assert (await apply(ws, other, previewed["preview_id"]))["error"]["code"] == "preview_expired"
    assert (await apply(ws, entry, previewed["preview_id"]))["success"]


# ------------------------------------------------------------ file based homes


async def test_a_file_home_previews_an_uploaded_file(
    hass, hass_ws_client, aioclient_mock, tmp_path, home_package
):
    entry = await setup_entry(hass, home_package, source="file")
    new = changed_package(home_package)
    ws = await hass_ws_client()

    with upload_file(tmp_path, json.dumps(new).encode()):
        resp = await preview(ws, entry, file_id=FILE_ID)

    assert resp["success"]
    assert {e["id"] for e in resp["result"]["added"]} == {"dl9"}
    assert aioclient_mock.call_count == 0


async def test_a_file_home_needs_a_file(hass, hass_ws_client, aioclient_mock, home_package):
    entry = await setup_entry(hass, home_package, source="file")
    ws = await hass_ws_client()
    resp = await preview(ws, entry)
    assert resp["error"]["code"] == "invalid_package"
    assert aioclient_mock.call_count == 0


async def test_an_unknown_uploaded_file_is_invalid_package(
    hass, hass_ws_client, home_package
):
    entry = await setup_entry(hass, home_package, source="file")
    ws = await hass_ws_client()
    with patch(
        "custom_components.maxsen.websocket.process_uploaded_file",
        side_effect=ValueError("Unknown file ID"),
    ):
        resp = await preview(ws, entry, file_id=FILE_ID)
    assert resp["error"]["code"] == "invalid_package"


async def test_a_planner_home_accepts_a_newer_uploaded_file_without_fetching(
    hass, hass_ws_client, aioclient_mock, entry, tmp_path, home_package
):
    with upload_file(tmp_path, json.dumps(changed_package(home_package)).encode()):
        ws = await hass_ws_client()
        resp = await preview(ws, entry, file_id=FILE_ID)
    assert resp["success"]
    assert {e["id"] for e in resp["result"]["removed"]} == {"dl2", "sen2"}
    assert aioclient_mock.call_count == 0


async def test_a_bad_uploaded_file_is_invalid_package(
    hass, hass_ws_client, tmp_path, home_package
):
    entry = await setup_entry(hass, home_package, source="file")
    ws = await hass_ws_client()
    with upload_file(tmp_path, b"not json"):
        resp = await preview(ws, entry, file_id=FILE_ID)
    assert resp["error"]["code"] == "invalid_package"
    assert "invalid_json" in resp["error"]["message"]


# ------------------------------------------------------- which project it is for


def other_project(package: dict) -> dict:
    package = copy.deepcopy(package)
    package["project"]["id"] = "proj-someone-else"
    return package


async def test_an_uploaded_file_for_another_project_is_rejected(
    hass, hass_ws_client, entry, tmp_path, home_package
):
    ws = await hass_ws_client()
    with upload_file(tmp_path, json.dumps(other_project(home_package)).encode()):
        resp = await preview(ws, entry, file_id=FILE_ID)

    assert resp["error"]["code"] == "invalid_package"
    assert resp["error"]["message"] == "This home file is for a different project."
    # Nothing was kept to apply.
    resp = await apply(ws, entry, "anything")
    assert resp["error"]["code"] == "preview_expired"


async def test_a_file_home_rejects_another_projects_file_too(
    hass, hass_ws_client, tmp_path, home_package
):
    entry = await setup_entry(hass, home_package, source="file")
    ws = await hass_ws_client()
    with upload_file(tmp_path, json.dumps(other_project(home_package)).encode()):
        resp = await preview(ws, entry, file_id=FILE_ID)
    assert resp["error"]["message"] == "This home file is for a different project."


async def test_a_fetched_package_for_another_project_is_rejected(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    aioclient_mock.get(HOME_URL, json=other_project(home_package))
    ws = await hass_ws_client()
    resp = await preview(ws, entry)
    assert resp["error"]["code"] == "invalid_package"
    assert resp["error"]["message"] == "This home file is for a different project."
    assert entry.runtime_data.data["links"]["dl2"] == {"type": "entity", "id": "light.two"}
