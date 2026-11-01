"""The maxsen/* websocket commands."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import CONF_INSTALLER_MODE, SIGNAL_UPDATED
from .entries import get_loaded_entry
from .package import element_index

_ID = vol.All(str, vol.Length(min=1))

_LINK = vol.Any(
    None,
    vol.Schema({vol.Required("type"): vol.In(["device", "entity"]), vol.Required("id"): _ID}),
)
_QUICK_ITEM = vol.Schema(
    {vol.Required("type"): vol.In(["element", "entity"]), vol.Required("id"): _ID}
)


def image_url(entry_id: str, image_id: str) -> str:
    """The URL the card loads a background image from."""
    return f"/api/maxsen/image/{entry_id}/{image_id}"


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register all commands. Call once per Home Assistant start."""
    websocket_api.async_register_command(hass, ws_home)
    websocket_api.async_register_command(hass, ws_links_set)
    websocket_api.async_register_command(hass, ws_quick_panel_set)
    websocket_api.async_register_command(hass, ws_subscribe)


def _loaded_entry_or_error(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
):
    entry = get_loaded_entry(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Unknown home")
    return entry


@websocket_api.websocket_command(
    {vol.Required("type"): "maxsen/home", vol.Required("entry_id"): str}
)
@callback
def ws_home(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the home for the card: package, links, quick panel and image URLs."""
    if (entry := _loaded_entry_or_error(hass, connection, msg)) is None:
        return
    data = entry.runtime_data.data
    package = data["package"]
    image_ids = package.get("image_types", {}) if package else {}
    connection.send_result(
        msg["id"],
        {
            "package": package,
            "links": data["links"],
            "quick_panel": data["quick_panel"],
            "installer_mode": bool(entry.options.get(CONF_INSTALLER_MODE, False)),
            "image_urls": {
                image_id: image_url(entry.entry_id, image_id) for image_id in image_ids
            },
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "maxsen/links/set",
        vol.Required("entry_id"): str,
        vol.Required("updates"): {_ID: _LINK},
    }
)
@websocket_api.async_response
async def ws_links_set(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Link or unlink elements. Needs an admin and installer mode, checked here."""
    if (entry := _loaded_entry_or_error(hass, connection, msg)) is None:
        return
    if not connection.user.is_admin or not entry.options.get(CONF_INSTALLER_MODE):
        connection.send_error(
            msg["id"],
            websocket_api.ERR_NOT_ALLOWED,
            "Linking needs an administrator and installer mode",
        )
        return

    store = entry.runtime_data
    package = store.data["package"]
    known = element_index(package) if package else {}
    if any(element_id not in known for element_id in msg["updates"]):
        connection.send_error(
            msg["id"], "invalid_element", "An element is not in this home"
        )
        return

    await store.async_set_links(msg["updates"])
    connection.send_result(msg["id"], {"links": store.data["links"]})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "maxsen/quick_panel/set",
        vol.Required("entry_id"): str,
        vol.Required("items"): [_QUICK_ITEM],
    }
)
@websocket_api.async_response
async def ws_quick_panel_set(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Replace the shared quick panel. Any logged-in user may do this."""
    if (entry := _loaded_entry_or_error(hass, connection, msg)) is None:
        return
    store = entry.runtime_data
    await store.async_set_quick_panel(msg["items"])
    connection.send_result(msg["id"], {"quick_panel": store.data["quick_panel"]})


@websocket_api.websocket_command(
    {vol.Required("type"): "maxsen/subscribe", vol.Required("entry_id"): str}
)
@callback
def ws_subscribe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Push {"event": "home"|"links"|"quick_panel"} when that part changes."""
    if (entry := _loaded_entry_or_error(hass, connection, msg)) is None:
        return

    @callback
    def forward(event: str) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], {"event": event}))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_UPDATED.format(entry_id=entry.entry_id), forward
    )
    connection.send_result(msg["id"])
