"""Tests for the starter scenes: builder, scene entities and maxsen/scenes/create_starter."""

import copy

import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_mock_service,
)

from custom_components.maxsen.const import DOMAIN
from custom_components.maxsen.scene import MaxsenStarterScene, build_starter_scenes
from homeassistant.components.climate import ClimateEntityFeature
from homeassistant.components.fan import FanEntityFeature
from homeassistant.const import EntityCategory
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

PROJECT_ID = "proj-test-house"
BASE = "https://planner.example.com"
HOME_URL = f"{BASE}/api/public/home-assistant/home"


async def setup_entry(hass, package, *, installer_mode=True) -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id=PROJECT_ID,
        title="Test House",
        data={
            "source": "planner",
            "project_id": PROJECT_ID,
            "title": "Test House",
            "planner_url": BASE,
            "token": "secret-token",
        },
        options={"installer_mode": installer_mode},
    )
    entry.add_to_hass(hass)
    hass.data.setdefault(DOMAIN, {}).setdefault("pending", {})[PROJECT_ID] = package
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def add_device(hass, name, entities, *, disabled=(), config=(), diagnostic=(), hidden=()):
    """A device from another integration with one entity per (domain, object id).

    Object ids in ``config``/``diagnostic`` get that entity category; those in
    ``hidden`` are hidden by the user.
    """
    other = MockConfigEntry(domain="test", title=name)
    other.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=other.entry_id, identifiers={("test", name)}
    )
    registry = er.async_get(hass)
    for domain, object_id in entities:
        registry.async_get_or_create(
            domain,
            "test",
            f"{name}-{object_id}",
            suggested_object_id=object_id,
            config_entry=other,
            device_id=device.id,
            disabled_by=er.RegistryEntryDisabler.USER if object_id in disabled else None,
            hidden_by=er.RegistryEntryHider.USER if object_id in hidden else None,
            entity_category=(
                EntityCategory.CONFIG
                if object_id in config
                else EntityCategory.DIAGNOSTIC
                if object_id in diagnostic
                else None
            ),
        )
    return device.id


@pytest.fixture
def gangs(hass) -> str:
    """The entrance 3-gang switch, plus a sensor on the same device."""
    return add_device(
        hass,
        "l1-switch",
        [
            ("switch", "l1_gang1"),
            ("switch", "l1_gang2"),
            ("switch", "l1_gang3"),
            ("sensor", "l1_switch_temperature"),
        ],
    )


@pytest.fixture
async def entry(hass, home_package, gangs) -> MockConfigEntry:
    """Level 1: switch device sw1 and downlight dl1 on gang 2. Level 2: nothing linked."""
    entry = await setup_entry(hass, home_package)
    await entry.runtime_data.async_set_links(
        {
            "sw1": {"type": "device", "id": gangs},
            "dl1": {"type": "entity", "id": "switch.l1_gang2"},
        }
    )
    return entry


async def call(ws, type_, **fields):
    await ws.send_json_auto_id({"type": type_, **fields})
    return await ws.receive_json()


async def create_starter(ws, entry):
    return await call(ws, "maxsen/scenes/create_starter", entry_id=entry.entry_id)


def scene_entity_id(hass, entry, scene_id):
    return er.async_get(hass).async_get_entity_id(
        "scene", DOMAIN, f"{entry.entry_id}_{scene_id}"
    )


# ---------------------------------------------------------------- builder


def test_builder_makes_the_three_kinds_of_scene(hass, home_package, entry):
    store = entry.runtime_data
    scenes = build_starter_scenes(store.data["package"], store.data["links"], hass)

    by_name = {scene["name"]: scene for scene in scenes}
    # No scene for Level 2: nothing on it is linked.
    assert list(by_name) == ["All off", "All off – Level 1", "All lights off"]
    gangs = ["switch.l1_gang1", "switch.l1_gang2", "switch.l1_gang3"]
    # The downlight shares gang 2 with the switch device: listed once.
    assert sorted(by_name["All off"]["entity_ids"]) == gangs
    assert sorted(by_name["All off – Level 1"]["entity_ids"]) == gangs
    assert by_name["All lights off"]["entity_ids"] == ["switch.l1_gang2"]
    assert [scene["id"] for scene in scenes] == [
        "all_off",
        "all_off_level-1",
        "all_lights_off",
    ]


def test_builder_only_takes_switchable_enabled_entities_of_a_device(hass, home_package):
    device_id = add_device(
        hass,
        "mixed",
        [
            ("light", "m_light"),
            ("switch", "m_switch"),
            ("fan", "m_fan"),
            ("climate", "m_climate"),
            ("sensor", "m_sensor"),
            ("cover", "m_cover"),
            ("light", "m_off_light"),
        ],
        disabled={"m_off_light"},
    )
    scenes = build_starter_scenes(
        {"levels": home_package["levels"]},
        {"sw1": {"type": "device", "id": device_id}},
        hass,
    )
    assert sorted(scenes[0]["entity_ids"]) == [
        "climate.m_climate",
        "fan.m_fan",
        "light.m_light",
        "switch.m_switch",
    ]


def test_builder_leaves_out_settings_and_hidden_entities_of_a_device(hass, home_package):
    """A Zigbee2MQTT Tuya 2-gang switch: backlight and child lock are config entities."""
    device_id = add_device(
        hass,
        "tuya",
        [
            ("switch", "t_gang1"),
            ("switch", "t_gang2"),
            ("switch", "t_backlight"),
            ("lock", "t_child_lock"),
            ("light", "t_indicator"),
            ("switch", "t_hidden"),
        ],
        config={"t_backlight", "t_child_lock"},
        diagnostic={"t_indicator"},
        hidden={"t_hidden"},
    )
    scenes = build_starter_scenes(
        {"levels": home_package["levels"]},
        {"sw1": {"type": "device", "id": device_id}},
        hass,
    )
    assert scenes[0]["name"] == "All off"
    assert scenes[0]["entity_ids"] == ["switch.t_gang1", "switch.t_gang2"]


def test_builder_gives_a_lighting_only_home_no_empty_scene(hass, home_package):
    scenes = build_starter_scenes(
        {"levels": home_package["levels"]},
        {"sw1": {"type": "entity", "id": "switch.not_lighting"}},
        hass,
    )
    assert [scene["name"] for scene in scenes] == ["All off", "All off – Level 1"]


def test_builder_without_links_makes_nothing(hass, home_package):
    assert build_starter_scenes({"levels": home_package["levels"]}, {}, hass) == []


def test_builder_ignores_links_to_elements_not_in_the_package(hass, home_package):
    scenes = build_starter_scenes(
        {"levels": home_package["levels"]},
        {"gone": {"type": "entity", "id": "light.x"}},
        hass,
    )
    assert scenes == []


# ---------------------------------------------------- maxsen/scenes/create_starter


async def test_create_starter_stores_and_answers_the_scenes(
    hass, hass_ws_client, entry
):
    ws = await hass_ws_client()
    resp = await create_starter(ws, entry)

    assert resp["success"]
    scenes = resp["result"]["scenes"]
    assert [(s["id"], s["name"]) for s in scenes] == [
        ("all_off", "All off"),
        ("all_off_level-1", "All off – Level 1"),
        ("all_lights_off", "All lights off"),
    ]
    assert scenes[2]["entity_ids"] == ["switch.l1_gang2"]
    assert entry.runtime_data.data["scenes"] == scenes


async def test_create_starter_adds_scene_entities(hass, hass_ws_client, entry):
    ws = await hass_ws_client()
    await create_starter(ws, entry)

    registry = er.async_get(hass)
    all_off = registry.async_get("scene.all_off")
    assert all_off.unique_id == f"{entry.entry_id}_all_off"
    assert all_off.device_id is None
    assert all_off.config_entry_id == entry.entry_id

    state = hass.states.get("scene.all_off_level_1")
    assert state.attributes["friendly_name"] == "All off – Level 1"
    assert sorted(state.attributes["entity_id"]) == [
        "switch.l1_gang1",
        "switch.l1_gang2",
        "switch.l1_gang3",
    ]
    assert hass.states.get("scene.all_lights_off").attributes["entity_id"] == [
        "switch.l1_gang2"
    ]


async def test_activating_turns_the_members_off(hass, hass_ws_client, entry):
    turn_off = async_mock_service(hass, "homeassistant", "turn_off")
    ws = await hass_ws_client()
    await create_starter(ws, entry)

    await hass.services.async_call(
        "scene", "turn_on", {"entity_id": "scene.all_lights_off"}, blocking=True
    )

    assert [call.data for call in turn_off] == [{"entity_id": ["switch.l1_gang2"]}]


def activatable(hass, entry, entity_ids) -> MaxsenStarterScene:
    scene = MaxsenStarterScene(
        entry.entry_id, {"id": "all_off", "name": "All off", "entity_ids": entity_ids}
    )
    scene.hass = hass
    return scene


async def test_activating_turns_off_aircons_with_and_without_turn_off(hass, entry):
    """homeassistant.turn_off fails for every aircon when one lacks TURN_OFF; set off mode instead."""
    hass.states.async_set(
        "climate.ac_new",
        "cool",
        {
            "supported_features": ClimateEntityFeature.TURN_OFF
            | ClimateEntityFeature.TARGET_TEMPERATURE,
            "hvac_modes": ["off", "cool"],
        },
    )
    hass.states.async_set(
        "climate.ac_old",
        "cool",
        {
            "supported_features": ClimateEntityFeature.TARGET_TEMPERATURE,
            "hvac_modes": ["off", "cool"],
        },
    )
    hass.states.async_set("switch.gang", "on")
    turn_off = async_mock_service(hass, "homeassistant", "turn_off")
    climate_off = async_mock_service(hass, "climate", "turn_off")
    set_mode = async_mock_service(hass, "climate", "set_hvac_mode")

    await activatable(
        hass, entry, ["climate.ac_new", "climate.ac_old", "switch.gang"]
    ).async_activate()

    assert [c.data for c in turn_off] == [{"entity_id": ["switch.gang"]}]
    assert [c.data for c in climate_off] == [{"entity_id": "climate.ac_new"}]
    assert [c.data for c in set_mode] == [
        {"entity_id": "climate.ac_old", "hvac_mode": "off"}
    ]


async def test_activating_skips_what_cannot_be_turned_off_with_a_log(
    hass, entry, caplog
):
    hass.states.async_set("fan.old", "on", {"supported_features": 0})
    hass.states.async_set(
        "fan.new", "on", {"supported_features": FanEntityFeature.TURN_OFF}
    )
    hass.states.async_set(
        "climate.heat_only", "heat", {"supported_features": 0, "hvac_modes": ["heat"]}
    )
    hass.states.async_set("light.lamp", "on")
    turn_off = async_mock_service(hass, "homeassistant", "turn_off")
    fan_off = async_mock_service(hass, "fan", "turn_off")
    climate_off = async_mock_service(hass, "climate", "turn_off")
    set_mode = async_mock_service(hass, "climate", "set_hvac_mode")

    await activatable(
        hass, entry, ["fan.old", "fan.new", "climate.heat_only", "light.lamp"]
    ).async_activate()

    assert [c.data for c in turn_off] == [{"entity_id": ["light.lamp"]}]
    assert [c.data for c in fan_off] == [{"entity_id": "fan.new"}]
    assert climate_off == []
    assert set_mode == []
    assert "fan.old" in caplog.text
    assert "climate.heat_only" in caplog.text


async def test_one_failed_call_does_not_stop_the_others(hass, entry, caplog):
    hass.states.async_set(
        "climate.ac", "cool", {"supported_features": ClimateEntityFeature.TURN_OFF}
    )
    hass.states.async_set(
        "fan.ceiling", "on", {"supported_features": FanEntityFeature.TURN_OFF}
    )
    hass.states.async_set("switch.gang", "on")

    async def broken(call):
        raise HomeAssistantError("aircon offline")

    hass.services.async_register("climate", "turn_off", broken)
    turn_off = async_mock_service(hass, "homeassistant", "turn_off")
    fan_off = async_mock_service(hass, "fan", "turn_off")

    await activatable(
        hass, entry, ["climate.ac", "fan.ceiling", "switch.gang"]
    ).async_activate()

    assert [c.data for c in turn_off] == [{"entity_id": ["switch.gang"]}]
    assert [c.data for c in fan_off] == [{"entity_id": "fan.ceiling"}]
    assert "climate.ac" in caplog.text
    assert "aircon offline" in caplog.text


async def test_a_scene_with_no_members_calls_nothing(hass, entry):
    turn_off = async_mock_service(hass, "homeassistant", "turn_off")
    scene = MaxsenStarterScene(entry.entry_id, {"id": "x", "name": "X", "entity_ids": []})
    scene.hass = hass

    await scene.async_activate()

    assert turn_off == []


async def test_scene_entities_are_named_and_keyed_by_the_scene(hass, entry):
    scene = MaxsenStarterScene(
        entry.entry_id, {"id": "all_off", "name": "All off", "entity_ids": ["light.a"]}
    )
    assert scene.unique_id == f"{entry.entry_id}_all_off"
    assert scene.name == "All off"
    assert scene.extra_state_attributes == {"entity_id": ["light.a"]}
    assert scene.device_info is None


async def test_create_starter_appends_to_the_quick_panel_once(
    hass, hass_ws_client, entry
):
    await entry.runtime_data.async_set_quick_panel(
        [{"type": "element", "id": "dl1"}, {"type": "entity", "id": "scene.all_off"}]
    )
    ws = await hass_ws_client()
    await create_starter(ws, entry)
    await create_starter(ws, entry)

    assert entry.runtime_data.data["quick_panel"] == [
        {"type": "element", "id": "dl1"},
        {"type": "entity", "id": "scene.all_off"},
        {"type": "entity", "id": "scene.all_off_level_1"},
        {"type": "entity", "id": "scene.all_lights_off"},
    ]
    assert len(er.async_entries_for_config_entry(er.async_get(hass), entry.entry_id)) == 3


async def test_create_starter_tells_subscribers_the_panel_changed(
    hass, hass_ws_client, entry
):
    ws = await hass_ws_client()
    await ws.send_json_auto_id({"type": "maxsen/subscribe", "entry_id": entry.entry_id})
    assert (await ws.receive_json())["success"]

    await ws.send_json_auto_id(
        {"type": "maxsen/scenes/create_starter", "entry_id": entry.entry_id}
    )
    messages = []
    while not (messages and messages[-1].get("type") == "result"):
        messages.append(await ws.receive_json())
    assert {"event": "quick_panel"} in [m.get("event") for m in messages]


async def test_create_starter_replaces_scenes_and_forgets_ones_that_are_gone(
    hass, hass_ws_client, entry
):
    ws = await hass_ws_client()
    await create_starter(ws, entry)
    await entry.runtime_data.async_set_quick_panel(
        [
            {"type": "entity", "id": "scene.all_off_level_1"},
            {"type": "entity", "id": "scene.movie_night"},
        ]
    )
    # Nothing on Level 1 stays linked except the downlight, so only that remains.
    await entry.runtime_data.async_set_links({"sw1": None})

    resp = await create_starter(ws, entry)

    assert [s["name"] for s in resp["result"]["scenes"]] == [
        "All off",
        "All off – Level 1",
        "All lights off",
    ]
    assert hass.states.get("scene.all_off").attributes["entity_id"] == ["switch.l1_gang2"]

    await entry.runtime_data.async_set_links({"dl1": None})
    resp = await create_starter(ws, entry)

    assert resp["result"]["scenes"] == []
    assert hass.states.get("scene.all_off") is None
    assert hass.states.get("scene.all_off_level_1") is None
    assert er.async_get(hass).async_get("scene.all_off") is None
    assert entry.runtime_data.data["quick_panel"] == [
        {"type": "entity", "id": "scene.movie_night"}
    ]


async def test_create_starter_needs_an_admin(
    hass, hass_ws_client, hass_read_only_access_token, entry
):
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    resp = await create_starter(ws, entry)
    assert resp["error"]["code"] == "not_allowed"
    assert entry.runtime_data.data["scenes"] == []
    assert hass.states.get("scene.all_off") is None


async def test_create_starter_needs_installer_mode(
    hass, hass_ws_client, home_package
):
    entry = await setup_entry(hass, home_package, installer_mode=False)
    ws = await hass_ws_client()
    resp = await create_starter(ws, entry)
    assert resp["error"]["code"] == "not_allowed"
    assert entry.runtime_data.data["scenes"] == []


async def test_create_starter_for_an_unknown_home(hass, hass_ws_client, entry):
    ws = await hass_ws_client()
    resp = await call(ws, "maxsen/scenes/create_starter", entry_id="nope")
    assert resp["error"]["code"] == "not_found"


async def test_scenes_come_back_after_a_restart_and_leave_with_the_entry(
    hass, hass_ws_client, entry
):
    ws = await hass_ws_client()
    await create_starter(ws, entry)

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get("scene.all_off").state == "unavailable"

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get("scene.all_off").attributes["entity_id"] == [
        "switch.l1_gang1",
        "switch.l1_gang2",
        "switch.l1_gang3",
    ]
    assert hass.states.get("scene.all_lights_off") is not None

    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert er.async_get(hass).async_get("scene.all_off") is None


# ------------------------------------------------------- refresh rebuilds scenes


async def test_refresh_rebuilds_scenes_from_the_new_package_and_links(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    """dl1 and sw1 stay; the new package drops dl2 and level 2 (both unlinked here)."""
    await entry.runtime_data.async_set_links(
        {
            "dl2": {"type": "entity", "id": "switch.l1_gang1"},
            "sen2": {"type": "entity", "id": "light.level_2"},
        }
    )
    ws = await hass_ws_client()
    await create_starter(ws, entry)
    assert sorted(hass.states.get("scene.all_off").attributes["entity_id"]) == [
        "light.level_2",
        "switch.l1_gang1",
        "switch.l1_gang2",
        "switch.l1_gang3",
    ]
    assert hass.states.get("scene.all_off_level_2") is not None
    await entry.runtime_data.async_set_quick_panel(
        [
            {"type": "entity", "id": "scene.all_off"},
            {"type": "entity", "id": "scene.all_off_level_1"},
            {"type": "entity", "id": "scene.all_off_level_2"},
            {"type": "entity", "id": "scene.all_lights_off"},
        ]
    )

    new = copy.deepcopy(home_package)
    new["levels"] = new["levels"][:1]
    del new["images"]["file-l2"]
    lighting = next(p for p in new["levels"][0]["plans"] if p["type"] == "lighting")
    lighting["elements"] = [e for e in lighting["elements"] if e["id"] != "dl2"]
    aioclient_mock.get(HOME_URL, json=new)

    previewed = await call(ws, "maxsen/refresh/preview", entry_id=entry.entry_id)
    resp = await call(
        ws,
        "maxsen/refresh/apply",
        entry_id=entry.entry_id,
        preview_id=previewed["result"]["preview_id"],
    )
    assert resp["success"]
    await hass.async_block_till_done()

    # dl2 (gang 1) is gone, but gang 2 is still linked by dl1 and the gangs by sw1.
    by_id = {s["id"]: s for s in entry.runtime_data.data["scenes"]}
    assert list(by_id) == ["all_off", "all_off_level-1", "all_lights_off"]
    assert by_id["all_lights_off"]["entity_ids"] == ["switch.l1_gang2"]
    # Level 2 has no linked entities any more: its scene is gone from everywhere.
    assert hass.states.get("scene.all_off_level_2") is None
    assert er.async_get(hass).async_get("scene.all_off_level_2") is None
    assert sorted(hass.states.get("scene.all_off").attributes["entity_id"]) == [
        "switch.l1_gang1",
        "switch.l1_gang2",
        "switch.l1_gang3",
    ]
    assert entry.runtime_data.data["quick_panel"] == [
        {"type": "entity", "id": "scene.all_off"},
        {"type": "entity", "id": "scene.all_off_level_1"},
        {"type": "entity", "id": "scene.all_lights_off"},
    ]


async def test_refresh_drops_an_entity_only_when_no_element_still_links_to_it(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    """dl2 alone links to light.only_dl2; dl3 and dl1 share switch.l1_gang2."""
    await entry.runtime_data.async_set_links(
        {
            "dl2": {"type": "entity", "id": "light.only_dl2"},
            "dl3": {"type": "entity", "id": "switch.l1_gang2"},
        }
    )
    ws = await hass_ws_client()
    await create_starter(ws, entry)
    assert "light.only_dl2" in hass.states.get("scene.all_lights_off").attributes["entity_id"]

    new = copy.deepcopy(home_package)
    lighting = next(p for p in new["levels"][0]["plans"] if p["type"] == "lighting")
    lighting["elements"] = [e for e in lighting["elements"] if e["id"] not in ("dl1", "dl2")]
    aioclient_mock.get(HOME_URL, json=new)
    previewed = await call(ws, "maxsen/refresh/preview", entry_id=entry.entry_id)
    await call(
        ws,
        "maxsen/refresh/apply",
        entry_id=entry.entry_id,
        preview_id=previewed["result"]["preview_id"],
    )
    await hass.async_block_till_done()

    # dl3 still links gang 2, so it stays; light.only_dl2 had only dl2.
    assert hass.states.get("scene.all_lights_off").attributes["entity_id"] == [
        "switch.l1_gang2"
    ]
    assert "light.only_dl2" not in hass.states.get("scene.all_off").attributes["entity_id"]


async def test_refresh_without_starter_scenes_creates_none(
    hass, hass_ws_client, aioclient_mock, entry, home_package
):
    aioclient_mock.get(HOME_URL, json=home_package)
    ws = await hass_ws_client()
    previewed = await call(ws, "maxsen/refresh/preview", entry_id=entry.entry_id)
    await call(
        ws,
        "maxsen/refresh/apply",
        entry_id=entry.entry_id,
        preview_id=previewed["result"]["preview_id"],
    )
    await hass.async_block_till_done()

    assert entry.runtime_data.data["scenes"] == []
    assert hass.states.get("scene.all_off") is None
