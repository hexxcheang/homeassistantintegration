"""Constants for the Maxsen Home integration."""

DOMAIN = "maxsen"

# Home package contract with the Maxsen Planner.
PACKAGE_FORMAT = "maxsen-home"
PACKAGE_SCHEMA_VERSION = 1
MAX_PACKAGE_BYTES = 100 * 1024 * 1024

# Config entry data keys and values.
CONF_SOURCE = "source"
CONF_PLANNER_URL = "planner_url"
CONF_TOKEN = "token"
CONF_PROJECT_ID = "project_id"
CONF_TITLE = "title"
SOURCE_PLANNER = "planner"
SOURCE_FILE = "file"

# Options.
CONF_INSTALLER_MODE = "installer_mode"

# Lighting categories link to entities; every other category links to devices.
LIGHTING_CATEGORIES = frozenset(
    {
        "downlights",
        "surface-lights",
        "track-lights",
        "led-strips",
        "magnetic-track-lights",
        "pendant-lights",
        "spotlights",
        "misc-lighting",
        "ceiling-fans",
    }
)

# Starter scene names.
SCENE_ALL_OFF = "All off"
SCENE_ALL_OFF_LEVEL = "All off – {level}"
SCENE_ALL_LIGHTS_OFF = "All lights off"
