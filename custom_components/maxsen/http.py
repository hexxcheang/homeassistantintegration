"""HTTP view that serves the saved floor plan background images."""

from __future__ import annotations

import re
from pathlib import Path

from aiohttp import web

from homeassistant.components.http import HomeAssistantView

from .entries import get_loaded_entry
from .package import IMAGE_EXTENSIONS

_IMAGE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Stored media type -> the type served. Anything else is never served, so a
# package cannot make Home Assistant answer with HTML or script.
_SERVED_TYPES = {
    "image/png": "image/png",
    "image/jpeg": "image/jpeg",
    "image/jpg": "image/jpeg",
    "image/webp": "image/webp",
}


class MaxsenImageView(HomeAssistantView):
    """GET /api/maxsen/image/{entry_id}/{image_id} for logged-in users."""

    url = "/api/maxsen/image/{entry_id}/{image_id}"
    name = "api:maxsen:image"
    requires_auth = True

    async def get(
        self, request: web.Request, entry_id: str, image_id: str
    ) -> web.Response:
        hass = request.app["hass"]
        entry = get_loaded_entry(hass, entry_id)
        if entry is None or not _IMAGE_ID.match(image_id):
            return web.Response(status=404)

        package = entry.runtime_data.data["package"] or {}
        stored_type = package.get("image_types", {}).get(image_id)
        content_type = _SERVED_TYPES.get(stored_type)
        if content_type is None:
            return web.Response(status=404)

        path = Path(
            hass.config.path(
                "maxsen", entry.entry_id, f"{image_id}.{IMAGE_EXTENSIONS[stored_type]}"
            )
        )
        try:
            body = await hass.async_add_executor_job(path.read_bytes)
        except OSError:
            return web.Response(status=404)
        return web.Response(
            body=body,
            content_type=content_type,
            headers={"X-Content-Type-Options": "nosniff"},
        )
