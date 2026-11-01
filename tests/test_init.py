"""Tests for setting up and unloading a Maxsen Home entry."""

from pathlib import Path

from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.maxsen.const import DOMAIN
from custom_components.maxsen.store import MaxsenStore
from homeassistant.config_entries import ConfigEntryState


def make_entry(hass) -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id="proj-test-house",
        title="Test House",
        data={"source": "file", "project_id": "proj-test-house", "title": "Test House"},
        options={"installer_mode": True},
    )
    entry.add_to_hass(hass)
    return entry


async def test_setup_saves_the_pending_package_then_unloads(hass, home_package):
    entry = make_entry(hass)
    hass.data.setdefault(DOMAIN, {}).setdefault("pending", {})[
        "proj-test-house"
    ] = home_package

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED

    # The pending package is consumed.
    assert hass.data[DOMAIN]["pending"] == {}

    # Images are on disk.
    folder = Path(hass.config.path("maxsen", entry.entry_id))
    assert sorted(p.name for p in folder.iterdir()) == ["file-l1.png", "file-l2.png"]

    # The store holds the package without image data.
    package = entry.runtime_data.data["package"]
    assert package["project"]["id"] == "proj-test-house"
    assert "images" not in package
    assert package["image_types"] == {"file-l1": "image/png", "file-l2": "image/png"}
    assert entry.runtime_data.data["links"] == {}
    assert entry.runtime_data.data["quick_panel"] == []
    assert entry.runtime_data.data["scenes"] == []

    assert await hass.config_entries.async_unload(entry.entry_id)
    assert entry.state is ConfigEntryState.NOT_LOADED


async def test_setup_loads_the_saved_package_after_a_restart(hass, home_package):
    entry = make_entry(hass)
    hass.data.setdefault(DOMAIN, {}).setdefault("pending", {})[
        "proj-test-house"
    ] = home_package
    assert await hass.config_entries.async_setup(entry.entry_id)
    assert await hass.config_entries.async_unload(entry.entry_id)

    # No pending package this time: the stored one is used.
    assert await hass.config_entries.async_setup(entry.entry_id)
    assert entry.runtime_data.data["package"]["project"]["title"] == "Test House"


async def test_setup_without_package_or_store_still_succeeds(hass):
    entry = make_entry(hass)

    assert await hass.config_entries.async_setup(entry.entry_id)
    assert entry.state is ConfigEntryState.LOADED
    assert entry.runtime_data.data["package"] is None


async def test_setup_with_corrupt_images_fails_the_entry(hass, home_package):
    entry = make_entry(hass)
    home_package["images"]["file-l1"]["data"] = "not base64!"
    hass.data.setdefault(DOMAIN, {}).setdefault("pending", {})[
        "proj-test-house"
    ] = home_package

    assert not await hass.config_entries.async_setup(entry.entry_id)
    assert entry.state is ConfigEntryState.SETUP_ERROR


async def test_store_round_trip(hass):
    store = MaxsenStore(hass, "abc")
    await store.async_load()
    assert store.data == {"package": None, "links": {}, "quick_panel": [], "scenes": []}

    await store.async_save_package({"project": {"id": "p"}})

    again = MaxsenStore(hass, "abc")
    await again.async_load()
    assert again.data["package"] == {"project": {"id": "p"}}
