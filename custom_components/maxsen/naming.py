"""Name and place devices when they are linked; put them back when they are unlinked.

The decisions are made here without touching anything: ``plan_naming`` returns
the registry changes and the ``named`` records they need. The caller saves the
records together with the links first, then applies the registry changes, so a
registry error can be rolled back (the registry is Home Assistant's, not part
of the store's transaction).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr

_LOGGER = logging.getLogger(__name__)


def device_name(level_name: str, element: dict[str, Any], taken: set[str]) -> str:
    """"Level - label" (else product name), numbered 2, 3, ... when ``taken`` has it.

    ``taken`` is compared without regard to case.
    """
    what = (
        (element.get("label") or "").strip()
        or (element.get("productName") or "").strip()
        or element["id"]
    )
    base = f"{level_name} – {what}"
    folded = {name.casefold() for name in taken}
    name, number = base, 2
    while name.casefold() in folded:
        name, number = f"{base} {number}", number + 1
    return name


@dataclass
class DeviceChange:
    """One registry update and the values that undo it."""

    device_id: str
    new: dict[str, Any]
    old: dict[str, Any]


@dataclass
class NamingPlan:
    """What linking and unlinking would change.

    ``named`` maps a device id to its new record, or ``None`` to drop the record.
    """

    changes: list[DeviceChange] = field(default_factory=list)
    named: dict[str, dict[str, Any] | None] = field(default_factory=dict)


def plan_restore(
    hass: HomeAssistant, records: dict[str, dict[str, Any]], device_id: str, plan: NamingPlan
) -> None:
    """Put back what Maxsen replaced, unless a person has changed it since.

    The record is dropped either way. A device that is gone needs nothing.
    """
    record = records.get(device_id)
    if record is None:
        return
    plan.named[device_id] = None
    device = dr.async_get(hass).async_get(device_id)
    if device is None:
        return
    new: dict[str, Any] = {}
    if device.name_by_user == record["name"]:
        new["name_by_user"] = record["prev_name"]
    if device.area_id == record["area_id"]:
        new["area_id"] = record["prev_area_id"]
    new = {key: value for key, value in new.items() if getattr(device, key) != value}
    if new:
        plan.changes.append(
            DeviceChange(device_id, new, {key: getattr(device, key) for key in new})
        )


def plan_naming(
    hass: HomeAssistant,
    device_id: str,
    level_name: str,
    element: dict[str, Any],
    taken: set[str],
    plan: NamingPlan,
) -> None:
    """Name and place a device unless it already has a ``name_by_user``.

    A ``name_by_user`` is either a person's (never overwritten) or Maxsen's own
    from an earlier link (already done). The area is only set when the device
    has none. Creates the level's area when it is needed and missing. The name
    is added to ``taken`` so the next device in the same request gets the next
    number.
    """
    device = dr.async_get(hass).async_get(device_id)
    if device is None or device.name_by_user:
        return
    name = device_name(level_name, element, taken)
    taken.add(name)
    new: dict[str, Any] = {"name_by_user": name}
    if device.area_id is None:
        new["area_id"] = ar.async_get(hass).async_get_or_create(level_name).id
    plan.changes.append(
        DeviceChange(device_id, new, {key: getattr(device, key) for key in new})
    )
    plan.named[device_id] = {
        "name": name,
        "area_id": new.get("area_id", device.area_id),
        "prev_name": device.name_by_user,
        "prev_area_id": device.area_id,
    }


def taken_names(hass: HomeAssistant) -> set[str]:
    """Every name a person (or Maxsen) has given a device, so names stay unique across the home."""
    return {
        device.name_by_user
        for device in dr.async_get(hass).devices.values()
        if device.name_by_user
    }


def plan_for_links(
    hass: HomeAssistant,
    store_data: dict[str, Any],
    updates: dict[str, dict[str, str] | None],
    elements: dict[str, dict[str, Any]],
    *,
    name_device: bool,
) -> NamingPlan:
    """Plan the naming for a ``links/set`` request, before anything is saved.

    - A device no link points to any more is restored (a link removed, or
      replaced by a link to something else).
    - With ``name_device``, each device link in the request is named after its
      element and placed in its level's area.
    """
    old_links = store_data["links"]
    new_links = {**old_links}
    for element_id, link in updates.items():
        if link is None:
            new_links.pop(element_id, None)
        else:
            new_links[element_id] = link
    linked = {link["id"] for link in new_links.values() if link["type"] == "device"}
    released = {
        old["id"]
        for element_id in updates
        if (old := old_links.get(element_id)) is not None and old["type"] == "device"
    } - linked

    records = store_data["named"]
    plan = NamingPlan()
    for device_id in sorted(released):
        plan_restore(hass, records, device_id, plan)

    if name_device:
        package = store_data["package"] or {"levels": []}
        level_names = {level["id"]: level["name"] for level in package["levels"]}
        taken = taken_names(hass)
        # A restored device gives its name back before the new ones are chosen.
        for device_id in released:
            record = records.get(device_id)
            device = dr.async_get(hass).async_get(device_id)
            if record and device and device.name_by_user == record["name"]:
                taken.discard(record["name"])
        done: set[str] = set()
        for element_id, link in updates.items():
            if link is None or link["type"] != "device" or link["id"] in done:
                continue
            done.add(link["id"])
            element = elements[element_id]
            plan_naming(
                hass, link["id"], level_names[element["levelId"]], element, taken, plan
            )
    return plan


def apply_changes(hass: HomeAssistant, changes: list[DeviceChange]) -> None:
    """Write the registry changes; if one raises, undo the ones already written and re-raise."""
    registry = dr.async_get(hass)
    applied: list[DeviceChange] = []
    try:
        for change in changes:
            registry.async_update_device(change.device_id, **change.new)
            applied.append(change)
    except Exception:
        for change in reversed(applied):
            try:
                registry.async_update_device(change.device_id, **change.old)
            except Exception:  # noqa: BLE001 - best effort; keep undoing the rest
                _LOGGER.warning(
                    "Could not undo the naming of device %s", change.device_id, exc_info=True
                )
        raise
