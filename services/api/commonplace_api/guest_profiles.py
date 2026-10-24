"""Selectable prototype profiles. Image/object storage and sessions remain separate."""
import re
from threading import Lock
from uuid import uuid4

import httpx

from .config import Settings
from .store import Store


class ProfileError(Exception):
    pass


class DatabaseMissing(ProfileError):
    pass


class Profiles:
    provider = "local"
    notice = "Temporary users reset when the test backend restarts. Images and object history are separate."

    def __init__(self):
        self.rows = {}
        self.lock = Lock()

    def list(self):
        with self.lock:
            return sorted((dict(row) for row in self.rows.values()), key=lambda row: (row["name"].casefold(), row["id"]))

    def get(self, user_id):
        return next((row for row in self.list() if row["id"] == user_id), None)

    def create(self, name):
        profile = {"id": "guest-" + uuid4().hex, "name": name, "household_id": "demo-home"}
        self.save(profile)
        return profile

    def save(self, profile):
        with self.lock:
            self.rows[profile["id"]] = dict(profile)


class SqliteProfiles(Profiles):
    provider = "sqlite"
    notice = "Users are saved in the local SQLite database and remain after backend restarts."

    def __init__(self, store):
        self.store = store

    def list(self):
        return self.store.guest_profiles()

    def save(self, profile):
        self.store.add_guest_profile(profile)


class SpacetimeProfiles(Profiles):
    provider = "spacetimedb"
    notice = "Users are saved in SpacetimeDB. Image and object storage are configured separately."

    def __init__(self, settings):
        self.url = settings.spacetime_url.rstrip("/") + "/v1/database/" + settings.spacetime_database
        self.token = settings.spacetime_token if settings.spacetime_profile_access == "private" else ""
        self.startup_error = ""

    def request(self, method, path, **kwargs):
        if self.startup_error:
            raise ProfileError(self.startup_error)
        try:
            with httpx.Client(timeout=5, follow_redirects=False) as client:
                headers = {"Content-Type": "application/json" if "json" in kwargs else "text/plain"}
                if self.token:
                    headers["Authorization"] = f"Bearer {self.token}"
                response = client.request(method, self.url + path,
                    headers=headers, **kwargs)
            if response.status_code == 404 and path == "":
                raise DatabaseMissing("The configured user database does not exist yet.")
            if not response.is_success:
                raise ProfileError("Cannot access the SpacetimeDB user registry. Check profile access mode, table visibility, guest_profile and create_guest_profile; private mode also requires the server token. Restart the API after correcting setup.")
            return response
        except httpx.RequestError:
            raise ProfileError("Cannot reach the SpacetimeDB user registry. Retry when the database is available.") from None

    def list(self):
        response = self.request(
            "POST", "/sql", content="SELECT id, household_id, name FROM guest_profile WHERE household_id = 'demo-home'")
        try:
            data = response.json()
            rows = data[0]["rows"]
            profiles = []
            for row in rows:
                user_id, household, name = row
                if (not isinstance(user_id, str) or not re.fullmatch(r"guest-[a-f0-9]{32}", user_id)
                        or household != "demo-home" or not isinstance(name, str) or not name.strip()
                        or len(name) > 50 or any(ord(char) < 32 or ord(char) == 127 for char in name)):
                    raise ValueError("Invalid profile")
                profiles.append({"id": user_id, "household_id": household, "name": name})
            return sorted(profiles, key=lambda row: (row["name"].casefold(), row["id"]))
        except (ValueError, KeyError, TypeError, IndexError):
            raise ProfileError("The SpacetimeDB user registry returned an incompatible response. Check the published module schema.") from None

    def save(self, profile):
        self.request("POST", "/call/create_guest_profile", json=[profile["id"], profile["name"]])


def create_profiles(settings: Settings, store: Store):
    mode = settings.guest_profile_store
    if mode == "sqlite":
        return SqliteProfiles(store)
    if mode == "local" or (mode == "auto" and not settings.spacetime_token and settings.spacetime_profile_access != "public"):
        return Profiles()
    remote = SpacetimeProfiles(settings)
    try:
        remote.request("GET", "")
    except DatabaseMissing:
        if mode == "auto":
            local = Profiles()
            local.notice = "User database not created yet. Using temporary users until the test backend restarts."
            return local
        remote.startup_error = "The configured SpacetimeDB user database does not exist. Create it, or use GUEST_PROFILE_STORE=auto for temporary users."
        return remote
    except ProfileError as error:
        # Permission/network/schema failures are visible, rather than silently
        # replacing a configured registry with an unrelated empty user list.
        remote.startup_error = str(error)
        return remote
    try:
        remote.list()
    except ProfileError as error:
        remote.startup_error = str(error)
    return remote
