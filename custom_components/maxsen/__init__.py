"""Maxsen Home: show a planned home's floor plans live in Home Assistant."""

from __future__ import annotations

import logging
import shutil

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import CONF_PROJECT_ID, DOMAIN
from .http import MaxsenImageView
from .package import PackageError, save_images
from .store import MaxsenStore
from .websocket import async_register_commands

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type MaxsenConfigEntry = ConfigEntry[MaxsenStore]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the websocket commands and image view, once per Home Assistant start.

    They are shared by every entry (each command and URL carries an entry id),
    so they belong here and not in ``async_setup_entry``.
    """
    async_register_commands(hass)
    hass.http.register_view(MaxsenImageView())
    return True


async def async_setup_entry(hass: HomeAssistant, entry: MaxsenConfigEntry) -> bool:
    """Set up Maxsen Home from a config entry.

    A package that the config flow validated is waiting in
    ``hass.data[DOMAIN]["pending"]``; it is written to disk here because the
    entry (and so its folder and store) only exists from now on.
    """
    pending = hass.data.get(DOMAIN, {}).get("pending", {})
    package = pending.get(entry.data[CONF_PROJECT_ID])

    store = MaxsenStore(hass, entry.entry_id)
    await store.async_load()
    if package is not None:
        # The package stays pending until it is saved, so a failed save is
        # reported again on every retry instead of leaving a silently empty home.
        try:
            slim = await save_images(hass, entry.entry_id, package)
            await store.async_save_package(slim)
        except (PackageError, OSError) as err:
            raise ConfigEntryError(
                translation_domain=DOMAIN, translation_key="save_failed"
            ) from err
        pending.pop(entry.data[CONF_PROJECT_ID], None)

    entry.runtime_data = store
    return True


async def async_unload_entry(hass: HomeAssistant, entry: MaxsenConfigEntry) -> bool:
    """Unload a config entry."""
    return True


def _remove_folder(folder: str) -> None:
    try:
        shutil.rmtree(folder)
    except FileNotFoundError:
        pass


async def async_remove_entry(hass: HomeAssistant, entry: MaxsenConfigEntry) -> None:
    """Delete the entry's saved images and stored data when the home is removed."""
    folder = hass.config.path("maxsen", entry.entry_id)
    try:
        await hass.async_add_executor_job(_remove_folder, folder)
    except OSError:
        _LOGGER.warning("Could not delete the saved images in %s", folder, exc_info=True)
    await MaxsenStore(hass, entry.entry_id).async_remove()
