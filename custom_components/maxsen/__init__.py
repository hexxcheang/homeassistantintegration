"""Maxsen Home: show a planned home's floor plans live in Home Assistant."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryError

from .const import CONF_PROJECT_ID, DOMAIN
from .package import PackageError, save_images
from .store import MaxsenStore

type MaxsenConfigEntry = ConfigEntry[MaxsenStore]


async def async_setup_entry(hass: HomeAssistant, entry: MaxsenConfigEntry) -> bool:
    """Set up Maxsen Home from a config entry.

    A package that the config flow validated is waiting in
    ``hass.data[DOMAIN]["pending"]``; it is written to disk here because the
    entry (and so its folder and store) only exists from now on.
    """
    pending = hass.data.get(DOMAIN, {}).get("pending", {})
    package = pending.pop(entry.data[CONF_PROJECT_ID], None)

    store = MaxsenStore(hass, entry.entry_id)
    await store.async_load()
    if package is not None:
        try:
            slim = await save_images(hass, entry.entry_id, package)
        except PackageError as err:
            raise ConfigEntryError(
                translation_domain=DOMAIN, translation_key="invalid_package"
            ) from err
        await store.async_save_package(slim)

    entry.runtime_data = store
    return True


async def async_unload_entry(hass: HomeAssistant, entry: MaxsenConfigEntry) -> bool:
    """Unload a config entry."""
    return True
