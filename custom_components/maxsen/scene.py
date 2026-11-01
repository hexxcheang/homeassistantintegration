"""Starter scenes: All off, All off per level and All lights off."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from homeassistant.components.climate import (
    ATTR_HVAC_MODE,
    ATTR_HVAC_MODES,
    ClimateEntityFeature,
    HVACMode,
)
from homeassistant.components.fan import FanEntityFeature
from homeassistant.components.scene import Scene
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import ATTR_ENTITY_ID, ATTR_SUPPORTED_FEATURES, Platform
from homeassistant.core import HomeAssistant, split_entity_id
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    DOMAIN,
    LIGHTING_CATEGORIES,
    SCENE_ALL_LIGHTS_OFF,
    SCENE_ALL_OFF,
    SCENE_ALL_OFF_LEVEL,
)

if TYPE_CHECKING:
    from .store import MaxsenStore

# A device link stands for the entities of the device that "off" makes sense for.
# Its settings (config or diagnostic entities, e.g. a switch's backlight or child
# lock), hidden and disabled entities never count.
SWITCHABLE_DOMAINS = frozenset({"light", "switch", "fan", "climate"})

type StarterScene = dict[str, Any]
type ServiceCall = tuple[str, str, dict[str, Any]]

_LOGGER = logging.getLogger(__name__)


def _resolve_link(
    link: dict[str, str], registry: er.EntityRegistry
) -> list[str]:
    if link["type"] == "entity":
        return [link["id"]]
    return sorted(
        entity.entity_id
        # Disabled entities are left out by async_entries_for_device itself.
        for entity in er.async_entries_for_device(registry, link["id"])
        if entity.domain in SWITCHABLE_DOMAINS
        and entity.entity_category is None
        and entity.hidden_by is None
        and entity.disabled_by is None
    )


def build_starter_scenes(
    pkg: dict[str, Any], links: dict[str, dict[str, str]], hass: HomeAssistant
) -> list[StarterScene]:
    """Build the starter scenes from the linked elements.

    Ids are stable (``all_off``, ``all_off_<level id>``, ``all_lights_off``) so a
    scene keeps its entity when it is rebuilt. A scene nothing is linked to is left out.
    """
    registry = er.async_get(hass)

    def entity_ids(elements: list[dict[str, Any]]) -> list[str]:
        found: dict[str, None] = {}  # an ordered set: gangs shared by elements count once
        for element in elements:
            if (link := links.get(element["id"])) is not None:
                found.update(dict.fromkeys(_resolve_link(link, registry)))
        return list(found)

    levels = [
        (level, [e for plan in level["plans"] for e in plan["elements"]])
        for level in pkg["levels"]
    ]
    everything = [element for _, elements in levels for element in elements]
    candidates = [
        ("all_off", SCENE_ALL_OFF, everything),
        *(
            (
                f"all_off_{level['id']}",
                SCENE_ALL_OFF_LEVEL.format(level=level["name"]),
                elements,
            )
            for level, elements in levels
        ),
        (
            "all_lights_off",
            SCENE_ALL_LIGHTS_OFF,
            [e for e in everything if e["categoryId"] in LIGHTING_CATEGORIES],
        ),
    ]
    scenes: list[StarterScene] = []
    for scene_id, name, elements in candidates:
        if ids := entity_ids(elements):
            scenes.append({"id": scene_id, "name": name, "entity_ids": ids})
    return scenes


def _unique_id(entry_id: str, scene_id: str) -> str:
    return f"{entry_id}_{scene_id}"


def starter_entity_ids(
    hass: HomeAssistant, entry_id: str, scenes: list[StarterScene]
) -> list[str]:
    """The entity ids Home Assistant gave these scenes (those that have an entity)."""
    registry = er.async_get(hass)
    found = (
        registry.async_get_entity_id("scene", DOMAIN, _unique_id(entry_id, scene["id"]))
        for scene in scenes
    )
    return [entity_id for entity_id in found if entity_id is not None]


class MaxsenStarterScene(Scene):
    """A scene that turns its members off."""

    _attr_should_poll = False

    def __init__(self, entry_id: str, scene: StarterScene) -> None:
        self._attr_unique_id = _unique_id(entry_id, scene["id"])
        self._attr_name = scene["name"]
        self._entity_ids: list[str] = list(scene["entity_ids"])

    @property
    def extra_state_attributes(self) -> dict[str, list[str]]:
        """List the members, as Home Assistant's own scenes do."""
        return {"entity_id": self._entity_ids}

    def _off_call(self, entity_id: str) -> ServiceCall | None:
        """How to turn off one aircon or fan, or None when it cannot be turned off.

        ``homeassistant.turn_off`` makes one call per domain, and Home Assistant
        rejects that whole call when one of its climate or fan entities lacks
        TURN_OFF, so these are turned off one by one.
        """
        state = self.hass.states.get(entity_id)
        if state is None:
            return None
        features = state.attributes.get(ATTR_SUPPORTED_FEATURES, 0) or 0
        domain = split_entity_id(entity_id)[0]
        if domain == "fan":
            if features & FanEntityFeature.TURN_OFF:
                return ("fan", "turn_off", {ATTR_ENTITY_ID: entity_id})
            return None
        if features & ClimateEntityFeature.TURN_OFF:
            return ("climate", "turn_off", {ATTR_ENTITY_ID: entity_id})
        if HVACMode.OFF in (state.attributes.get(ATTR_HVAC_MODES) or []):
            return (
                "climate",
                "set_hvac_mode",
                {ATTR_ENTITY_ID: entity_id, ATTR_HVAC_MODE: HVACMode.OFF},
            )
        return None

    async def async_activate(self, **kwargs: Any) -> None:
        """Turn the members off.

        Lights and switches go in one ``homeassistant.turn_off``; each aircon and
        fan gets its own call. The calls run side by side, so one failure does
        not stop the others; failures and members that cannot be turned off are
        logged, not raised.
        """
        plain: list[str] = []
        calls: list[ServiceCall] = []
        for entity_id in self._entity_ids:
            if split_entity_id(entity_id)[0] not in ("climate", "fan"):
                plain.append(entity_id)
            elif (call := self._off_call(entity_id)) is not None:
                calls.append(call)
            else:
                _LOGGER.warning(
                    "%s: %s cannot be turned off, so it was left as it is",
                    self.name,
                    entity_id,
                )
        if plain:
            calls.insert(0, ("homeassistant", "turn_off", {ATTR_ENTITY_ID: plain}))
        if not calls:
            return
        results = await asyncio.gather(
            *(
                self.hass.services.async_call(
                    domain, service, data, blocking=True, context=self._context
                )
                for domain, service, data in calls
            ),
            return_exceptions=True,
        )
        for (domain, service, data), result in zip(calls, results, strict=True):
            if isinstance(result, Exception):
                _LOGGER.warning(
                    "%s: %s.%s for %s failed: %s",
                    self.name,
                    domain,
                    service,
                    data[ATTR_ENTITY_ID],
                    result,
                )


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Add one scene entity per stored starter scene."""
    store: MaxsenStore = entry.runtime_data
    async_add_entities(
        MaxsenStarterScene(entry.entry_id, scene) for scene in store.data["scenes"]
    )


async def async_reload_scenes(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Make the scene entities match the stored scenes.

    The platform is unloaded and set up again; scenes that no longer exist also
    leave the entity registry, so they do not linger as unavailable entities.
    """
    await hass.config_entries.async_unload_platforms(entry, [Platform.SCENE])
    registry = er.async_get(hass)
    wanted = {
        _unique_id(entry.entry_id, scene["id"]) for scene in entry.runtime_data.data["scenes"]
    }
    for entity in er.async_entries_for_config_entry(registry, entry.entry_id):
        if entity.domain == "scene" and entity.unique_id not in wanted:
            registry.async_remove(entity.entity_id)
    await hass.config_entries.async_forward_entry_setups(entry, [Platform.SCENE])


async def async_create_starter_scenes(
    hass: HomeAssistant, entry: ConfigEntry
) -> list[StarterScene]:
    """Replace the starter scenes, reload the entities and put them on the quick panel.

    Scenes the new list no longer has leave the quick panel; new ones are appended.
    """
    store: MaxsenStore = entry.runtime_data
    before = starter_entity_ids(hass, entry.entry_id, store.data["scenes"])
    scenes = await store.async_rebuild_starter_scenes()
    await async_reload_scenes(hass, entry)
    after = starter_entity_ids(hass, entry.entry_id, scenes)
    await store.async_update_starter_panel(after, set(before) - set(after))
    return scenes
