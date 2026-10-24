"""SQLite reference implementation. All reads are scoped to the session household.

The SpacetimeDB module is a separate next-stage backend, not an implicit mirror.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import secrets
import sqlite3
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
                ("adapter", "HDMI adapter", "Silver USB-C adapter with a short white cable", ["dongle", "movie night", "hdmi", "adapter"], "Living room", "On the desk, beside the monitor", [0.60, 0.57, 0.75, 0.73], "alex", 12),
                ("keys", "House keys", "Two brass keys on a green keyring", ["key", "keyring", "keys"], "Living room", "On the desk, near the front edge", [0.32, 0.69, 0.47, 0.83], "kyuran", 28),
                ("bottle", "Blue water bottle", "Matte blue bottle with a dark cap", ["water", "flask", "bottle"], "Living room", "On the right side of the desk", [0.80, 0.30, 0.91, 0.73], "pree", 41),
                ("headphones", "Headphones", "Terracotta over-ear headphones", ["headset", "headphone", "music"], "Living room", "To the left of the monitor", [0.09, 0.40, 0.28, 0.73], "alex", 63),
            ]
            for oid, label, appearance, aliases, room, location, bbox, actor, minutes in examples:
                timestamp = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
                db.execute("INSERT OR IGNORE INTO objects VALUES (?, 'demo-home', ?, ?, ?, ?)",
                           (oid, label, appearance, json.dumps(aliases), timestamp))
                db.execute("INSERT OR IGNORE INTO observations VALUES (?, ?, 'demo-home', ?, ?, 'demo-scene', ?, 'sample', ?, ?, ?, 'seen')",
                           (f"seed-{oid}", oid, room, location, json.dumps(bbox), actor, timestamp, timestamp))

    def create_session(self, profile: str):
        token = secrets.token_urlsafe(32)
        with self.connection() as db:
            db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now(),))
            db.execute("INSERT INTO sessions VALUES (?, ?, ?)", (
                hashlib.sha256(token.encode()).hexdigest(), profile,
                (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
            ))
        return token

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
        return value

    def history(self, household: str, oid: str):
        with self.connection() as db:
            return [self.observation(r) for r in db.execute("""SELECT o.*, m.name AS actor_name
                FROM observations o JOIN members m ON o.actor_id=m.id
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
            return [self.observation(row) for row in db.execute("""SELECT o.*, m.name AS actor_name, x.label
                FROM observations o JOIN members m ON o.actor_id=m.id JOIN objects x ON x.id=o.object_id
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
                uuid4().hex, oid, member["household_id"], note.room.strip(), note.location.strip(), member["id"], timestamp, timestamp, note.kind,
            ))
        return True

    def cached_capture(self, household: str, request_id: str):
        with self.connection() as db:
            row = db.execute("SELECT fingerprint, payload FROM captures WHERE household_id=? AND request_id=?", (household, request_id)).fetchone()
            return (row["fingerprint"], json.loads(row["payload"])) if row else None

    def save_capture(self, member, request_id, fingerprint, image_key, room, detections, source, captured_at):
        """Atomic batch. Conservative identity: each detection creates a candidate object.

        Cross-frame reidentification is intentionally not guessed by matching labels.
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
            ids = []
            for detection in detections:
                oid = uuid4().hex
                ids.append(oid)
                db.execute("INSERT INTO objects VALUES (?, ?, ?, ?, ?, ?)", (
                    oid, household, detection.label, detection.appearance, "[]", now(),
                ))
                db.execute("INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seen')", (
                    uuid4().hex, oid, household, room, detection.location, image_key, json.dumps(detection.bbox), source,
                    member["id"], captured_at, now(),
                ))
            payload = {"capture_id": uuid4().hex, "object_ids": ids, "count": len(ids), "source": source}
            db.execute("INSERT INTO captures VALUES (?, ?, ?, ?, ?)", (payload["capture_id"], household, request_id, fingerprint, json.dumps(payload)))
            return payload
