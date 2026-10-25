"""Selectable prototype profiles. Image/object storage and sessions remain separate."""
import hashlib
import re
from threading import Lock
from uuid import uuid4

import httpx
from websockets.sync.client import connect
from websockets.exceptions import WebSocketException

from camera_capture.spacetime_wire import Reader, BsatnError

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
        self.contract = "user and set_name" if settings.spacetime_profile_table == "user" else "guest_profile and create_guest_profile"
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
                raise ProfileError(f"Cannot access the SpacetimeDB user registry. Check profile access mode, table visibility, {self.contract}; private mode also requires the server token. Restart the API after correcting setup.")
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


class SpacetimeUsers(SpacetimeProfiles):
    """Use the team's existing public chat user table without changing its module.

    Each new guest gets a fresh anonymous database identity, never the shared
    uploader/owner identity. Existing user rows are only read, never renamed.
    The temporary identity token is discarded after set_name completes.
    """
    notice = "Your household's saved names are available on every device."

    @staticmethod
    def profile(identity, name):
        identity = identity.removeprefix("0x").lower()
        if not re.fullmatch(r"[a-f0-9]{64}", identity):
            raise ValueError("Invalid identity")
        return {"id": "guest-" + hashlib.sha256(bytes.fromhex(identity)).hexdigest()[:32],
                "household_id": "demo-home", "name": name}

    def list(self):
        response = self.request("POST", "/sql", content="SELECT identity, name FROM user")
        try:
            profiles = []
            for identity, optional_name in response.json()[0]["rows"]:
                # SATS JSON: Identity is ["0x..."], Option<string> is [0, name]
                # or [1, []]. Unnamed chat connections aren't selectable guests.
                tag, name = optional_name
                if tag == 1:
                    continue
                if tag != 0 or not isinstance(name, str):
                    raise ValueError("Invalid optional name")
                if not name.strip() or len(name) > 50 or any(ord(c) < 32 or ord(c) == 127 for c in name):
                    continue
                profiles.append(self.profile(identity[0], name))
            return sorted(profiles, key=lambda row: (row["name"].casefold(), row["id"]))
        except (ValueError, KeyError, TypeError, IndexError, AttributeError):
            raise ProfileError("The shared user table has an incompatible format. Expected identity, optional name and online fields.") from None

    def create(self, name):
        if self.startup_error:
            raise ProfileError(self.startup_error)
        url = self.url.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
        try:
            # Opening this anonymous connection runs the module's on_connect,
            # which inserts a new user. REST calls alone don't run that hook.
            with connect(url + "/subscribe?compression=None", subprotocols=["v3.bsatn.spacetimedb"],
                         compression=None, proxy=None, open_timeout=10, close_timeout=2, max_size=65536) as ws:
                data = ws.recv(timeout=10)
                if not isinstance(data, bytes):
                    raise ValueError("Expected BSATN welcome")
                reader = Reader(data)
                if reader.u8() != 0 or reader.u8() != 0:
                    raise ValueError("Expected initial connection")
                identity = reader.take(32)[::-1].hex()
                reader.take(16)  # ConnectionId
                token = reader.string()
                with httpx.Client(timeout=10, follow_redirects=False) as client:
                    result = client.post(self.url + "/call/set_name", json=[name],
                                         headers={"Authorization": f"Bearer {token}"})
                if not result.is_success:
                    raise ProfileError("Your name could not be saved to the shared user table. Please retry.")
                profile = self.profile(identity, name)
                if self.get(profile["id"]) != profile:
                    raise ProfileError("Your saved name could not be confirmed. Refresh the user list before trying again.")
                return profile
        except (WebSocketException, OSError, TimeoutError, httpx.RequestError, BsatnError, ValueError):
            raise ProfileError("The shared user service could not be reached. Refresh the user list and try again.") from None


def create_profiles(settings: Settings, store: Store):
    mode = settings.guest_profile_store
    if mode == "sqlite":
        return SqliteProfiles(store)
    if mode == "local" or (mode == "auto" and not settings.spacetime_token and settings.spacetime_profile_access != "public"):
        return Profiles()
    remote = (SpacetimeUsers if settings.spacetime_profile_table == "user" else SpacetimeProfiles)(settings)
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
