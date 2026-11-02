"""Press to identify: find the device or entity the installer is touching.

An :class:`Identifier` listens to state changes while the installer's phone is
subscribed. A state change is a candidate when it is a real press (not a
reconnect), comes from a primary entity (not a setting or a hidden one) and, in
device mode, from a Zigbee device that has no device link yet. The first
candidate opens a one second window; anything else eligible inside the window
joins it. One candidate in the window is reported, several are "ambiguous".
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Any, Literal

from homeassistant.const import (
    EVENT_STATE_CHANGED,
    STATE_OFF,
    STATE_ON,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
)
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import Event, HomeAssistant, State, callback, split_entity_id
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_call_later

from .const import CONF_INSTALLER_MODE

# Config entry domains whose devices are Zigbee.
ZIGBEE_DOMAINS = frozenset({"mqtt", "zha"})
# The entities of a device that count as its gangs (and as a "switch" press).
GANG_DOMAINS = frozenset({"switch", "light"})
# How long a first candidate waits for others before it is reported.
AMBIGUITY_WINDOW = 1.0
WATCHED_DOMAINS = GANG_DOMAINS | {"cover", "binary_sensor", "event"}
KINDS = ("switch", "cover", "binary_sensor", "light_gang")

_GANG_PATTERN = re.compile(r"(\d+)\s*-?\s*g(?:ang)?\b", re.IGNORECASE)
_NOT_A_STATE = frozenset({STATE_UNAVAILABLE, STATE_UNKNOWN})


def gang_count(product_name: str) -> int | None:
    """The number of gangs a product name states ("3 Gang", "2-gang", "3G"), if any."""
    match = _GANG_PATTERN.search(product_name)
    return int(match.group(1)) if match else None


@callback
def _watches_entity(data: Mapping[str, Any]) -> bool:
    return split_entity_id(data["entity_id"])[0] in WATCHED_DOMAINS


def _is_primary(entity: er.RegistryEntry) -> bool:
    return (
        entity.entity_category is None
        and entity.hidden_by is None
        and entity.disabled_by is None
    )


def _is_press(
    kind: str, domain: str, old: State | None, new: State | None
) -> bool:
    """Whether this state change is the installer's press for ``kind``."""
    if new is None or old is None or new.state in _NOT_A_STATE:
        return False
    if domain == "event":
        # An event entity's state is the time it last fired; it starts unknown.
        # Coming back from unavailable restores the last timestamp: not a press.
        return (
            kind == "switch"
            and old.state != STATE_UNAVAILABLE
            and new.state != old.state
        )
    if old.state in _NOT_A_STATE or old.state == new.state:
        return False
    if kind == "light_gang":
        return domain in GANG_DOMAINS and old.state == STATE_OFF and new.state == STATE_ON
    if kind == "switch":
        return domain in GANG_DOMAINS
    return domain == kind  # "cover" and "binary_sensor"


class Identifier:
    """Watches one installer's presses and reports what they touched."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        *,
        mode: Literal["device", "entity"],
        kinds: list[str],
        gangs: int | None,
        include_other: bool,
        on_result: Callable[[dict[str, Any]], None],
    ) -> None:
        self._hass = hass
        self._entry = entry
        self._mode = mode
        self._kinds = tuple(kinds)
        self._gangs = gangs
        self._include_other = include_other
        self._on_result = on_result
        self._unsub_bus: Callable[[], None] | None = None
        self._cancel_window: Callable[[], None] | None = None
        self._candidates: dict[str, dict[str, Any]] = {}
        self._unsubs: list[Callable[[], None]] = []
        self._stopped = False

    async def async_start(self) -> None:
        """Start listening. Only changes from now on count.

        It ends itself, telling the client ``{"stopped": true}``, when the home is
        unloaded or installer mode is switched off.
        """
        self._unsubs = [
            self._entry.async_on_state_change(self._check_allowed),
            self._entry.add_update_listener(self._entry_updated),
        ]
        self._unsub_bus = self._hass.bus.async_listen(
            EVENT_STATE_CHANGED,
            self._handle_state_changed,
            event_filter=_watches_entity,
        )

    def stop_replaced(self) -> None:
        """Stop because another phone started listening: tell this one, once."""
        if not self._stopped:
            self._stopped = True
            self._on_result({"stopped": True})
        self.stop()

    def stop(self) -> None:
        """Stop listening and drop any candidate still waiting."""
        self._stopped = True
        while self._unsubs:
            self._unsubs.pop()()
        if self._unsub_bus is not None:
            self._unsub_bus()
            self._unsub_bus = None
        if self._cancel_window is not None:
            self._cancel_window()
            self._cancel_window = None
        self._candidates.clear()

    def _allowed(self) -> bool:
        return self._entry.state is ConfigEntryState.LOADED and bool(
            self._entry.options.get(CONF_INSTALLER_MODE)
        )

    @callback
    def _check_allowed(self) -> bool:
        """End the subscription, once, if the home or installer mode is gone."""
        if self._stopped:
            return False
        if self._allowed():
            return True
        # Stopped now, unsubscribed a moment later: this may run inside the entry's
        # own loop over its state-change callbacks, which must not be edited.
        self._stopped = True
        self._on_result({"stopped": True})
        self._hass.loop.call_soon(self.stop)
        return False

    async def _entry_updated(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self._check_allowed()

    @callback
    def _handle_state_changed(self, event: Event) -> None:
        # A change made through Home Assistant by a person or an app (Check all, the dashboard)
        # carries that user; a press on the device itself never does.
        if event.context.user_id:
            return
        entity_id = event.data["entity_id"]
        old, new = event.data.get("old_state"), event.data.get("new_state")
        domain = split_entity_id(entity_id)[0]
        if not any(_is_press(kind, domain, old, new) for kind in self._kinds):
            return

        if not self._check_allowed():
            return
        entity = er.async_get(self._hass).async_get(entity_id)
        if entity is None or not _is_primary(entity):
            return

        device = (
            dr.async_get(self._hass).async_get(entity.device_id)
            if entity.device_id
            else None
        )
        if not self._counts_as_zigbee(device):
            return
        if self._mode == "entity":
            # A gang that is already linked may be chosen again for more lights.
            key, result = entity_id, {"entity_id": entity_id, "name": new.name}
        else:
            if device is None or not self._is_unlinked_match(device):
                return
            key = device.id
            result = {"device_id": device.id, "name": device.name_by_user or device.name}

        # The same thing pressed twice inside the window is still one candidate.
        self._candidates.setdefault(key, result)
        if self._cancel_window is None:
            self._cancel_window = async_call_later(
                self._hass, AMBIGUITY_WINDOW, self._report
            )

    def _counts_as_zigbee(self, device: dr.DeviceEntry | None) -> bool:
        if self._include_other:
            return True
        return device is not None and self._is_zigbee(device)

    def _is_unlinked_match(self, device: dr.DeviceEntry) -> bool:
        """Device mode: no device link yet, and the gang count (if asked) fits."""
        if device.id in self._linked_device_ids():
            return False
        return self._gangs is None or self._primary_gangs(device.id) == self._gangs

    def _is_zigbee(self, device: dr.DeviceEntry) -> bool:
        for entry_id in device.config_entries:
            entry = self._hass.config_entries.async_get_entry(entry_id)
            if entry is not None and entry.domain in ZIGBEE_DOMAINS:
                return True
        return False

    def _linked_device_ids(self) -> set[str]:
        links = self._entry.runtime_data.data["links"]
        return {link["id"] for link in links.values() if link["type"] == "device"}

    def _primary_gangs(self, device_id: str) -> int:
        registry = er.async_get(self._hass)
        return sum(
            1
            for entity in er.async_entries_for_device(registry, device_id)
            if entity.domain in GANG_DOMAINS and _is_primary(entity)
        )

    @callback
    def _report(self, _now: datetime) -> None:
        self._cancel_window = None
        candidates, self._candidates = list(self._candidates.values()), {}
        if len(candidates) == 1:
            self._on_result(candidates[0])
        elif candidates:
            self._on_result({"ambiguous": True})
