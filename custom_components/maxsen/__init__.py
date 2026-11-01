"""Maxsen Home: show a planned home's floor plans live in Home Assistant."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import CONF_PROJECT_ID, DOMAIN
from .http import MaxsenImageView
from .package import PackageError, save_images
from .store import MaxsenStore
from .websocket import async_register_commands

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

# The built bundle holds the panel and the card; Home Assistant serves its folder here.
STATIC_URL = "/maxsen_static"
PANEL_URL_PATH = "maxsen-home"
PANEL_ELEMENT = "maxsen-home-panel"

type MaxsenConfigEntry = ConfigEntry[MaxsenStore]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the websocket commands, image view and frontend files, once per start.

    They are shared by every entry (each command and URL carries an entry id),
    so they belong here and not in ``async_setup_entry``. The panel itself is
    registered per entry lifecycle, see ``_async_ensure_panel``.
    """
    async_register_commands(hass)
    hass.http.register_view(MaxsenImageView())

    # The URL carries the version, so a new release is never served from a browser's
    # cache and the files themselves need no cache headers.
    integration = await async_get_integration(hass, DOMAIN)
    module_url = f"{STATIC_URL}/maxsen-home.js?v={integration.version}"
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                STATIC_URL,
                str(Path(__file__).parent / "frontend"),
                cache_headers=False,
            )
        ]
    )
    hass.data.setdefault(DOMAIN, {})["module_url"] = module_url
    # The same module defines the floor plan card for every dashboard.
    frontend.add_extra_js_url(hass, module_url)
    return True


async def _async_ensure_panel(hass: HomeAssistant) -> None:
    """Show the Home panel in the sidebar unless it already is."""
    if PANEL_URL_PATH in hass.data.get(frontend.DATA_PANELS, {}):
        return
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name=PANEL_ELEMENT,
        frontend_url_path=PANEL_URL_PATH,
        sidebar_title="Home",
        sidebar_icon="mdi:floor-plan",
        module_url=hass.data[DOMAIN]["module_url"],
        require_admin=False,
        # The element finds the first Maxsen home itself.
        config={},
    )


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
    await _async_ensure_panel(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: MaxsenConfigEntry) -> bool:
    """Unload a config entry; the panel goes with the last one."""
    # This entry is already out of the loaded list while it unloads.
    if not hass.config_entries.async_loaded_entries(DOMAIN):
        frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
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
