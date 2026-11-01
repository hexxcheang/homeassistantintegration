"""Config flow and options flow for Maxsen Home."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from yarl import URL

from homeassistant.components.file_upload import process_uploaded_file
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import FileSelector, FileSelectorConfig

from .const import (
    CONF_INSTALLER_MODE,
    CONF_PLANNER_URL,
    CONF_PROJECT_ID,
    CONF_SOURCE,
    CONF_TITLE,
    CONF_TOKEN,
    DOMAIN,
    SOURCE_FILE,
    SOURCE_PLANNER,
)
from .package import PackageError, parse_package
from .planner import (
    PlannerBadCode,
    PlannerClient,
    PlannerError,
    PlannerNotReady,
    PlannerRevoked,
    PlannerTooMany,
)

CONF_CODE = "code"
CONF_FILE = "file"

_PLAIN_HTTP_HOSTS = ("localhost", "127.0.0.1")

# How a rejected package is shown to the installer.
_PACKAGE_ERRORS = {
    "invalid_json": "invalid_file",
    "wrong_format": "invalid_file",
    "missing_image": "invalid_file",
    "unsupported_version": "unsupported_version",
    "too_large": "too_large",
}


def normalise_planner_url(value: str) -> str | None:
    """Return the planner address without trailing slashes, or None if unusable."""
    value = value.strip().rstrip("/")
    try:
        url = URL(value)
    except ValueError:
        return None
    if not url.host or url.scheme not in ("http", "https"):
        return None
    if url.scheme == "http" and url.host not in _PLAIN_HTTP_HOSTS:
        return None
    return value


def _read_upload(hass: HomeAssistant, file_id: str) -> bytes:
    with process_uploaded_file(hass, file_id) as path:
        return path.read_bytes()


class MaxsenConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add a planned home, by pairing with the planner or from a file."""

    VERSION = 1

    def __init__(self) -> None:
        self._paired: dict[str, str] | None = None
        self._paired_with: tuple[str, str] | None = None

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> MaxsenOptionsFlow:
        """Return the options flow."""
        return MaxsenOptionsFlow()

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Choose how to bring in the home."""
        return self.async_show_menu(step_id="user", menu_options=["pair", "upload"])

    async def async_step_pair(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Pair with the planner using a code and download the home."""
        errors: dict[str, str] = {}
        placeholders: dict[str, str] = {}
        if user_input is not None:
            planner_url = normalise_planner_url(user_input[CONF_PLANNER_URL])
            if planner_url is None:
                errors[CONF_PLANNER_URL] = "invalid_url"
            else:
                try:
                    return await self._pair_and_create(planner_url, user_input[CONF_CODE])
                except PlannerBadCode:
                    errors["base"] = "bad_code"
                except PlannerRevoked:
                    self._paired = None
                    errors["base"] = "bad_code"
                except PlannerTooMany:
                    errors["base"] = "too_many"
                except PlannerNotReady as err:
                    errors["base"] = "not_ready"
                    placeholders["message"] = err.message
                except PlannerError:
                    errors["base"] = "cannot_connect"
                except PackageError as err:
                    errors["base"] = _PACKAGE_ERRORS[err.reason]

        defaults = user_input or {}
        return self.async_show_form(
            step_id="pair",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_PLANNER_URL, default=defaults.get(CONF_PLANNER_URL, "https://")
                    ): str,
                    vol.Required(CONF_CODE, default=defaults.get(CONF_CODE, "")): str,
                }
            ),
            errors=errors,
            description_placeholders=placeholders,
        )

    async def _pair_and_create(self, planner_url: str, code: str) -> ConfigFlowResult:
        client = PlannerClient(async_get_clientsession(self.hass), planner_url)
        # A pairing code works once. If the download failed after pairing
        # (the planner said the home is not ready), a retry reuses the pairing.
        code = code.strip()
        if self._paired is None or self._paired_with != (planner_url, code):
            self._paired = None
            self._paired = await client.pair(
                code, self.hass.config.location_name or "Home Assistant"
            )
            self._paired_with = (planner_url, code)
        paired = self._paired

        await self.async_set_unique_id(paired["projectId"])
        self._abort_if_unique_id_configured()

        raw = await client.fetch_home(paired["token"])
        package = await self.hass.async_add_executor_job(parse_package, raw)
        return self._create(
            package,
            {
                CONF_SOURCE: SOURCE_PLANNER,
                CONF_PLANNER_URL: planner_url,
                CONF_TOKEN: paired["token"],
                CONF_PROJECT_ID: paired["projectId"],
                CONF_TITLE: paired["title"],
            },
        )

    async def async_step_upload(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Bring in the home from a file exported by the planner."""
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                raw = await self.hass.async_add_executor_job(
                    _read_upload, self.hass, user_input[CONF_FILE]
                )
                package = await self.hass.async_add_executor_job(parse_package, raw)
            except (ValueError, OSError):
                errors["base"] = "invalid_file"
            except PackageError as err:
                errors["base"] = _PACKAGE_ERRORS[err.reason]
            else:
                project = package["project"]
                await self.async_set_unique_id(project["id"])
                self._abort_if_unique_id_configured()
                return self._create(
                    package,
                    {
                        CONF_SOURCE: SOURCE_FILE,
                        CONF_PROJECT_ID: project["id"],
                        CONF_TITLE: project["title"],
                    },
                )

        return self.async_show_form(
            step_id="upload",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_FILE): FileSelector(
                        FileSelectorConfig(accept=".json")
                    )
                }
            ),
            errors=errors,
        )

    def _create(self, package: dict, data: dict[str, Any]) -> ConfigFlowResult:
        """Hand the validated package to entry setup and create the entry.

        Nothing is written to disk here: the entry (and so its folder and store)
        does not exist yet. Setup picks the package up from ``hass.data``.
        """
        self.hass.data.setdefault(DOMAIN, {}).setdefault("pending", {})[
            data[CONF_PROJECT_ID]
        ] = package
        return self.async_create_entry(
            title=data[CONF_TITLE],
            data=data,
            options={CONF_INSTALLER_MODE: True},
        )


class MaxsenOptionsFlow(OptionsFlow):
    """Installer options."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Turn installer mode on or off."""
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_INSTALLER_MODE,
                        default=self.config_entry.options.get(CONF_INSTALLER_MODE, True),
                    ): bool
                }
            ),
        )
