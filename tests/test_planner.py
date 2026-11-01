"""Tests for the Maxsen Planner client."""

import aiohttp
import pytest

from custom_components.maxsen.planner import (
    PlannerBadCode,
    PlannerClient,
    PlannerNotReady,
    PlannerRevoked,
    PlannerTooMany,
    PlannerUnreachable,
)
from homeassistant.helpers.aiohttp_client import async_get_clientsession

BASE = "https://planner.example.com"
PAIR_URL = f"{BASE}/api/public/home-assistant/pair"
HOME_URL = f"{BASE}/api/public/home-assistant/home"


@pytest.fixture
async def client(hass, aioclient_mock):
    return PlannerClient(async_get_clientsession(hass), BASE)


async def test_pair_returns_the_planner_answer(client, aioclient_mock):
    answer = {"token": "tok", "projectId": "p1", "title": "Test House"}
    aioclient_mock.post(PAIR_URL, json=answer)

    assert await client.pair("ABC123", "My HA") == answer
    assert aioclient_mock.mock_calls[0][2] == {"code": "ABC123", "deviceName": "My HA"}


@pytest.mark.parametrize(
    ("status", "body", "error"),
    [
        (400, {}, PlannerBadCode),
        (401, {"error": "bad-code"}, PlannerBadCode),
        (429, {"error": "too-many"}, PlannerTooMany),
        (500, {"error": "unavailable"}, PlannerUnreachable),
        (503, None, PlannerUnreachable),
    ],
)
async def test_pair_errors(client, aioclient_mock, status, body, error):
    aioclient_mock.post(PAIR_URL, status=status, json=body)
    with pytest.raises(error):
        await client.pair("ABC123", "My HA")


@pytest.mark.parametrize("exc", [TimeoutError(), aiohttp.ClientError()])
async def test_network_failures_are_unreachable(client, aioclient_mock, exc):
    aioclient_mock.post(PAIR_URL, exc=exc)
    aioclient_mock.get(HOME_URL, exc=exc)
    with pytest.raises(PlannerUnreachable):
        await client.pair("ABC123", "My HA")
    with pytest.raises(PlannerUnreachable):
        await client.fetch_home("tok")


async def test_fetch_home_returns_raw_bytes_and_sends_the_token(client, aioclient_mock):
    aioclient_mock.get(HOME_URL, content=b'{"format": "maxsen-home"}')

    assert await client.fetch_home("tok") == b'{"format": "maxsen-home"}'
    assert aioclient_mock.mock_calls[0][3]["Authorization"] == "Bearer tok"


@pytest.mark.parametrize("reason", ["revoked", "unknown"])
async def test_fetch_home_401_is_revoked(client, aioclient_mock, reason):
    aioclient_mock.get(HOME_URL, status=401, json={"error": reason})
    with pytest.raises(PlannerRevoked):
        await client.fetch_home("tok")


async def test_fetch_home_409_carries_the_planner_message(client, aioclient_mock):
    aioclient_mock.get(
        HOME_URL,
        status=409,
        json={"error": "not-saved", "message": "Save the project in the planner first."},
    )
    with pytest.raises(PlannerNotReady) as err:
        await client.fetch_home("tok")
    assert err.value.message == "Save the project in the planner first."


async def test_fetch_home_429_and_5xx(client, aioclient_mock):
    aioclient_mock.get(HOME_URL, status=429, json={"error": "too-many"})
    with pytest.raises(PlannerTooMany):
        await client.fetch_home("tok")
    aioclient_mock.clear_requests()
    aioclient_mock.get(HOME_URL, status=500, json={"error": "unavailable"})
    with pytest.raises(PlannerUnreachable):
        await client.fetch_home("tok")


async def test_base_url_trailing_slash_is_ignored(hass, aioclient_mock):
    aioclient_mock.post(PAIR_URL, json={"token": "t", "projectId": "p", "title": "T"})
    client = PlannerClient(async_get_clientsession(hass), BASE + "/")
    await client.pair("ABC123", "My HA")
