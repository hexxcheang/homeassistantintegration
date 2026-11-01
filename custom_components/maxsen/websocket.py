"""The maxsen/* websocket commands."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.file_upload import process_uploaded_file
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import (
    CONF_INSTALLER_MODE,
    CONF_PROJECT_ID,
    CONF_PLANNER_URL,
    CONF_SOURCE,
    CONF_TOKEN,
    SIGNAL_UPDATED,
    SOURCE_PLANNER,
)
from .entries import get_loaded_entry
from .scene import async_create_starter_scenes, async_reload_scenes
from .package import (
    PackageError,
    describe_changes,
    element_index,
    parse_package,
    remove_unreferenced_images,
    save_images,
)
from .planner import (
    PlannerClient,
    PlannerNotReady,
    PlannerRevoked,
    PlannerTooMany,
    PlannerUnreachable,
)

_LOGGER = logging.getLogger(__name__)

_ID = vol.All(str, vol.Length(min=1))

_LINK = vol.Any(
    None,
    vol.Schema({vol.Required("type"): vol.In(["device", "entity"]), vol.Required("id"): _ID}),
)
_QUICK_ITEM = vol.Schema(
    {vol.Required("type"): vol.In(["element", "entity"]), vol.Required("id"): _ID}
)


# What the panel says when a refresh file is rejected. The same sentences as the
# config flow (strings.json, config.error); a test keeps them in step.
_NOT_A_HOME_FILE = "This is not a Maxsen home file."
_REJECTED_MESSAGES = {
    "invalid_json": _NOT_A_HOME_FILE,
    "wrong_format": _NOT_A_HOME_FILE,
    "missing_image": _NOT_A_HOME_FILE,
    "unsupported_version": "This home file is from a newer planner. Update this integration.",
    "too_large": "This file is larger than 100 MB.",
}


def image_url(entry_id: str, image_id: str) -> str:
    """The URL the card loads a background image from."""
    return f"/api/maxsen/image/{entry_id}/{image_id}"


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register all commands. Call once per Home Assistant start."""
    websocket_api.async_register_command(hass, ws_home)
    websocket_api.async_register_command(hass, ws_links_set)
    websocket_api.async_register_command(hass, ws_quick_panel_set)
    websocket_api.async_register_command(hass, ws_display_set)
    websocket_api.async_register_command(hass, ws_subscribe)
    websocket_api.async_register_command(hass, ws_refresh_preview)
    websocket_api.async_register_command(hass, ws_refresh_apply)
    websocket_api.async_register_command(hass, ws_scenes_create_starter)


def _loaded_entry_or_error(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
):
    entry = get_loaded_entry(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Unknown home")
    return entry


def _installer_only(
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    entry,
    what: str,
) -> bool:
    """Send not_allowed and return False unless an admin may use installer tools here."""
    if connection.user.is_admin and entry.options.get(CONF_INSTALLER_MODE):
        return True
    connection.send_error(
        msg["id"],
        websocket_api.ERR_NOT_ALLOWED,
        f"{what} needs an administrator and installer mode",
    )
    return False


@websocket_api.websocket_command(
    {vol.Required("type"): "maxsen/home", vol.Required("entry_id"): str}
)
@callback
def ws_home(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the home for the card: package, links, quick panel, display setting, where it came from and image URLs."""
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
            "display": data["display"],
            "installer_mode": bool(entry.options.get(CONF_INSTALLER_MODE, False)),
            "source": entry.data[CONF_SOURCE],
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
    if not _installer_only(connection, msg, entry, "Linking"):
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
    {
        vol.Required("type"): "maxsen/display/set",
        vol.Required("entry_id"): str,
        vol.Required("background"): vol.In(["soft", "original"]),
    }
)
@websocket_api.async_response
async def ws_display_set(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Choose how floor plan backgrounds look on every screen. Needs an admin and installer mode, checked here."""
    if (entry := _loaded_entry_or_error(hass, connection, msg)) is None:
        return
    if not _installer_only(connection, msg, entry, "Changing the display"):
        return

    store = entry.runtime_data
    await store.async_set_display({"background": msg["background"]})
    connection.send_result(msg["id"], {"display": store.data["display"]})


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


def _read_upload(hass: HomeAssistant, file_id: str) -> bytes:
    with process_uploaded_file(hass, file_id) as path:
        return path.read_bytes()


def _send_planner_error(
    connection: websocket_api.ActiveConnection, msg_id: int, err: Exception
) -> None:
    """Report a failed download in the words the panel shows."""
    if isinstance(err, PlannerRevoked):
        code, message = "revoked", (
            "Connection revoked: ask Maxsen for a new pairing code, then use "
            "Reconfigure on the Maxsen Home integration."
        )
    elif isinstance(err, PlannerTooMany):
        code, message = "too_many", "The planner is busy. Try again in 15 minutes."
    elif isinstance(err, PlannerNotReady):
        code = "not_ready"
        message = err.message or "The project is not ready to be exported yet"
    else:
        code, message = "cannot_connect", "Can't reach the planner"
    connection.send_error(msg_id, code, message)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "maxsen/refresh/preview",
        vol.Required("entry_id"): str,
        vol.Optional("file_id"): _ID,
    }
)
@websocket_api.async_response
async def ws_refresh_preview(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Fetch (or read an uploaded) home and report what a refresh would change.

    Nothing is saved; the parsed package is kept for ten minutes for apply.
    """
    if (entry := _loaded_entry_or_error(hass, connection, msg)) is None:
        return
    if not _installer_only(connection, msg, entry, "Refreshing"):
        return

    file_id = msg.get("file_id")
    if file_id is not None:
        try:
            raw = await hass.async_add_executor_job(_read_upload, hass, file_id)
        except (ValueError, OSError):
            connection.send_error(
                msg["id"], "invalid_package", "That file is no longer available"
            )
            return
    elif entry.data[CONF_SOURCE] == SOURCE_PLANNER:
        client = PlannerClient(async_get_clientsession(hass), entry.data[CONF_PLANNER_URL])
        try:
            raw = await client.fetch_home(entry.data[CONF_TOKEN])
        except (
            PlannerRevoked,
            PlannerTooMany,
            PlannerNotReady,
            PlannerUnreachable,
        ) as err:
            _send_planner_error(connection, msg["id"], err)
            return
    else:
        connection.send_error(
            msg["id"], "invalid_package", "Choose the file to refresh from"
        )
        return

    try:
        package = await hass.async_add_executor_job(parse_package, raw)
    except PackageError as err:
        connection.send_error(
            msg["id"],
            "invalid_package",
            _REJECTED_MESSAGES.get(err.reason, _NOT_A_HOME_FILE),
        )
        return

    if package["project"]["id"] != entry.data[CONF_PROJECT_ID]:
        connection.send_error(
            msg["id"], "invalid_package", "This home file is for a different project."
        )
        return

    store = entry.runtime_data
    summary = describe_changes(store.data["package"], package)
    connection.send_result(
        msg["id"], {"preview_id": store.keep_preview(package), **summary}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "maxsen/refresh/apply",
        vol.Required("entry_id"): str,
        vol.Required("preview_id"): str,
    }
)
@websocket_api.async_response
async def ws_refresh_apply(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Save a previewed home: images, package, and tidy links and the quick panel."""
    if (entry := _loaded_entry_or_error(hass, connection, msg)) is None:
        return
    if not _installer_only(connection, msg, entry, "Refreshing"):
        return

    store = entry.runtime_data
    async with store.refresh_lock:
        package = store.take_preview(msg["preview_id"])
        if package is None:
            connection.send_error(
                msg["id"], "preview_expired", "The preview expired. Preview again."
            )
            return

        summary = describe_changes(store.data["package"], package)
        removed_ids = {element["id"] for element in summary["removed"]}
        try:
            slim = await save_images(hass, entry.entry_id, package)
            scenes_changed = await store.async_apply_refresh(slim, removed_ids)
        except (PackageError, OSError):
            # Writing the images can fail here. A failed store write does not
            # raise: Home Assistant's Store only logs it.
            _LOGGER.warning("Could not save the refreshed home", exc_info=True)
            connection.send_error(
                msg["id"], "save_failed", "Could not save the refreshed home"
            )
            return
        try:
            await remove_unreferenced_images(hass, entry.entry_id, store.data["package"])
        except OSError:
            _LOGGER.warning("Could not delete old images", exc_info=True)
        if scenes_changed:
            await async_reload_scenes(hass, entry)

    connection.send_result(msg["id"], {"preview_id": msg["preview_id"], **summary})


@websocket_api.websocket_command(
    {vol.Required("type"): "maxsen/scenes/create_starter", vol.Required("entry_id"): str}
)
@websocket_api.async_response
async def ws_scenes_create_starter(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """(Re)create the starter scenes from the current links and show them on the quick panel."""
    if (entry := _loaded_entry_or_error(hass, connection, msg)) is None:
        return
    if not _installer_only(connection, msg, entry, "Creating scenes"):
        return

    # Shared with refresh: both reload the scene entities, one at a time.
    async with entry.runtime_data.refresh_lock:
        scenes = await async_create_starter_scenes(hass, entry)
    connection.send_result(msg["id"], {"scenes": scenes})
