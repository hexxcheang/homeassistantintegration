"""Persistent storage for one Maxsen Home entry."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

STORAGE_VERSION = 1


def _empty() -> dict[str, Any]:
    return {"package": None, "links": {}, "quick_panel": [], "scenes": []}


class MaxsenStore:
    """The saved package (without image data), element links and quick panel."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, f"maxsen.{entry_id}"
        )
        self.data: dict[str, Any] = _empty()

    async def async_load(self) -> None:
        """Load what was saved before; start empty when nothing was."""
        stored = await self._store.async_load()
        self.data = {**_empty(), **stored} if stored else _empty()

    async def async_save_package(self, pkg: dict[str, Any]) -> None:
        """Replace the saved package."""
        self.data["package"] = pkg
        await self._store.async_save(self.data)
