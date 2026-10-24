"""SQLite reference implementation. All reads are scoped to the session household.

The SpacetimeDB module is a separate next-stage backend, not an implicit mirror.
"""
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import secrets
import sqlite3
import unicodedata
from uuid import uuid4


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connection() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS members (
                    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL, expires_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS objects (
                    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, label TEXT NOT NULL,
                    appearance TEXT NOT NULL, aliases TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS observations (
                    id TEXT PRIMARY KEY, object_id TEXT NOT NULL, household_id TEXT NOT NULL,
                    room TEXT NOT NULL, location TEXT NOT NULL, image_key TEXT, bbox TEXT,
                    source TEXT NOT NULL, actor_id TEXT NOT NULL, observed_at TEXT NOT NULL,
                    created_at TEXT NOT NULL, kind TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS observation_object ON observations(household_id, object_id, observed_at DESC);
                CREATE TABLE IF NOT EXISTS captures (
                    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, request_id TEXT NOT NULL,
                    fingerprint TEXT NOT NULL, payload TEXT NOT NULL,
                    UNIQUE(household_id, request_id)
                );
                CREATE TABLE IF NOT EXISTS scan_frames (
                    household_id TEXT NOT NULL, scan_id TEXT NOT NULL,
                    observed_at TEXT NOT NULL, tracks TEXT NOT NULL,
                    PRIMARY KEY(household_id, scan_id)
                );
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def seed(self):
        with self.connection() as db:
            for profile in ("alex", "pree", "kyuran"):
                db.execute("INSERT OR IGNORE INTO members VALUES (?, 'demo-home', ?)", (profile, profile.title()))
            # Stable seed IDs make restarts harmless; no reset endpoint erases user work.
            examples = [
                ("adapter", "HDMI adapter", "Silver USB-C adapter with a short white cable", ["dongle", "movie night", "hdmi", "adapter"], "Living room", "On the desk, beside the monitor", [0.60, 0.57, 0.75, 0.73], 12),
                ("keys", "House keys", "Two brass keys on a green keyring", ["key", "keyring", "keys"], "Living room", "On the desk, near the front edge", [0.32, 0.69, 0.47, 0.83], 28),
                ("bottle", "Blue water bottle", "Matte blue bottle with a dark cap", ["water", "flask", "bottle"], "Living room", "On the right side of the desk", [0.80, 0.30, 0.91, 0.73], 41),
                ("headphones", "Headphones", "Terracotta over-ear headphones", ["headset", "headphone", "music"], "Living room", "To the left of the monitor", [0.09, 0.40, 0.28, 0.73], 63),
            ]
            for oid, label, appearance, aliases, room, location, bbox, minutes in examples:
                timestamp = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
                db.execute("INSERT OR IGNORE INTO objects VALUES (?, 'demo-home', ?, ?, ?, ?)",
                           (oid, label, appearance, json.dumps(aliases), timestamp))
                db.execute("INSERT OR IGNORE INTO observations VALUES (?, ?, 'demo-home', ?, ?, 'demo-scene', ?, 'sample', ?, ?, ?, 'seen')",
                           (f"seed-{oid}", oid, room, location, json.dumps(bbox), "", timestamp, timestamp))

    def create_session(self, profile: str):
        with self.connection() as db:
            return self._new_session(db, profile)

    @staticmethod
    def _new_session(db, member_id: str):
        token = secrets.token_urlsafe(32)
        db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now(),))
        db.execute("INSERT INTO sessions VALUES (?, ?, ?)", (
            hashlib.sha256(token.encode()).hexdigest(), member_id,
            (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
        ))
        return token

    def create_guest_session(self, name: str, previous_token: str | None = None):
        # A name labels a new guest; it never selects/reuses another person's identity.
        member_id = "guest-" + uuid4().hex
        with self.connection() as db:
            db.execute("INSERT INTO members VALUES (?, 'demo-home', ?)", (member_id, name))
            token = self._new_session(db, member_id)
            if previous_token:
                db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(previous_token.encode()).hexdigest(),))
        return token

    def guest_profiles(self):
        with self.connection() as db:
            return [dict(row) for row in db.execute(
                "SELECT id, household_id, name FROM members WHERE household_id='demo-home' AND id GLOB 'guest-*' ORDER BY name, id")]

    def add_guest_profile(self, profile):
        with self.connection() as db:
            db.execute("INSERT OR IGNORE INTO members VALUES (?, ?, ?)",
                       (profile["id"], profile["household_id"], profile["name"]))

    def session_for_guest_profile(self, profile, previous_token: str | None = None):
        with self.connection() as db:
            db.execute("INSERT OR IGNORE INTO members VALUES (?, ?, ?)",
                       (profile["id"], profile["household_id"], profile["name"]))
            token = self._new_session(db, profile["id"])
            if previous_token:
                db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(previous_token.encode()).hexdigest(),))
        return token

    def revoke_session(self, token: str):
        with self.connection() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))

    def member_for_token(self, token: str):
        with self.connection() as db:
            row = db.execute("""SELECT m.* FROM members m JOIN sessions s ON m.id=s.member_id
                WHERE s.token_hash=? AND s.expires_at>?""", (hashlib.sha256(token.encode()).hexdigest(), now())).fetchone()
            return dict(row) if row else None

    @staticmethod
    def observation(row):
        value = dict(row)
        value["bbox"] = json.loads(value["bbox"]) if value["bbox"] else None
        value["image_url"] = f"/api/images/{value['image_key']}" if value["image_key"] else None
        value.pop("image_key", None)
        value.pop("actor_id", None)
        value.pop("actor_name", None)
        return value

    def history(self, household: str, oid: str):
        with self.connection() as db:
            return [self.observation(r) for r in db.execute("""SELECT o.*
                FROM observations o
                WHERE o.household_id=? AND o.object_id=? ORDER BY o.observed_at DESC, o.created_at DESC, o.rowid DESC""", (household, oid))]

    def objects(self, household: str, query: str = "", room: str = ""):
        terms = [x for x in query.casefold().split() if x not in {"where", "is", "are", "my", "the", "our", "a", "an", "did", "we", "leave", "it", "for"}]
        with self.connection() as db:
            rows = [dict(row) for row in db.execute("SELECT * FROM objects WHERE household_id=?", (household,))]
        output = []
        for item in rows:
            item["aliases"] = json.loads(item["aliases"])
            history = self.history(household, item["id"])
            if not history:
                continue
            item["latest"] = history[0]
            # A note does not manufacture new visual evidence. Keep the older photo separately.
            item["last_visual"] = next((x for x in history if x["image_url"]), None)
            haystack = " ".join([item["label"], item["appearance"], *item["aliases"], item["latest"]["room"], item["latest"]["location"]]).casefold()
            if (not room or item["latest"]["room"] == room) and (not terms or all(term.strip("?!.,") in haystack for term in terms)):
                output.append(item)
        return sorted(output, key=lambda item: item["latest"]["observed_at"], reverse=True)

    def activity(self, household: str):
        with self.connection() as db:
            return [self.observation(row) for row in db.execute("""SELECT o.*, x.label
                FROM observations o JOIN objects x ON x.id=o.object_id
                WHERE o.household_id=? ORDER BY o.observed_at DESC, o.created_at DESC, o.rowid DESC LIMIT 30""", (household,))]

    def owns_image(self, household: str, key: str) -> bool:
        with self.connection() as db:
            return db.execute("SELECT 1 FROM observations WHERE household_id=? AND image_key=? LIMIT 1", (household, key)).fetchone() is not None

    def add_note(self, member, oid, note):
        timestamp = now()
        with self.connection() as db:
            if not db.execute("SELECT 1 FROM objects WHERE id=? AND household_id=?", (oid, member["household_id"])).fetchone():
                return False
            db.execute("INSERT INTO observations VALUES (?, ?, ?, ?, ?, NULL, NULL, 'reported', ?, ?, ?, ?)", (
                uuid4().hex, oid, member["household_id"], note.room.strip(), note.location.strip(), "", timestamp, timestamp, note.kind,
            ))
        return True

    def cached_capture(self, household: str, request_id: str):
        with self.connection() as db:
            row = db.execute("SELECT fingerprint, payload FROM captures WHERE household_id=? AND request_id=?", (household, request_id)).fetchone()
            return (row["fingerprint"], json.loads(row["payload"])) if row else None

    def save_capture(self, member, request_id, fingerprint, image_key, room, detections, source, captured_at, scan_id=None):
        """Atomic scan update with provisional, within-scan appearance association.

        Only an exact label + nonempty appearance, unique in both adjacent frames,
        can reuse an ID. This is not proof of physical identity or camera pose.
        """
        household = member["household_id"]
        with self.connection() as db:
            # Serialize the idempotency check and writes across simultaneous uploads.
            db.execute("BEGIN IMMEDIATE")
            cached = db.execute("SELECT fingerprint, payload FROM captures WHERE household_id=? AND request_id=?", (household, request_id)).fetchone()
            if cached:
                if cached["fingerprint"] != fingerprint:
                    raise ValueError("Request ID already belongs to a different capture")
                return json.loads(cached["payload"])
            previous = db.execute("SELECT observed_at, tracks FROM scan_frames WHERE household_id=? AND scan_id=?",
                                  (household, scan_id)).fetchone() if scan_id else None
            previous_tracks = json.loads(previous["tracks"]) if previous else []
            fresh = previous and 0 < (datetime.fromisoformat(captured_at) - datetime.fromisoformat(previous["observed_at"])).total_seconds() <= 60
            stale = bool(previous and captured_at <= previous["observed_at"])
            def normalize(value):
                return " ".join(unicodedata.normalize("NFKC", value).casefold().split())

            def signature(detection):
                if not detection.appearance.strip():
                    return None
                return json.dumps([normalize(room), normalize(detection.label), normalize(detection.appearance)])

            signatures = [signature(detection) for detection in detections]
            current_counts = Counter(signatures)
            previous_counts = Counter(track["signature"] for track in previous_tracks)
            tracks = []
            ids = []
            for detection, key in ([] if stale else zip(detections, signatures)):
                prior = next((track for track in previous_tracks if track["signature"] == key), None)
                oid = prior["object_id"] if fresh and key and current_counts[key] == previous_counts[key] == 1 else uuid4().hex
                ids.append(oid)
                tracks.append({"signature": key, "object_id": oid})
                db.execute("INSERT OR IGNORE INTO objects VALUES (?, ?, ?, ?, ?, ?)", (
                    oid, household, detection.label, detection.appearance, "[]", now(),
                ))
                db.execute("INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seen')", (
                    uuid4().hex, oid, household, room, detection.location, image_key, json.dumps(detection.bbox), source,
                    "", captured_at, now(),
                ))
            if scan_id and not stale:
                db.execute("INSERT INTO scan_frames VALUES (?, ?, ?, ?) ON CONFLICT(household_id, scan_id) DO UPDATE SET observed_at=excluded.observed_at, tracks=excluded.tracks",
                           (household, scan_id, captured_at, json.dumps(tracks)))
            payload = {"capture_id": uuid4().hex, "object_ids": ids, "count": len(ids), "source": source, "superseded": stale}
            db.execute("INSERT INTO captures VALUES (?, ?, ?, ?, ?)", (payload["capture_id"], household, request_id, fingerprint, json.dumps(payload)))
            return payload
