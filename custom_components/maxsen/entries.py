"""Find a loaded Maxsen config entry from an id that came from a client."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant

from .const import DOMAIN


def get_loaded_entry(hass: HomeAssistant, entry_id: str) -> ConfigEntry | None:
    """Return the entry when it is a loaded Maxsen entry, otherwise None."""
    entry = hass.config_entries.async_get_entry(entry_id)
    if (
        entry is None
        or entry.domain != DOMAIN
        or entry.state is not ConfigEntryState.LOADED
    ):
        return None
    return entry
