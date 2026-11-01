"""Shared fixtures for the Maxsen Home tests."""

import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Let Home Assistant load custom_components/maxsen in every test."""
    yield


@pytest.fixture(autouse=True)
def isolated_config_dir(request, tmp_path):
    """Give every test that uses ``hass`` its own empty config folder.

    Otherwise images saved by a test would land in the plugin's shared
    testing_config folder and leak into the next test.
    """
    if "hass" in request.fixturenames:
        request.getfixturevalue("hass").config.config_dir = str(tmp_path / "config")
    yield


@pytest.fixture
def home_package() -> dict:
    """A fresh copy of the small valid home package (2 levels, 2 images)."""
    return json.loads((FIXTURES / "home-v1.json").read_text())
