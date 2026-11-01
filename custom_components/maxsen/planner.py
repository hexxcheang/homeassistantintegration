"""Client for the Maxsen Planner's public Home Assistant routes."""

from __future__ import annotations

import json
from typing import Any

import aiohttp

REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=60)


class PlannerError(Exception):
    """Base class for planner errors."""


class PlannerBadCode(PlannerError):
    """The pairing code was wrong, used or expired."""


class PlannerRevoked(PlannerError):
    """The pairing token was revoked or is unknown."""


class PlannerTooMany(PlannerError):
    """The planner asked us to slow down (HTTP 429)."""


class PlannerUnreachable(PlannerError):
    """The planner could not be reached, timed out or had a server error."""


class PlannerNotReady(PlannerError):
    """The project has nothing to export yet (HTTP 409)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class PlannerClient:
    """Talk to one Maxsen Planner."""

    def __init__(self, session: aiohttp.ClientSession, base_url: str) -> None:
        self._session = session
        self._base_url = base_url.rstrip("/")

    async def _send(
        self, method: str, route: str, **kwargs: Any
    ) -> tuple[int, bytes]:
        """Send a request and return the status and body, or raise PlannerUnreachable."""
        url = f"{self._base_url}/api/public/home-assistant/{route}"
        try:
            async with self._session.request(
                method, url, timeout=REQUEST_TIMEOUT, **kwargs
            ) as response:
                return response.status, await response.read()
        except (TimeoutError, aiohttp.ClientError) as err:
            raise PlannerUnreachable(str(err)) from err

    async def pair(self, code: str, device_name: str) -> dict[str, str]:
        """Swap a pairing code for ``{"token", "projectId", "title"}``."""
        status, body = await self._send(
            "POST", "pair", json={"code": code, "deviceName": device_name}
        )
        if status in (400, 401):
            raise PlannerBadCode
        if status == 429:
            raise PlannerTooMany
        if status != 200:
            raise PlannerUnreachable(f"HTTP {status}")
        try:
            answer = json.loads(body)
            return {key: answer[key] for key in ("token", "projectId", "title")}
        except (ValueError, KeyError, TypeError) as err:
            raise PlannerUnreachable("unexpected pairing answer") from err

    async def fetch_home(self, token: str) -> bytes:
        """Download the home package as raw bytes."""
        status, body = await self._send(
            "GET", "home", headers={"Authorization": f"Bearer {token}"}
        )
        if status == 200:
            return body
        if status == 401:
            raise PlannerRevoked
        if status == 429:
            raise PlannerTooMany
        if status == 409:
            raise PlannerNotReady(_message_of(body))
        raise PlannerUnreachable(f"HTTP {status}")


def _message_of(body: bytes) -> str:
    """The planner's human-readable ``message`` from an error body, if any."""
    try:
        message = json.loads(body).get("message")
    except (ValueError, AttributeError):
        return ""
    return message if isinstance(message, str) else ""
