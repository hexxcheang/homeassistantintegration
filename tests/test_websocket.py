"""Tests for the maxsen/* websocket commands and the image view."""

from pathlib import Path

import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.maxsen.const import DOMAIN
from custom_components.maxsen.store import MaxsenStore
from homeassistant.config_entries import ConfigEntryState

PROJECT_ID = "proj-test-house"


async def setup_entry(
    hass, package, *, project_id=PROJECT_ID, installer_mode=True
) -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id=project_id,
        title="Test House",
        data={"source": "file", "project_id": project_id, "title": "Test House"},
        options={"installer_mode": installer_mode},
    )
    entry.add_to_hass(hass)
    hass.data.setdefault(DOMAIN, {}).setdefault("pending", {})[project_id] = package
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


@pytest.fixture
async def entry(hass, home_package) -> MockConfigEntry:
    return await setup_entry(hass, home_package)


async def call(ws, type_, **fields):
    await ws.send_json_auto_id({"type": type_, **fields})
    return await ws.receive_json()


# ---------------------------------------------------------------- maxsen/home


async def test_home_returns_the_package_without_image_data(
    hass, hass_ws_client, entry
):
    ws = await hass_ws_client()
    resp = await call(ws, "maxsen/home", entry_id=entry.entry_id)

    assert resp["success"]
    result = resp["result"]
    assert result["package"]["project"]["id"] == PROJECT_ID
    assert "images" not in result["package"]
    assert result["links"] == {}
    assert result["quick_panel"] == []
    assert result["installer_mode"] is True
    assert result["source"] == "file"
    assert result["image_urls"] == {
        "file-l1": f"/api/maxsen/image/{entry.entry_id}/file-l1",
        "file-l2": f"/api/maxsen/image/{entry.entry_id}/file-l2",
    }


async def test_home_is_readable_by_a_non_admin(
    hass, hass_ws_client, hass_read_only_access_token, entry
):
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    resp = await call(ws, "maxsen/home", entry_id=entry.entry_id)
    assert resp["success"]
    assert resp["result"]["package"]["project"]["id"] == PROJECT_ID


async def test_home_returns_links_to_entities_that_no_longer_exist(
    hass, hass_ws_client, entry
):
    # Review focus 1: the card decides how to show a link whose target is gone.
    await entry.runtime_data.async_set_links(
        {"dl1": {"type": "entity", "id": "light.deleted_long_ago"}}
    )
    assert hass.states.get("light.deleted_long_ago") is None

    ws = await hass_ws_client()
    resp = await call(ws, "maxsen/home", entry_id=entry.entry_id)

    assert resp["success"]
    assert resp["result"]["links"] == {
        "dl1": {"type": "entity", "id": "light.deleted_long_ago"}
    }


async def test_home_reports_installer_mode_from_the_current_options(
    hass, hass_ws_client, entry
):
    ws = await hass_ws_client()
    hass.config_entries.async_update_entry(entry, options={"installer_mode": False})
    resp = await call(ws, "maxsen/home", entry_id=entry.entry_id)
    assert resp["result"]["installer_mode"] is False


async def test_unknown_unloaded_or_foreign_entries_are_not_found(
    hass, hass_ws_client, entry
):
    foreign = MockConfigEntry(domain="other", title="Other")
    foreign.add_to_hass(hass)
    ws = await hass_ws_client()

    for entry_id in ("does-not-exist", foreign.entry_id):
        for type_, extra in (
            ("maxsen/home", {}),
            ("maxsen/links/set", {"updates": {}}),
            ("maxsen/quick_panel/set", {"items": []}),
            ("maxsen/subscribe", {}),
        ):
            resp = await call(ws, type_, entry_id=entry_id, **extra)
            assert not resp["success"], (type_, entry_id)
            assert resp["error"]["code"] == "not_found", (type_, entry_id)

    assert await hass.config_entries.async_unload(entry.entry_id)
    assert entry.state is ConfigEntryState.NOT_LOADED
    resp = await call(ws, "maxsen/home", entry_id=entry.entry_id)
    assert resp["error"]["code"] == "not_found"


# ----------------------------------------------------------- maxsen/links/set


async def test_links_set_needs_an_admin(
    hass, hass_ws_client, hass_read_only_access_token, entry
):
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    resp = await call(
        ws,
        "maxsen/links/set",
        entry_id=entry.entry_id,
        updates={"dl1": {"type": "entity", "id": "light.kitchen"}},
    )
    assert not resp["success"]
    assert resp["error"]["code"] == "not_allowed"
    assert entry.runtime_data.data["links"] == {}


async def test_links_set_needs_installer_mode(hass, hass_ws_client, home_package):
    entry = await setup_entry(hass, home_package, installer_mode=False)
    ws = await hass_ws_client()
    updates = {"dl1": {"type": "entity", "id": "light.kitchen"}}

    resp = await call(ws, "maxsen/links/set", entry_id=entry.entry_id, updates=updates)
    assert resp["error"]["code"] == "not_allowed"
    assert entry.runtime_data.data["links"] == {}

    # Switching the option on takes effect at once, without reloading the entry.
    hass.config_entries.async_update_entry(entry, options={"installer_mode": True})
    resp = await call(ws, "maxsen/links/set", entry_id=entry.entry_id, updates=updates)
    assert resp["success"]
    assert resp["result"]["links"] == updates


async def test_links_set_saves_and_persists(hass, hass_ws_client, entry):
    ws = await hass_ws_client()
    resp = await call(
        ws,
        "maxsen/links/set",
        entry_id=entry.entry_id,
        updates={
            "dl1": {"type": "entity", "id": "light.kitchen"},
            "sw1": {"type": "device", "id": "abc123"},
        },
    )
    assert resp["success"]
    assert resp["result"]["links"] == {
        "dl1": {"type": "entity", "id": "light.kitchen"},
        "sw1": {"type": "device", "id": "abc123"},
    }

    # Null removes a link; the other one stays.
    resp = await call(
        ws, "maxsen/links/set", entry_id=entry.entry_id, updates={"dl1": None}
    )
    assert resp["result"]["links"] == {"sw1": {"type": "device", "id": "abc123"}}

    reloaded = MaxsenStore(hass, entry.entry_id)
    await reloaded.async_load()
    assert reloaded.data["links"] == {"sw1": {"type": "device", "id": "abc123"}}


async def test_links_set_rejects_unknown_elements_without_saving_any(
    hass, hass_ws_client, entry
):
    ws = await hass_ws_client()
    resp = await call(
        ws,
        "maxsen/links/set",
        entry_id=entry.entry_id,
        updates={
            "dl1": {"type": "entity", "id": "light.kitchen"},
            "no-such-element": {"type": "entity", "id": "light.x"},
        },
    )
    assert not resp["success"]
    assert resp["error"]["code"] == "invalid_element"
    assert entry.runtime_data.data["links"] == {}


@pytest.mark.parametrize(
    "link",
    [
        {"type": "area", "id": "kitchen"},
        {"type": "entity"},
        {"type": "entity", "id": 5},
        {"type": "entity", "id": ""},
        {"type": "entity", "id": "light.a", "extra": "x"},
        "light.kitchen",
    ],
)
async def test_links_set_rejects_malformed_links(hass, hass_ws_client, entry, link):
    ws = await hass_ws_client()
    resp = await call(
        ws, "maxsen/links/set", entry_id=entry.entry_id, updates={"dl1": link}
    )
    assert not resp["success"]
    assert resp["error"]["code"] == "invalid_format"
    assert entry.runtime_data.data["links"] == {}


# ------------------------------------------------------ maxsen/quick_panel/set


async def test_quick_panel_set_works_for_a_non_admin_and_fires_an_event(
    hass, hass_ws_client, hass_read_only_access_token, entry
):
    events = async_capture_events(hass, "maxsen_quick_panel_updated")
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    items = [
        {"type": "element", "id": "dl1"},
        {"type": "entity", "id": "scene.all_off"},
    ]

    resp = await call(ws, "maxsen/quick_panel/set", entry_id=entry.entry_id, items=items)
    await hass.async_block_till_done()

    assert resp["success"]
    assert resp["result"] == {"quick_panel": items}
    assert [event.data for event in events] == [{"entry_id": entry.entry_id}]

    reloaded = MaxsenStore(hass, entry.entry_id)
    await reloaded.async_load()
    assert reloaded.data["quick_panel"] == items


@pytest.mark.parametrize(
    "item",
    [
        {"type": "device", "id": "x"},
        {"type": "element"},
        {"type": "element", "id": ""},
        {"type": "element", "id": "dl1", "extra": 1},
        "dl1",
    ],
)
async def test_quick_panel_set_rejects_malformed_items(
    hass, hass_ws_client, entry, item
):
    events = async_capture_events(hass, "maxsen_quick_panel_updated")
    ws = await hass_ws_client()
    resp = await call(ws, "maxsen/quick_panel/set", entry_id=entry.entry_id, items=[item])
    await hass.async_block_till_done()
    assert resp["error"]["code"] == "invalid_format"
    assert entry.runtime_data.data["quick_panel"] == []
    assert events == []


# ------------------------------------------------------------ maxsen/subscribe


async def test_a_quick_panel_change_reaches_another_clients_subscription(
    hass, hass_ws_client, hass_read_only_access_token, entry
):
    # Review focus 5: two clients, one shared quick panel.
    client_a = await hass_ws_client()
    client_b = await hass_ws_client(hass, hass_read_only_access_token)

    await client_b.send_json_auto_id({"type": "maxsen/subscribe", "entry_id": entry.entry_id})
    subscribed = await client_b.receive_json()
    assert subscribed["success"]
    subscription_id = subscribed["id"]

    resp = await call(
        client_a,
        "maxsen/quick_panel/set",
        entry_id=entry.entry_id,
        items=[{"type": "element", "id": "dl1"}],
    )
    assert resp["success"]

    pushed = await client_b.receive_json()
    assert pushed["id"] == subscription_id
    assert pushed["type"] == "event"
    assert pushed["event"] == {"event": "quick_panel"}


async def test_subscription_also_reports_links_and_home_changes(
    hass, hass_ws_client, entry
):
    ws = await hass_ws_client()
    await ws.send_json_auto_id({"type": "maxsen/subscribe", "entry_id": entry.entry_id})
    assert (await ws.receive_json())["success"]

    await entry.runtime_data.async_set_links({"dl1": {"type": "entity", "id": "light.a"}})
    assert (await ws.receive_json())["event"] == {"event": "links"}

    await entry.runtime_data.async_save_package(entry.runtime_data.data["package"])
    assert (await ws.receive_json())["event"] == {"event": "home"}


async def test_subscription_is_only_for_its_own_entry(
    hass, hass_ws_client, home_package, entry
):
    other_package = {**home_package, "project": {"id": "proj-2", "title": "Second"}}
    other = await setup_entry(hass, other_package, project_id="proj-2")
    ws = await hass_ws_client()
    await ws.send_json_auto_id({"type": "maxsen/subscribe", "entry_id": entry.entry_id})
    assert (await ws.receive_json())["success"]

    await other.runtime_data.async_set_quick_panel([{"type": "element", "id": "dl1"}])
    resp = await call(ws, "ping")
    assert resp["type"] == "pong"


async def test_unsubscribing_stops_the_events(hass, hass_ws_client, entry):
    ws = await hass_ws_client()
    await ws.send_json_auto_id({"type": "maxsen/subscribe", "entry_id": entry.entry_id})
    subscription_id = (await ws.receive_json())["id"]

    resp = await call(ws, "unsubscribe_events", subscription=subscription_id)
    assert resp["success"]

    await entry.runtime_data.async_set_quick_panel([{"type": "element", "id": "dl1"}])
    # The next message is the answer to this ping, not a leftover event.
    resp = await call(ws, "ping")
    assert resp["type"] == "pong"


# ------------------------------------------------------------------ image view


def image_url(entry, image_id) -> str:
    return f"/api/maxsen/image/{entry.entry_id}/{image_id}"


async def test_image_view_needs_authentication(hass_client_no_auth, entry):
    client = await hass_client_no_auth()
    resp = await client.get(image_url(entry, "file-l1"))
    assert resp.status == 401


async def test_image_view_serves_the_saved_file(hass, hass_client, entry):
    client = await hass_client()
    resp = await client.get(image_url(entry, "file-l1"))

    assert resp.status == 200
    assert resp.content_type == "image/png"
    saved = Path(hass.config.path("maxsen", entry.entry_id, "file-l1.png"))
    assert await resp.read() == saved.read_bytes()


async def test_image_view_works_for_a_non_admin(
    hass, hass_client, hass_read_only_access_token, entry
):
    client = await hass_client(hass_read_only_access_token)
    resp = await client.get(image_url(entry, "file-l2"))
    assert resp.status == 200


@pytest.mark.parametrize("image_id", ["a.b", "x" * 65, "a%20b"])
async def test_image_view_404s_for_ids_outside_the_allowed_pattern(
    hass, hass_client, entry, image_id
):
    # Even when the package names such an image and the file exists.
    stored_id = image_id.replace("%20", " ")
    folder = Path(hass.config.path("maxsen", entry.entry_id))
    (folder / f"{stored_id}.png").write_bytes(b"png")
    entry.runtime_data.data["package"]["image_types"][stored_id] = "image/png"
    client = await hass_client()
    resp = await client.get(image_url(entry, image_id))
    assert resp.status == 404


@pytest.mark.parametrize(
    "image_id", ["..%2Fx", "..%2F..%2F.storage%2Fcore.config_entries", "%2e%2e"]
)
async def test_image_view_never_follows_path_traversal(
    hass, hass_client, entry, image_id
):
    # Home Assistant's own request filter answers some of these with 400
    # before the view runs; either way no file is served.
    client = await hass_client()
    resp = await client.get(image_url(entry, image_id))
    assert resp.status in (400, 404)


async def test_image_view_404s_for_unknown_image_or_entry(hass, hass_client, entry):
    client = await hass_client()
    assert (await client.get(image_url(entry, "never-saved"))).status == 404
    assert (await client.get("/api/maxsen/image/no-such-entry/file-l1")).status == 404


async def test_image_view_404s_when_the_entry_is_not_a_loaded_maxsen_entry(
    hass, hass_client, entry
):
    foreign = MockConfigEntry(domain="other", title="Other")
    foreign.add_to_hass(hass)
    client = await hass_client()
    assert (await client.get(image_url(foreign, "file-l1"))).status == 404

    assert await hass.config_entries.async_unload(entry.entry_id)
    assert (await client.get(image_url(entry, "file-l1"))).status == 404


async def test_image_view_never_serves_a_type_outside_the_allowlist(
    hass, hass_client, entry
):
    folder = Path(hass.config.path("maxsen", entry.entry_id))
    (folder / "evil.bin").write_bytes(b"<script>alert(1)</script>")
    entry.runtime_data.data["package"]["image_types"]["evil"] = "text/html"
    client = await hass_client()

    resp = await client.get(image_url(entry, "evil"))
    assert resp.status == 404


async def test_image_view_serves_a_jpeg_with_the_jpeg_type(hass, hass_client, entry):
    folder = Path(hass.config.path("maxsen", entry.entry_id))
    (folder / "photo.jpg").write_bytes(b"\xff\xd8\xff")
    entry.runtime_data.data["package"]["image_types"]["photo"] = "image/jpeg"
    client = await hass_client()

    resp = await client.get(image_url(entry, "photo"))
    assert resp.status == 200
    assert resp.content_type == "image/jpeg"
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
