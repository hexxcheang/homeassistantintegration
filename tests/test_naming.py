"""Tests for naming and placing devices when they are linked, and restoring them on unlink."""

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.maxsen.const import DOMAIN
from custom_components.maxsen.naming import device_name
from custom_components.maxsen.store import MaxsenStore
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr

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


async def call(ws, type_, **fields):
    await ws.send_json_auto_id({"type": type_, **fields})
    return await ws.receive_json()


# ------------------------------------------------------------- device_name


def test_name_is_the_level_then_the_label():
    assert (
        device_name("Level 1", {"label": "Entrance switch"}, set())
        == "Level 1 – Entrance switch"
    )


@pytest.mark.parametrize("label", ["", None, "   "])
def test_an_empty_label_falls_back_to_the_product_name(label):
    element = {"label": label, "productName": "Ark Series"}
    assert device_name("Level 1", element, set()) == "Level 1 – Ark Series"


def test_a_second_marker_with_the_same_name_is_numbered():
    # Review focus 4.
    element = {"label": "", "productName": "Switch"}
    first = device_name("Level 1", element, set())
    second = device_name("Level 1", element, {first})
    third = device_name("Level 1", element, {first, second})
    assert (first, second, third) == (
        "Level 1 – Switch",
        "Level 1 – Switch 2",
        "Level 1 – Switch 3",
    )


def test_duplicates_ignore_case():
    assert (
        device_name("Level 1", {"label": "switch"}, {"LEVEL 1 – SWITCH"})
        == "Level 1 – switch 2"
    )


# ------------------------------------------------------------- links/set


@pytest.fixture
async def entry(hass, home_package):
    return await setup_entry(hass, home_package)


def add_device(hass, name="Hall", *, user_name=None, area_id=None):
    config_entry = MockConfigEntry(domain="mqtt", title=name)
    config_entry.add_to_hass(hass)
    registry = dr.async_get(hass)
    device = registry.async_get_or_create(
        config_entry_id=config_entry.entry_id, identifiers={("mqtt", name)}, name=name
    )
    if user_name or area_id:
        device = registry.async_update_device(
            device.id, name_by_user=user_name, area_id=area_id
        )
    return device.id


def device_of(hass, device_id):
    return dr.async_get(hass).async_get(device_id)


def area_named(hass, name):
    return ar.async_get(hass).async_get_area_by_name(name)


async def link(ws, entry, updates, **fields):
    return await call(
        ws, "maxsen/links/set", entry_id=entry.entry_id, updates=updates, **fields
    )


def device_link(device_id):
    return {"type": "device", "id": device_id}


async def test_naming_a_device_sets_its_name_and_creates_the_level_area(
    hass, hass_ws_client, entry
):
    device_id = add_device(hass)
    assert area_named(hass, "Level 1") is None
    ws = await hass_ws_client()

    resp = await link(ws, entry, {"sw1": device_link(device_id)}, name_device=True)

    assert resp["success"], resp
    device = device_of(hass, device_id)
    area = area_named(hass, "Level 1")
    assert device.name_by_user == "Level 1 – Entrance switch"
    assert device.area_id == area.id
    assert entry.runtime_data.data["named"] == {
        device_id: {
            "name": "Level 1 – Entrance switch",
            "area_id": area.id,
            "prev_name": None,
            "prev_area_id": None,
        }
    }


async def test_the_existing_level_area_is_reused(hass, hass_ws_client, entry):
    existing = ar.async_get(hass).async_create("Level 1")
    device_id = add_device(hass)
    ws = await hass_ws_client()

    await link(ws, entry, {"sw1": device_link(device_id)}, name_device=True)

    assert device_of(hass, device_id).area_id == existing.id
    assert len(ar.async_get(hass).areas) == 1


async def test_without_name_device_nothing_is_renamed_or_recorded(
    hass, hass_ws_client, entry
):
    device_id = add_device(hass)
    ws = await hass_ws_client()

    resp = await link(ws, entry, {"sw1": device_link(device_id)})

    assert resp["success"]
    assert device_of(hass, device_id).name_by_user is None
    assert device_of(hass, device_id).area_id is None
    assert entry.runtime_data.data["named"] == {}
    assert area_named(hass, "Level 1") is None


async def test_a_device_a_person_renamed_is_left_alone_and_nothing_is_recorded(
    hass, hass_ws_client, entry
):
    # Review focus 3, linking half.
    kitchen = ar.async_get(hass).async_create("Kitchen")
    device_id = add_device(hass, user_name="Mum's lamp switch")
    ws = await hass_ws_client()

    resp = await link(ws, entry, {"sw1": device_link(device_id)}, name_device=True)

    assert resp["success"]
    device = device_of(hass, device_id)
    assert device.name_by_user == "Mum's lamp switch"
    assert device.area_id is None
    assert entry.runtime_data.data["named"] == {}
    assert area_named(hass, "Level 1") is None
    assert kitchen


async def test_unlinking_a_device_a_person_renamed_leaves_name_and_area_exactly(
    hass, hass_ws_client, entry
):
    # Review focus 3: linked, then undone.
    kitchen = ar.async_get(hass).async_create("Kitchen")
    device_id = add_device(hass, user_name="Mum's lamp switch", area_id=kitchen.id)
    ws = await hass_ws_client()
    await link(ws, entry, {"sw1": device_link(device_id)}, name_device=True)

    resp = await link(ws, entry, {"sw1": None})

    assert resp["success"]
    device = device_of(hass, device_id)
    assert (device.name_by_user, device.area_id) == ("Mum's lamp switch", kitchen.id)
    assert entry.runtime_data.data["named"] == {}


async def test_a_device_in_an_area_keeps_it_but_is_still_named(
    hass, hass_ws_client, entry
):
    kitchen = ar.async_get(hass).async_create("Kitchen")
    device_id = add_device(hass, area_id=kitchen.id)
    ws = await hass_ws_client()

    await link(ws, entry, {"sw1": device_link(device_id)}, name_device=True)

    device = device_of(hass, device_id)
    assert device.name_by_user == "Level 1 – Entrance switch"
    assert device.area_id == kitchen.id
    assert area_named(hass, "Level 1") is None

    await link(ws, entry, {"sw1": None})

    device = device_of(hass, device_id)
    assert (device.name_by_user, device.area_id) == (None, kitchen.id)


async def test_unlinking_restores_the_previous_name_and_area_and_drops_the_record(
    hass, hass_ws_client, entry
):
    device_id = add_device(hass)
    ws = await hass_ws_client()
    await link(ws, entry, {"sw1": device_link(device_id)}, name_device=True)

    resp = await link(ws, entry, {"sw1": None})

    assert resp["success"]
    device = device_of(hass, device_id)
    assert (device.name_by_user, device.area_id) == (None, None)
    assert entry.runtime_data.data["named"] == {}
    assert entry.runtime_data.data["links"] == {}


async def test_unlinking_leaves_what_a_person_changed_after_the_naming(
    hass, hass_ws_client, entry
):
    device_id = add_device(hass)
    ws = await hass_ws_client()
    await link(ws, entry, {"sw1": device_link(device_id)}, name_device=True)
    bedroom = ar.async_get(hass).async_create("Bedroom")
    dr.async_get(hass).async_update_device(
        device_id, name_by_user="Hall switch", area_id=bedroom.id
    )

    await link(ws, entry, {"sw1": None})

    device = device_of(hass, device_id)
    assert (device.name_by_user, device.area_id) == ("Hall switch", bedroom.id)
    assert entry.runtime_data.data["named"] == {}


async def test_entity_links_never_rename_anything(hass, hass_ws_client, entry):
    device_id = add_device(hass)
    ws = await hass_ws_client()

    resp = await link(
        ws, entry, {"dl1": {"type": "entity", "id": "light.kitchen"}}, name_device=True
    )

    assert resp["success"]
    assert device_of(hass, device_id).name_by_user is None
    assert entry.runtime_data.data["named"] == {}
    assert area_named(hass, "Level 1") is None


async def test_two_markers_with_the_same_name_in_one_request_are_numbered(
    hass, hass_ws_client, entry
):
    # Review focus 4: the fixture's "sen1" and "cur1" have no label; use two
    # "Luna Downlight" markers as device links.
    first, second = add_device(hass, "A"), add_device(hass, "B")
    ws = await hass_ws_client()

    await link(
        ws,
        entry,
        {"dl1": device_link(first), "dl2": device_link(second)},
        name_device=True,
    )

    names = {device_of(hass, first).name_by_user, device_of(hass, second).name_by_user}
    assert names == {"Level 1 – Luna Downlight", "Level 1 – Luna Downlight 2"}


async def test_names_stay_unique_across_the_whole_home(hass, hass_ws_client, entry):
    add_device(hass, "Other", user_name="Level 1 – Luna Downlight")
    device_id = add_device(hass)
    ws = await hass_ws_client()

    await link(ws, entry, {"dl1": device_link(device_id)}, name_device=True)

    assert device_of(hass, device_id).name_by_user == "Level 1 – Luna Downlight 2"


async def test_the_level_name_comes_from_the_elements_level(
    hass, hass_ws_client, entry
):
    device_id = add_device(hass)
    ws = await hass_ws_client()

    await link(ws, entry, {"sen2": device_link(device_id)}, name_device=True)

    device = device_of(hass, device_id)
    assert device.name_by_user == "Level 2 – Motion Sensor"
    assert device.area_id == area_named(hass, "Level 2").id


async def test_replacing_a_link_restores_the_old_device_and_names_the_new_one(
    hass, hass_ws_client, entry
):
    old, new = add_device(hass, "Old"), add_device(hass, "New")
    ws = await hass_ws_client()
    await link(ws, entry, {"sw1": device_link(old)}, name_device=True)

    resp = await link(ws, entry, {"sw1": device_link(new)}, name_device=True)

    assert resp["success"]
    assert device_of(hass, old).name_by_user is None
    assert device_of(hass, old).area_id is None
    assert device_of(hass, new).name_by_user == "Level 1 – Entrance switch"
    assert list(entry.runtime_data.data["named"]) == [new]


async def test_replacing_a_device_with_an_entity_restores_the_device(
    hass, hass_ws_client, entry
):
    device_id = add_device(hass)
    ws = await hass_ws_client()
    await link(ws, entry, {"sw1": device_link(device_id)}, name_device=True)

    await link(ws, entry, {"sw1": {"type": "entity", "id": "switch.x"}})

    assert device_of(hass, device_id).name_by_user is None
    assert entry.runtime_data.data["named"] == {}


async def test_a_device_still_linked_to_another_marker_is_not_restored(
    hass, hass_ws_client, entry
):
    device_id = add_device(hass)
    ws = await hass_ws_client()
    await link(
        ws,
        entry,
        {"sw1": device_link(device_id), "sen1": device_link(device_id)},
        name_device=True,
    )

    await link(ws, entry, {"sen1": None})

    assert device_of(hass, device_id).name_by_user == "Level 1 – Entrance switch"
    assert device_id in entry.runtime_data.data["named"]

    await link(ws, entry, {"sw1": None})

    assert device_of(hass, device_id).name_by_user is None


async def test_relinking_a_device_maxsen_named_keeps_its_name(
    hass, hass_ws_client, entry
):
    device_id = add_device(hass)
    ws = await hass_ws_client()
    await link(ws, entry, {"sw1": device_link(device_id)}, name_device=True)

    await link(ws, entry, {"sw1": device_link(device_id)}, name_device=True)

    assert device_of(hass, device_id).name_by_user == "Level 1 – Entrance switch"
    assert entry.runtime_data.data["named"][device_id]["prev_name"] is None


async def test_a_device_missing_from_the_registry_is_linked_without_naming(
    hass, hass_ws_client, entry
):
    ws = await hass_ws_client()

    resp = await link(ws, entry, {"sw1": device_link("gone")}, name_device=True)

    assert resp["success"]
    assert entry.runtime_data.data["links"] == {"sw1": device_link("gone")}
    assert entry.runtime_data.data["named"] == {}


async def test_name_device_must_be_a_boolean(hass, hass_ws_client, entry):
    ws = await hass_ws_client()
    resp = await link(ws, entry, {"sw1": None}, name_device="yes")
    assert resp["error"]["code"] == "invalid_format"


async def test_naming_is_installer_only(
    hass, hass_ws_client, hass_read_only_access_token, home_package
):
    off = await setup_entry(hass, home_package, installer_mode=False)
    device_id = add_device(hass)
    ws = await hass_ws_client()
    resp = await link(ws, off, {"sw1": device_link(device_id)}, name_device=True)
    assert resp["error"]["code"] == "not_allowed"
    assert device_of(hass, device_id).name_by_user is None

    on = await setup_entry(
        hass, home_package, project_id="proj-other", installer_mode=True
    )
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    resp = await link(ws, on, {"sw1": device_link(device_id)}, name_device=True)
    assert resp["error"]["code"] == "not_allowed"
    assert device_of(hass, device_id).name_by_user is None
    assert on.runtime_data.data["named"] == {}


async def test_a_failing_registry_update_rolls_back_the_link_and_record(
    hass, hass_ws_client, entry, monkeypatch
):
    first, second = add_device(hass, "A"), add_device(hass, "B")
    ws = await hass_ws_client()
    await link(ws, entry, {"sw1": device_link(first)}, name_device=True)
    registry = dr.async_get(hass)
    real = registry.async_update_device
    calls = []

    def flaky(device_id, **changes):
        calls.append(device_id)
        # The restore of the first device works; naming the second then fails.
        if device_id == second:
            raise ValueError("boom")
        return real(device_id, **changes)

    monkeypatch.setattr(registry, "async_update_device", flaky)

    resp = await link(ws, entry, {"sw1": device_link(second)}, name_device=True)

    assert not resp["success"]
    assert resp["error"]["code"] == "naming_failed"
    monkeypatch.undo()
    data = entry.runtime_data.data
    assert data["links"] == {"sw1": device_link(first)}
    assert list(data["named"]) == [first]
    # The first device is named again as before, the second untouched.
    assert device_of(hass, first).name_by_user == "Level 1 – Entrance switch"
    assert device_of(hass, second).name_by_user is None
    assert device_of(hass, second).area_id is None
    assert calls[0] == first


async def test_an_old_store_without_named_loads_with_none(hass):
    store = MaxsenStore(hass, "old")
    await store._store.async_save({"package": None, "links": {}})
    await store.async_load()
    assert store.data["named"] == {}
