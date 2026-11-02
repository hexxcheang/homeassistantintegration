"""Tests for press-to-identify: gang_count, the Identifier rules and maxsen/identify/subscribe."""

from datetime import timedelta

import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.maxsen.identify import gang_count
from homeassistant.const import EntityCategory
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from custom_components.maxsen.const import DOMAIN

PROJECT_ID = "proj-test-house"


async def setup_entry(hass, package, *, installer_mode=True) -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id=PROJECT_ID,
        title="Test House",
        data={"source": "file", "project_id": PROJECT_ID, "title": "Test House"},
        options={"installer_mode": installer_mode},
    )
    entry.add_to_hass(hass)
    hass.data.setdefault(DOMAIN, {}).setdefault("pending", {})[PROJECT_ID] = package
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def call(ws, type_, **fields):
    await ws.send_json_auto_id({"type": type_, **fields})
    return await ws.receive_json()


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("3 Gang Smart Switch", 3),
        ("Nova 2-gang", 2),
        ("S1 3G", 3),
        ("Luna Downlight", None),
        ("Smart Switch 1 gang", 1),
    ],
)
def test_gang_count(name, expected):
    assert gang_count(name) == expected


def add_device(
    hass, name, entities, *, domain="mqtt", config=(), hidden=(), disabled=(), user_name=None
):
    """A device of a config entry in ``domain`` with one entity per (domain, object id)."""
    config_entry = MockConfigEntry(domain=domain, title=name)
    config_entry.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=config_entry.entry_id,
        identifiers={(domain, name)},
        name=name,
    )
    if user_name:
        device = dr.async_get(hass).async_update_device(device.id, name_by_user=user_name)
    registry = er.async_get(hass)
    for entity_domain, object_id in entities:
        registry.async_get_or_create(
            entity_domain,
            domain,
            f"{name}-{object_id}",
            suggested_object_id=object_id,
            config_entry=config_entry,
            device_id=device.id,
            entity_category=EntityCategory.CONFIG if object_id in config else None,
            hidden_by=er.RegistryEntryHider.USER if object_id in hidden else None,
            disabled_by=er.RegistryEntryDisabler.USER if object_id in disabled else None,
        )
        hass.states.async_set(f"{entity_domain}.{object_id}", "off")
    return device.id


async def subscribe(ws, entry, **fields):
    fields.setdefault("mode", "device")
    fields.setdefault("kinds", ["switch"])
    resp = await call(ws, "maxsen/identify/subscribe", entry_id=entry.entry_id, **fields)
    assert resp["success"], resp
    return resp["id"]


async def flip(hass, entity_id, state="on"):
    hass.states.async_set(entity_id, state)
    await hass.async_block_till_done()


async def window(hass, freezer, seconds=1.0):
    """Let the ambiguity window run out."""
    freezer.tick(timedelta(seconds=seconds))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()


async def assert_nothing_pushed(ws):
    """Nothing is queued for this connection: the next message is the answer to a ping."""
    await ws.send_json_auto_id({"type": "ping"})
    assert (await ws.receive_json())["type"] == "pong"


@pytest.fixture
async def entry(hass, home_package):
    return await setup_entry(hass, home_package)


async def test_an_unlinked_zigbee_device_is_reported_once(
    hass, hass_ws_client, entry, freezer
):
    device_id = add_device(hass, "Hall", [("switch", "hall_1")], user_name="Hall switch")
    ws = await hass_ws_client()
    sub_id = await subscribe(ws, entry)

    await flip(hass, "switch.hall_1")
    await window(hass, freezer)

    event = await ws.receive_json()
    assert event["id"] == sub_id
    assert event["type"] == "event"
    assert event["event"] == {"device_id": device_id, "name": "Hall switch"}
    await assert_nothing_pushed(ws)


async def test_the_name_is_the_device_name_when_no_one_renamed_it(
    hass, hass_ws_client, entry, freezer
):
    add_device(hass, "Hall", [("switch", "hall_1")])
    ws = await hass_ws_client()
    await subscribe(ws, entry)
    await flip(hass, "switch.hall_1")
    await window(hass, freezer)
    assert (await ws.receive_json())["event"]["name"] == "Hall"


async def test_an_event_entity_firing_counts_as_a_press(
    hass, hass_ws_client, entry, freezer
):
    device_id = add_device(hass, "Remote", [("event", "remote_action")])
    hass.states.async_set("event.remote_action", "unknown")
    ws = await hass_ws_client()
    await subscribe(ws, entry)

    await flip(hass, "event.remote_action", "2026-11-02T10:00:00.000+00:00")
    await window(hass, freezer)

    assert (await ws.receive_json())["event"]["device_id"] == device_id


async def test_a_linked_device_is_ignored(hass, hass_ws_client, entry, freezer):
    device_id = add_device(hass, "Hall", [("switch", "hall_1")])
    await entry.runtime_data.async_set_links({"dl1": {"type": "device", "id": device_id}})
    ws = await hass_ws_client()
    await subscribe(ws, entry)

    await flip(hass, "switch.hall_1")
    await window(hass, freezer)

    await assert_nothing_pushed(ws)


async def test_an_entity_link_to_a_gang_does_not_make_the_device_linked(
    hass, hass_ws_client, entry, freezer
):
    device_id = add_device(hass, "Hall", [("switch", "hall_1")])
    await entry.runtime_data.async_set_links(
        {"dl1": {"type": "entity", "id": "switch.hall_1"}}
    )
    ws = await hass_ws_client()
    await subscribe(ws, entry)

    await flip(hass, "switch.hall_1")
    await window(hass, freezer)

    assert (await ws.receive_json())["event"]["device_id"] == device_id


async def test_a_non_zigbee_device_needs_include_other(
    hass, hass_ws_client, entry, freezer
):
    device_id = add_device(hass, "Wifi", [("switch", "wifi_1")], domain="hue")
    ws = await hass_ws_client()
    await subscribe(ws, entry)
    await flip(hass, "switch.wifi_1")
    await window(hass, freezer)
    await assert_nothing_pushed(ws)

    await subscribe(ws, entry, include_other=True)
    await flip(hass, "switch.wifi_1", "off")
    await flip(hass, "switch.wifi_1", "on")
    await window(hass, freezer)
    assert (await ws.receive_json())["event"]["device_id"] == device_id


async def test_a_zha_device_counts_as_zigbee(hass, hass_ws_client, entry, freezer):
    device_id = add_device(hass, "Zha", [("switch", "zha_1")], domain="zha")
    ws = await hass_ws_client()
    await subscribe(ws, entry)
    await flip(hass, "switch.zha_1")
    await window(hass, freezer)
    assert (await ws.receive_json())["event"]["device_id"] == device_id


async def test_settings_and_hidden_entities_never_count(
    hass, hass_ws_client, entry, freezer
):
    add_device(
        hass,
        "Hall",
        [("switch", "backlight"), ("switch", "secret"), ("switch", "off_one")],
        config={"backlight"},
        hidden={"secret"},
        disabled={"off_one"},
    )
    ws = await hass_ws_client()
    await subscribe(ws, entry)

    for entity_id in ("switch.backlight", "switch.secret", "switch.off_one"):
        await flip(hass, entity_id)
    await window(hass, freezer)

    await assert_nothing_pushed(ws)


async def test_a_reconnect_is_not_a_press(hass, hass_ws_client, entry, freezer):
    add_device(hass, "Hall", [("switch", "hall_1")])
    ws = await hass_ws_client()
    await subscribe(ws, entry)

    await flip(hass, "switch.hall_1", "unavailable")
    await flip(hass, "switch.hall_1", "on")
    await window(hass, freezer)

    await assert_nothing_pushed(ws)


async def test_the_gang_count_must_match(hass, hass_ws_client, entry, freezer):
    add_device(hass, "Two", [("switch", "two_a"), ("switch", "two_b")])
    ws = await hass_ws_client()
    await subscribe(ws, entry, gangs=3)
    await flip(hass, "switch.two_a")
    await window(hass, freezer)
    await assert_nothing_pushed(ws)

    two = add_device(hass, "Two b", [("switch", "tb_a"), ("light", "tb_b"), ("switch", "tb_cfg")], config={"tb_cfg"})
    await subscribe(ws, entry, gangs=2)
    await flip(hass, "light.tb_b")
    await window(hass, freezer)
    assert (await ws.receive_json())["event"]["device_id"] == two


async def test_the_same_device_pressed_twice_in_a_second_is_one_result(
    hass, hass_ws_client, entry, freezer
):
    # Review focus 2.
    device_id = add_device(hass, "Hall", [("switch", "hall_1"), ("switch", "hall_2")])
    ws = await hass_ws_client()
    await subscribe(ws, entry)

    await flip(hass, "switch.hall_1")
    await flip(hass, "switch.hall_1", "off")
    await flip(hass, "switch.hall_2")
    await window(hass, freezer)

    assert (await ws.receive_json())["event"] == {"device_id": device_id, "name": "Hall"}
    await assert_nothing_pushed(ws)


async def test_two_different_devices_within_a_second_are_ambiguous(
    hass, hass_ws_client, entry, freezer
):
    # Review focus 1.
    add_device(hass, "Hall", [("switch", "hall_1")])
    add_device(hass, "Study", [("switch", "study_1")])
    ws = await hass_ws_client()
    await subscribe(ws, entry)

    await flip(hass, "switch.hall_1")
    await flip(hass, "switch.study_1")
    await window(hass, freezer)

    assert (await ws.receive_json())["event"] == {"ambiguous": True}
    await assert_nothing_pushed(ws)


async def test_it_keeps_listening_after_a_result(hass, hass_ws_client, entry, freezer):
    hall = add_device(hass, "Hall", [("switch", "hall_1")])
    study = add_device(hass, "Study", [("switch", "study_1")])
    ws = await hass_ws_client()
    await subscribe(ws, entry)

    await flip(hass, "switch.hall_1")
    await window(hass, freezer)
    assert (await ws.receive_json())["event"]["device_id"] == hall
    await flip(hass, "switch.study_1")
    await window(hass, freezer)
    assert (await ws.receive_json())["event"]["device_id"] == study


async def test_a_change_before_subscribing_is_ignored(
    hass, hass_ws_client, entry, freezer
):
    add_device(hass, "Hall", [("switch", "hall_1")])
    await flip(hass, "switch.hall_1")
    ws = await hass_ws_client()
    await subscribe(ws, entry)

    await window(hass, freezer)

    await assert_nothing_pushed(ws)


async def test_light_gang_matches_an_off_to_on_of_an_already_linked_gang(
    hass, hass_ws_client, entry, freezer
):
    add_device(hass, "Hall", [("switch", "hall_1"), ("light", "hall_2")])
    await entry.runtime_data.async_set_links(
        {"dl1": {"type": "entity", "id": "switch.hall_1"}}
    )
    ws = await hass_ws_client()
    await subscribe(ws, entry, mode="entity", kinds=["light_gang"])

    await flip(hass, "switch.hall_1", "on")
    await window(hass, freezer)
    assert (await ws.receive_json())["event"] == {
        "entity_id": "switch.hall_1",
        "name": "hall 1",
    }

    await flip(hass, "switch.hall_1", "off")
    await window(hass, freezer)
    await assert_nothing_pushed(ws)


async def test_light_gang_two_gangs_within_a_second_are_ambiguous(
    hass, hass_ws_client, entry, freezer
):
    add_device(hass, "Hall", [("switch", "hall_1"), ("switch", "hall_2")])
    ws = await hass_ws_client()
    await subscribe(ws, entry, mode="entity", kinds=["light_gang"])

    await flip(hass, "switch.hall_1")
    await flip(hass, "switch.hall_2")
    await window(hass, freezer)

    assert (await ws.receive_json())["event"] == {"ambiguous": True}


async def test_light_gang_still_ignores_settings_and_non_zigbee(
    hass, hass_ws_client, entry, freezer
):
    add_device(hass, "Hall", [("switch", "backlight")], config={"backlight"})
    add_device(hass, "Wifi", [("light", "wifi_1")], domain="hue")
    ws = await hass_ws_client()
    await subscribe(ws, entry, mode="entity", kinds=["light_gang"])

    await flip(hass, "switch.backlight")
    await flip(hass, "light.wifi_1")
    await window(hass, freezer)

    await assert_nothing_pushed(ws)


async def test_cover_and_binary_sensor_kinds(hass, hass_ws_client, entry, freezer):
    curtain = add_device(hass, "Curtain", [("cover", "curtain_1")])
    sensor = add_device(hass, "Door", [("binary_sensor", "door_1")])
    ws = await hass_ws_client()
    await subscribe(ws, entry, kinds=["cover"])
    await flip(hass, "binary_sensor.door_1")
    await flip(hass, "switch.nothing")
    await window(hass, freezer)
    await assert_nothing_pushed(ws)
    await flip(hass, "cover.curtain_1", "opening")
    await window(hass, freezer)
    assert (await ws.receive_json())["event"]["device_id"] == curtain

    await subscribe(ws, entry, kinds=["binary_sensor"])
    await flip(hass, "binary_sensor.door_1", "off")
    await window(hass, freezer)
    assert (await ws.receive_json())["event"]["device_id"] == sensor


async def test_identify_needs_an_admin_and_installer_mode(
    hass, hass_ws_client, hass_read_only_access_token, entry
):
    fields = {"entry_id": entry.entry_id, "mode": "device", "kinds": ["switch"]}

    ws = await hass_ws_client(hass, hass_read_only_access_token)
    resp = await call(ws, "maxsen/identify/subscribe", **fields)
    assert not resp["success"]
    assert resp["error"]["code"] == "not_allowed"

    hass.config_entries.async_update_entry(entry, options={"installer_mode": False})
    ws = await hass_ws_client()
    resp = await call(ws, "maxsen/identify/subscribe", **fields)
    assert not resp["success"]
    assert resp["error"]["code"] == "not_allowed"


async def test_identify_for_an_unknown_home(hass, hass_ws_client, entry):
    ws = await hass_ws_client()
    resp = await call(
        ws, "maxsen/identify/subscribe", entry_id="nope", mode="device", kinds=["switch"]
    )
    assert resp["error"]["code"] == "not_found"


async def test_unsubscribing_removes_the_listener(hass, hass_ws_client, entry, freezer):
    add_device(hass, "Hall", [("switch", "hall_1")])
    ws = await hass_ws_client()
    before = hass.bus.async_listeners().get("state_changed", 0)
    sub_id = await subscribe(ws, entry)
    assert hass.bus.async_listeners()["state_changed"] == before + 1

    await flip(hass, "switch.hall_1")  # a window is now open
    resp = await call(ws, "unsubscribe_events", subscription=sub_id)
    assert resp["success"]
    assert hass.bus.async_listeners().get("state_changed", 0) == before

    await window(hass, freezer)
    await assert_nothing_pushed(ws)


async def test_an_event_entity_coming_back_from_unavailable_is_not_a_press(
    hass, hass_ws_client, entry, freezer
):
    add_device(hass, "Remote", [("event", "remote_action")])
    hass.states.async_set("event.remote_action", "2026-11-02T09:00:00.000+00:00")
    ws = await hass_ws_client()
    await subscribe(ws, entry)

    await flip(hass, "event.remote_action", "unavailable")
    await flip(hass, "event.remote_action", "2026-11-02T09:00:00.000+00:00")
    await window(hass, freezer)

    await assert_nothing_pushed(ws)


async def test_a_press_after_the_window_closed_is_reported_separately(
    hass, hass_ws_client, entry, freezer
):
    hall = add_device(hass, "Hall", [("switch", "hall_1")])
    study = add_device(hass, "Study", [("switch", "study_1")])
    ws = await hass_ws_client()
    await subscribe(ws, entry)

    await flip(hass, "switch.hall_1")
    await window(hass, freezer)
    await flip(hass, "switch.study_1")
    await window(hass, freezer)

    assert (await ws.receive_json())["event"]["device_id"] == hall
    assert (await ws.receive_json())["event"]["device_id"] == study


async def test_a_press_just_inside_the_window_is_still_ambiguous(
    hass, hass_ws_client, entry, freezer
):
    add_device(hass, "Hall", [("switch", "hall_1")])
    add_device(hass, "Study", [("switch", "study_1")])
    ws = await hass_ws_client()
    await subscribe(ws, entry)

    await flip(hass, "switch.hall_1")
    freezer.tick(timedelta(seconds=0.9))
    await flip(hass, "switch.study_1")
    await window(hass, freezer, 0.1)

    assert (await ws.receive_json())["event"] == {"ambiguous": True}


async def test_unloading_the_home_ends_the_subscription(
    hass, hass_ws_client, entry, freezer
):
    add_device(hass, "Hall", [("switch", "hall_1")])
    ws = await hass_ws_client()
    before = hass.bus.async_listeners().get("state_changed", 0)
    await subscribe(ws, entry)

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert (await ws.receive_json())["event"] == {"stopped": True}
    assert hass.bus.async_listeners().get("state_changed", 0) == before

    await flip(hass, "switch.hall_1")  # must not raise or push
    await window(hass, freezer)
    await assert_nothing_pushed(ws)


async def test_switching_installer_mode_off_ends_the_subscription(
    hass, hass_ws_client, entry, freezer
):
    add_device(hass, "Hall", [("switch", "hall_1")])
    ws = await hass_ws_client()
    before = hass.bus.async_listeners().get("state_changed", 0)
    await subscribe(ws, entry)

    hass.config_entries.async_update_entry(entry, options={"installer_mode": False})
    await hass.async_block_till_done()
    assert (await ws.receive_json())["event"] == {"stopped": True}
    assert hass.bus.async_listeners().get("state_changed", 0) == before

    await flip(hass, "switch.hall_1")
    await window(hass, freezer)
    await assert_nothing_pushed(ws)  # no second "stopped", no names


async def test_a_change_made_through_home_assistant_by_a_user_is_not_a_press(
    hass, hass_ws_client, entry, freezer
):
    """Check all (and the dashboard) switch loads as a user: that is never a physical press."""
    from homeassistant.core import Context

    add_device(hass, "Hall", [("switch", "hall_1")], user_name="Hall switch")
    ws = await hass_ws_client()
    await subscribe(ws, entry)

    hass.states.async_set("switch.hall_1", "on", context=Context(user_id="user-1"))
    await hass.async_block_till_done()
    await window(hass, freezer)
    await assert_nothing_pushed(ws)

    # The same change without a user (the device itself reporting) still counts.
    hass.states.async_set("switch.hall_1", "off", context=Context(user_id="user-1"))
    await hass.async_block_till_done()
    await flip(hass, "switch.hall_1")
    await window(hass, freezer)
    resp = await ws.receive_json()
    assert resp["event"]["name"] == "Hall switch"
