"""Tests for the Maxsen Home config flow and options flow."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.maxsen.const import CONF_INSTALLER_MODE, DOMAIN
from custom_components.maxsen.scene import async_create_starter_scenes
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType

BASE = "https://planner.example.com"
PAIR_URL = f"{BASE}/api/public/home-assistant/pair"
HOME_URL = f"{BASE}/api/public/home-assistant/home"
FILE_ID = "0e8f2c1a-5b7d-4f6a-9c3e-1b2d4a6c8e0f"  # the file selector wants a UUID
PAIRED = {"token": "secret-token", "projectId": "proj-test-house", "title": "Test House"}


async def start(hass, step: str):
    """Open the config flow and pick a menu entry."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.MENU
    assert result["menu_options"] == ["pair", "upload"]
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": step}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == step
    return result


async def submit_pair(hass, flow_id, url=BASE, code="ABC123"):
    return await hass.config_entries.flow.async_configure(
        flow_id, {"planner_url": url, "code": code}
    )


def written_files(hass) -> list[Path]:
    folder = Path(hass.config.path("maxsen"))
    return list(folder.rglob("*")) if folder.exists() else []


async def test_pair_success_creates_entry(hass, aioclient_mock, home_package):
    aioclient_mock.post(PAIR_URL, json=PAIRED)
    aioclient_mock.get(HOME_URL, json=home_package)

    result = await start(hass, "pair")
    result = await submit_pair(hass, result["flow_id"], url=BASE + "//")

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Test House"
    assert result["data"] == {
        "source": "planner",
        "planner_url": BASE,
        "token": "secret-token",
        "project_id": "proj-test-house",
        "title": "Test House",
    }
    assert result["options"] == {CONF_INSTALLER_MODE: True}
    entry = result["result"]
    assert entry.unique_id == "proj-test-house"

    # The device name is the Home Assistant location name.
    assert aioclient_mock.mock_calls[0][2] == {
        "code": "ABC123",
        "deviceName": hass.config.location_name,
    }
    assert aioclient_mock.mock_calls[1][3]["Authorization"] == "Bearer secret-token"

    # Setting up the new entry saved the images.
    folder = Path(hass.config.path("maxsen", entry.entry_id))
    assert sorted(p.name for p in folder.iterdir()) == ["file-l1.png", "file-l2.png"]


@pytest.mark.parametrize(
    ("status", "error"),
    [(401, "bad_code"), (400, "bad_code"), (429, "too_many"), (500, "cannot_connect")],
)
async def test_pair_errors(hass, aioclient_mock, status, error):
    aioclient_mock.post(PAIR_URL, status=status, json={"error": "x"})

    result = await start(hass, "pair")
    result = await submit_pair(hass, result["flow_id"])

    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "pair"
    assert result["errors"] == {"base": error}
    assert hass.config_entries.async_entries(DOMAIN) == []
    assert written_files(hass) == []


async def test_pair_timeout_is_cannot_connect(hass, aioclient_mock):
    aioclient_mock.post(PAIR_URL, exc=TimeoutError())

    result = await start(hass, "pair")
    result = await submit_pair(hass, result["flow_id"])

    assert result["errors"] == {"base": "cannot_connect"}


@pytest.mark.parametrize(
    "url", ["http://planner.example.com", "planner.example.com", "ftp://x", "https://"]
)
async def test_pair_rejects_bad_urls_without_calling_the_planner(
    hass, aioclient_mock, url
):
    result = await start(hass, "pair")
    result = await submit_pair(hass, result["flow_id"], url=url)

    assert result["errors"] == {"planner_url": "invalid_url"}
    assert aioclient_mock.call_count == 0


@pytest.mark.parametrize("url", ["http://localhost:3000", "http://127.0.0.1:3000/"])
async def test_pair_allows_plain_http_on_localhost(hass, aioclient_mock, home_package, url):
    base = url.rstrip("/")
    aioclient_mock.post(f"{base}/api/public/home-assistant/pair", json=PAIRED)
    aioclient_mock.get(f"{base}/api/public/home-assistant/home", json=home_package)

    result = await start(hass, "pair")
    result = await submit_pair(hass, result["flow_id"], url=url)

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["planner_url"] == base


async def test_pair_not_ready_shows_the_planner_message_and_retry_reuses_the_pairing(
    hass, aioclient_mock, home_package
):
    aioclient_mock.post(PAIR_URL, json=PAIRED)
    aioclient_mock.get(
        HOME_URL,
        status=409,
        json={"error": "not-saved", "message": "Save the project in the planner first."},
    )

    result = await start(hass, "pair")
    result = await submit_pair(hass, result["flow_id"])

    assert result["errors"] == {"base": "not_ready"}
    assert result["description_placeholders"] == {
        "message": "Save the project in the planner first."
    }

    # The code is spent now, so a retry must not pair a second time.
    aioclient_mock.clear_requests()
    aioclient_mock.get(HOME_URL, json=home_package)
    result = await submit_pair(hass, result["flow_id"])

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["token"] == "secret-token"
    assert [call[0] for call in aioclient_mock.mock_calls] == ["GET"]


async def test_pair_revoked_on_download_is_bad_code_and_retry_pairs_again(
    hass, aioclient_mock, home_package
):
    aioclient_mock.post(PAIR_URL, json=PAIRED)
    aioclient_mock.get(HOME_URL, status=401, json={"error": "revoked"})

    result = await start(hass, "pair")
    result = await submit_pair(hass, result["flow_id"])
    assert result["errors"] == {"base": "bad_code"}

    # The pairing is thrown away, so the retry pairs again with the new code.
    aioclient_mock.clear_requests()
    aioclient_mock.post(PAIR_URL, json={**PAIRED, "token": "second-token"})
    aioclient_mock.get(HOME_URL, json=home_package)
    result = await submit_pair(hass, result["flow_id"], code="NEWCODE")

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["token"] == "second-token"
    assert [call[0] for call in aioclient_mock.mock_calls] == ["POST", "GET"]


async def test_pair_too_many_on_download_keeps_the_pairing(
    hass, aioclient_mock, home_package
):
    aioclient_mock.post(PAIR_URL, json=PAIRED)
    aioclient_mock.get(HOME_URL, status=429, json={"error": "too-many"})

    result = await start(hass, "pair")
    result = await submit_pair(hass, result["flow_id"])
    assert result["errors"] == {"base": "too_many"}

    aioclient_mock.clear_requests()
    aioclient_mock.get(HOME_URL, json=home_package)
    result = await submit_pair(hass, result["flow_id"])

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["token"] == "secret-token"
    assert [call[0] for call in aioclient_mock.mock_calls] == ["GET"]


async def test_pair_home_download_failure_is_cannot_connect(hass, aioclient_mock):
    aioclient_mock.post(PAIR_URL, json=PAIRED)
    aioclient_mock.get(HOME_URL, status=503)

    result = await start(hass, "pair")
    result = await submit_pair(hass, result["flow_id"])

    assert result["errors"] == {"base": "cannot_connect"}


async def test_pair_bad_package_from_planner_is_invalid_file(
    hass, aioclient_mock, home_package
):
    home_package["schemaVersion"] = 2
    aioclient_mock.post(PAIR_URL, json=PAIRED)
    aioclient_mock.get(HOME_URL, json=home_package)

    result = await start(hass, "pair")
    result = await submit_pair(hass, result["flow_id"])

    assert result["errors"] == {"base": "unsupported_version"}
    assert hass.config_entries.async_entries(DOMAIN) == []
    assert written_files(hass) == []


async def test_pair_duplicate_project_aborts(hass, aioclient_mock):
    MockConfigEntry(domain=DOMAIN, unique_id="proj-test-house").add_to_hass(hass)
    aioclient_mock.post(PAIR_URL, json=PAIRED)

    result = await start(hass, "pair")
    result = await submit_pair(hass, result["flow_id"])

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


def upload_file(tmp_path: Path, content: bytes):
    """Patch the uploaded-file helper so it serves ``content``."""
    path = tmp_path / "home.json"
    path.write_bytes(content)

    class _Uploaded:
        def __enter__(self):
            return path

        def __exit__(self, *exc):
            return False

    return patch(
        "custom_components.maxsen.config_flow.process_uploaded_file",
        return_value=_Uploaded(),
    )


async def submit_upload(hass, flow_id, tmp_path, content: bytes):
    with upload_file(tmp_path, content):
        return await hass.config_entries.flow.async_configure(
            flow_id, {"file": FILE_ID}
        )


async def test_upload_success_creates_entry(hass, tmp_path, home_package):
    result = await start(hass, "upload")
    result = await submit_upload(
        hass, result["flow_id"], tmp_path, json.dumps(home_package).encode()
    )

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Test House"
    assert result["data"] == {
        "source": "file",
        "project_id": "proj-test-house",
        "title": "Test House",
    }
    assert result["options"] == {CONF_INSTALLER_MODE: True}
    assert result["result"].unique_id == "proj-test-house"
    folder = Path(hass.config.path("maxsen", result["result"].entry_id))
    assert sorted(p.name for p in folder.iterdir()) == ["file-l1.png", "file-l2.png"]


async def test_upload_unsupported_version_writes_nothing(hass, tmp_path, home_package):
    home_package["schemaVersion"] = 2

    result = await start(hass, "upload")
    result = await submit_upload(
        hass, result["flow_id"], tmp_path, json.dumps(home_package).encode()
    )

    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "upload"
    assert result["errors"] == {"base": "unsupported_version"}
    assert hass.config_entries.async_entries(DOMAIN) == []
    assert written_files(hass) == []
    assert DOMAIN not in hass.data or not hass.data[DOMAIN].get("pending")


@pytest.mark.parametrize(
    ("content", "error"),
    [
        (b"{", "invalid_file"),
        (b"[]", "invalid_file"),
        (b'{"format": "other"}', "invalid_file"),
        (b"x" * (100 * 1024 * 1024 + 1), "too_large"),
    ],
)
async def test_upload_bad_files(hass, tmp_path, content, error):
    result = await start(hass, "upload")
    result = await submit_upload(hass, result["flow_id"], tmp_path, content)

    assert result["errors"] == {"base": error}
    assert hass.config_entries.async_entries(DOMAIN) == []
    assert written_files(hass) == []


async def test_upload_missing_image_is_invalid_file(hass, tmp_path, home_package):
    del home_package["images"]["file-l2"]

    result = await start(hass, "upload")
    result = await submit_upload(
        hass, result["flow_id"], tmp_path, json.dumps(home_package).encode()
    )

    assert result["errors"] == {"base": "invalid_file"}


async def test_upload_corrupt_image_data_is_invalid_file(hass, tmp_path, home_package):
    home_package["images"]["file-l1"]["data"] = "***not base64***"

    result = await start(hass, "upload")
    result = await submit_upload(
        hass, result["flow_id"], tmp_path, json.dumps(home_package).encode()
    )

    assert result["errors"] == {"base": "invalid_file"}
    assert hass.config_entries.async_entries(DOMAIN) == []
    assert written_files(hass) == []
    assert DOMAIN not in hass.data or not hass.data[DOMAIN].get("pending")


async def test_upload_unknown_file_id_is_invalid_file(hass):
    result = await start(hass, "upload")
    # No file_upload data exists in this test, so the lookup fails.
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"file": FILE_ID}
    )

    assert result["errors"] == {"base": "invalid_file"}


async def test_upload_duplicate_project_aborts(hass, tmp_path, home_package):
    MockConfigEntry(domain=DOMAIN, unique_id="proj-test-house").add_to_hass(hass)

    result = await start(hass, "upload")
    result = await submit_upload(
        hass, result["flow_id"], tmp_path, json.dumps(home_package).encode()
    )

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"
    assert written_files(hass) == []


async def test_options_flow_toggles_installer_mode(hass, home_package):
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id="proj-test-house",
        data={"source": "file", "project_id": "proj-test-house", "title": "Test House"},
        options={CONF_INSTALLER_MODE: True},
    )
    entry.add_to_hass(hass)
    hass.data.setdefault(DOMAIN, {}).setdefault("pending", {})[
        "proj-test-house"
    ] = home_package
    await hass.config_entries.async_setup(entry.entry_id)

    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "init"

    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_INSTALLER_MODE: False}
    )

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options == {CONF_INSTALLER_MODE: False}


# ---------------------------------------------------------------- reconfigure


async def set_up_home(hass, home_package, data) -> MockConfigEntry:
    """A loaded home with a link, a quick panel and starter scenes."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id="proj-test-house",
        title="Test House",
        data={"project_id": "proj-test-house", "title": "Test House", **data},
        options={CONF_INSTALLER_MODE: True},
    )
    entry.add_to_hass(hass)
    hass.data.setdefault(DOMAIN, {}).setdefault("pending", {})[
        "proj-test-house"
    ] = home_package
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    store = entry.runtime_data
    await store.async_set_links({"dl1": {"type": "entity", "id": "light.porch"}})
    await store.async_set_quick_panel([{"type": "element", "id": "dl1"}])
    await async_create_starter_scenes(hass, entry)
    return entry


PLANNER_DATA = {"source": "planner", "planner_url": BASE, "token": "old-token"}
NEW_BASE = "https://new-planner.example.com"
NEW_PAIR_URL = f"{NEW_BASE}/api/public/home-assistant/pair"


async def test_reconfigure_form_is_prefilled_with_the_planner_address(
    hass, home_package
):
    entry = await set_up_home(hass, home_package, PLANNER_DATA)

    result = await entry.start_reconfigure_flow(hass)

    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "reconfigure"
    defaults = {
        str(key): key.default() for key in result["data_schema"].schema
    }
    assert defaults == {"planner_url": BASE, "code": ""}


async def test_reconfigure_pairs_again_and_keeps_everything(
    hass, aioclient_mock, home_package
):
    entry = await set_up_home(hass, home_package, PLANNER_DATA)
    before = {
        key: entry.runtime_data.data[key] for key in ("links", "quick_panel", "scenes")
    }
    assert before["scenes"]
    aioclient_mock.post(NEW_PAIR_URL, json={**PAIRED, "token": "new-token"})

    result = await entry.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"planner_url": NEW_BASE + "/", "code": " NEW123 "}
    )
    await hass.async_block_till_done()

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reconfigure_successful"
    assert aioclient_mock.mock_calls[0][2] == {
        "code": "NEW123",
        "deviceName": hass.config.location_name,
    }
    assert entry.data == {
        "source": "planner",
        "planner_url": NEW_BASE,
        "token": "new-token",
        "project_id": "proj-test-house",
        "title": "Test House",
    }
    # The entry was reloaded from what it had stored: nothing was lost.
    assert entry.state is config_entries.ConfigEntryState.LOADED
    after = {
        key: entry.runtime_data.data[key] for key in ("links", "quick_panel", "scenes")
    }
    assert after == before
    assert entry.runtime_data.data["package"]["project"]["id"] == "proj-test-house"
    assert hass.states.get("scene.all_off") is not None


async def test_reconfigure_turns_a_file_home_into_a_planner_home(
    hass, aioclient_mock, home_package
):
    entry = await set_up_home(hass, home_package, {"source": "file"})
    aioclient_mock.post(PAIR_URL, json=PAIRED)

    result = await entry.start_reconfigure_flow(hass)
    defaults = {str(key): key.default() for key in result["data_schema"].schema}
    assert defaults["planner_url"] == "https://"
    result = await submit_pair(hass, result["flow_id"])
    await hass.async_block_till_done()

    assert result["reason"] == "reconfigure_successful"
    assert entry.data["source"] == "planner"
    assert entry.data["planner_url"] == BASE
    assert entry.data["token"] == "secret-token"
    assert entry.runtime_data.data["links"] == {
        "dl1": {"type": "entity", "id": "light.porch"}
    }


async def test_reconfigure_with_a_code_for_another_project_aborts(
    hass, aioclient_mock, home_package
):
    entry = await set_up_home(hass, home_package, PLANNER_DATA)
    aioclient_mock.post(PAIR_URL, json={**PAIRED, "projectId": "proj-other"})

    result = await entry.start_reconfigure_flow(hass)
    result = await submit_pair(hass, result["flow_id"])

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "wrong_project"
    assert entry.data["token"] == "old-token"


@pytest.mark.parametrize(
    ("status", "error"),
    [(401, "bad_code"), (400, "bad_code"), (429, "too_many"), (500, "cannot_connect")],
)
async def test_reconfigure_errors_show_on_the_form(
    hass, aioclient_mock, home_package, status, error
):
    entry = await set_up_home(hass, home_package, PLANNER_DATA)
    aioclient_mock.post(PAIR_URL, status=status, json={"error": "x"})

    result = await entry.start_reconfigure_flow(hass)
    result = await submit_pair(hass, result["flow_id"], code="WRONG")

    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "reconfigure"
    assert result["errors"] == {"base": error}
    assert entry.data["token"] == "old-token"


async def test_reconfigure_rejects_a_bad_address(hass, aioclient_mock, home_package):
    entry = await set_up_home(hass, home_package, PLANNER_DATA)

    result = await entry.start_reconfigure_flow(hass)
    result = await submit_pair(hass, result["flow_id"], url="http://planner.example.com")

    assert result["errors"] == {"planner_url": "invalid_url"}
    assert aioclient_mock.call_count == 0
