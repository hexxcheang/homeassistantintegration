"""Persistent storage for one Maxsen Home entry."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .const import EVENT_QUICK_PANEL_UPDATED, SIGNAL_UPDATED

STORAGE_VERSION = 1


def _empty() -> dict[str, Any]:
    return {"package": None, "links": {}, "quick_panel": [], "scenes": []}


class MaxsenStore:
    """The saved package (without image data), element links and quick panel.

    Every change is saved and announced to websocket subscribers through a
    per-entry dispatcher signal carrying "home", "links" or "quick_panel".
    """

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._hass = hass
        self._entry_id = entry_id
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, f"maxsen.{entry_id}"
        )
        self.data: dict[str, Any] = _empty()

    async def async_load(self) -> None:
        """Load what was saved before; start empty when nothing was."""
        stored = await self._store.async_load()
        self.data = {**_empty(), **stored} if stored else _empty()

    async def async_remove(self) -> None:
        """Delete the saved file."""
        await self._store.async_remove()

    def _announce(self, event: str) -> None:
        async_dispatcher_send(
            self._hass, SIGNAL_UPDATED.format(entry_id=self._entry_id), event
        )

    async def async_save_package(self, pkg: dict[str, Any]) -> None:
        """Replace the saved package."""
        self.data["package"] = pkg
        await self._store.async_save(self.data)
        self._announce("home")

    async def async_set_links(self, updates: dict[str, dict[str, str] | None]) -> None:
        """Set links by element id; a ``None`` value removes that element's link."""
        links = dict(self.data["links"])
        for element_id, link in updates.items():
            if link is None:
                links.pop(element_id, None)
            else:
                links[element_id] = link
        self.data["links"] = links
        await self._store.async_save(self.data)
        self._announce("links")

    async def async_set_quick_panel(self, items: list[dict[str, str]]) -> None:
        """Replace the shared quick-panel list."""
        self.data["quick_panel"] = list(items)
        await self._store.async_save(self.data)
        self._announce("quick_panel")
        self._hass.bus.async_fire(
            EVENT_QUICK_PANEL_UPDATED, {"entry_id": self._entry_id}
        )
