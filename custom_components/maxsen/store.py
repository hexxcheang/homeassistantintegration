"""Persistent storage for one Maxsen Home entry."""

from __future__ import annotations

import asyncio
import secrets
from datetime import datetime, timedelta
from collections.abc import Callable
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import EVENT_QUICK_PANEL_UPDATED, SIGNAL_UPDATED
from .scene import StarterScene, build_starter_scenes, starter_entity_ids

STORAGE_VERSION = 1
PREVIEW_LIFETIME = timedelta(minutes=10)


def _empty() -> dict[str, Any]:
    return {
        "package": None,
        "links": {},
        "quick_panel": [],
        "scenes": [],
        "display": {"background": "soft"},
    }


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
        # Held by a refresh apply from taking the preview to deleting old images,
        # so two applies never interleave.
        self.refresh_lock = asyncio.Lock()
        # Held by every change to ``data`` while it is built, saved and assigned.
        self._write_lock = asyncio.Lock()
        # The one live refresh preview: (preview id, expiry, parsed package with
        # images). Memory only; a restart or a newer preview drops it.
        self._preview: tuple[str, datetime, dict[str, Any]] | None = None

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

    async def _async_write(
        self, build: Callable[[dict[str, Any]], dict[str, Any]]
    ) -> None:
        """Change ``data``: build the changed keys from the current data, save, then assign.

        One writer at a time, so no change is built from a stale copy and lost.
        Home Assistant's Store does not raise when the file cannot be written (it
        logs the WriteError), so memory can then be ahead of what is on disk until
        the next save succeeds. Only an error the Store does raise leaves ``data``
        as it was.
        """
        async with self._write_lock:
            new_data = {**self.data, **build(self.data)}
            await self._store.async_save(new_data)
            self.data = new_data

    def _announce_quick_panel(self) -> None:
        self._announce("quick_panel")
        self._hass.bus.async_fire(
            EVENT_QUICK_PANEL_UPDATED, {"entry_id": self._entry_id}
        )

    async def async_save_package(self, pkg: dict[str, Any]) -> None:
        """Replace the saved package."""
        await self._async_write(lambda _: {"package": pkg})
        self._announce("home")

    async def async_set_links(self, updates: dict[str, dict[str, str] | None]) -> None:
        """Set links by element id; a ``None`` value removes that element's link."""

        def build(data: dict[str, Any]) -> dict[str, Any]:
            links = dict(data["links"])
            for element_id, link in updates.items():
                if link is None:
                    links.pop(element_id, None)
                else:
                    links[element_id] = link
            return {"links": links}

        await self._async_write(build)
        self._announce("links")

    async def async_set_quick_panel(self, items: list[dict[str, str]]) -> None:
        """Replace the shared quick-panel list."""
        await self._async_write(lambda _: {"quick_panel": list(items)})
        self._announce_quick_panel()

    async def async_set_display(self, display: dict[str, str]) -> None:
        """Replace the display settings shared by every screen of this home."""
        await self._async_write(lambda _: {"display": dict(display)})
        self._announce("home")

    async def async_rebuild_starter_scenes(self) -> list[StarterScene]:
        """Replace the starter scenes with ones built from the package and links as they are now."""

        def build(data: dict[str, Any]) -> dict[str, Any]:
            package = data["package"]
            return {
                "scenes": (
                    build_starter_scenes(package, data["links"], self._hass)
                    if package
                    else []
                )
            }

        await self._async_write(build)
        return self.data["scenes"]

    async def async_update_starter_panel(
        self, add: list[str], remove: set[str]
    ) -> None:
        """Append scene entities to the quick panel unless already there; drop ``remove``."""
        changed = False

        def build(data: dict[str, Any]) -> dict[str, Any]:
            nonlocal changed
            panel = [
                item
                for item in data["quick_panel"]
                if not (item["type"] == "entity" and item["id"] in remove)
            ]
            present = {(item["type"], item["id"]) for item in panel}
            for entity_id in add:
                if ("entity", entity_id) not in present:
                    panel.append({"type": "entity", "id": entity_id})
                    present.add(("entity", entity_id))
            changed = panel != data["quick_panel"]
            return {"quick_panel": panel}

        await self._async_write(build)
        if changed:
            self._announce_quick_panel()

    def keep_preview(self, pkg: dict[str, Any]) -> str:
        """Hold a parsed package for ten minutes, replacing any earlier preview."""
        preview_id = secrets.token_hex(16)
        self._preview = (preview_id, dt_util.utcnow() + PREVIEW_LIFETIME, pkg)
        return preview_id

    def take_preview(self, preview_id: str) -> dict[str, Any] | None:
        """Return and forget the preview, or None when unknown or expired."""
        if self._preview is None:
            return None
        kept_id, expires_at, pkg = self._preview
        if dt_util.utcnow() > expires_at:
            self._preview = None
            return None
        if kept_id != preview_id:
            return None
        self._preview = None
        return pkg

    async def async_apply_refresh(
        self, slim: dict[str, Any], removed_ids: set[str]
    ) -> bool:
        """Save a refreshed package and tidy what depended on the old one.

        Links and quick-panel items of removed elements go. When starter scenes
        exist they are rebuilt from the new package and the pruned links, and
        quick-panel items for scenes that no longer exist go too. Returns whether
        the starter scenes changed (the scene entities then need reloading).
        """
        panel_changed = False
        scenes_changed = False

        def build(data: dict[str, Any]) -> dict[str, Any]:
            nonlocal panel_changed, scenes_changed
            links = {
                element_id: link
                for element_id, link in data["links"].items()
                if element_id not in removed_ids
            }
            gone_entities: set[str] = set()
            changes: dict[str, Any] = {"package": slim, "links": links}
            if data["scenes"]:
                scenes = build_starter_scenes(slim, links, self._hass)
                kept = {scene["id"] for scene in scenes}
                gone_entities = set(
                    starter_entity_ids(
                        self._hass,
                        self._entry_id,
                        [s for s in data["scenes"] if s["id"] not in kept],
                    )
                )
                scenes_changed = scenes != data["scenes"]
                changes["scenes"] = scenes
            panel = [
                item
                for item in data["quick_panel"]
                if not (item["type"] == "element" and item["id"] in removed_ids)
                and not (item["type"] == "entity" and item["id"] in gone_entities)
            ]
            panel_changed = len(panel) != len(data["quick_panel"])
            return {**changes, "quick_panel": panel}

        await self._async_write(build)
        for event in ("home", "links", "quick_panel"):
            self._announce(event)
        if panel_changed:
            self._hass.bus.async_fire(
                EVENT_QUICK_PANEL_UPDATED, {"entry_id": self._entry_id}
            )
        return scenes_changed
