"""Append captured JPEGs to the team's image stream; never acknowledge/delete frames.

This is an ingestion connection, separate from retained evidence images and the
guest registry. The team's consumer owns processing and acknowledgement policy.
"""
import hashlib
import json

import httpx


class FrameUploadError(Exception):
    pass


class SpacetimeFrameSink:
    def __init__(self, settings):
        self.base_url = (settings.camera_spacetime_url.rstrip("/") + "/v1/database/"
                         + settings.camera_spacetime_database)
        self.url = self.base_url + "/call/upload_binary_frame"
        # Never borrow the guest registry credential for the image database.
        self.token = settings.camera_spacetime_token

    async def put(self, household, scan_id, sequence, captured_us, width, height, jpeg):
        session = hashlib.sha256(json.dumps([household, scan_id]).encode()).hexdigest()[:32]
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(15, connect=5), follow_redirects=False) as client:
                response = await client.post(self.url, headers=headers, json=[
                    session, sequence, captured_us, width, height,
                    # SATS JSON encodes byte arrays as a hex string. An integer
                    # array massively expands camera frames and can fail at the
                    # hosted HTTP gateway even when the JPEG itself fits.
                    jpeg.hex(),
                ])
        except httpx.RequestError:
            raise FrameUploadError("Image upload could not be confirmed. Check the image database connection, then restart the camera.") from None
        if response.status_code in {401, 403} or (response.status_code == 530 and response.text.strip() == "Capture backend only"):
            raise FrameUploadError("The image database rejected upload access. Configure CAMERA_SPACETIMEDB_TOKEN locally with an identity allowed to upload, or ask the database teammate to permit the upload reducer.")
        if not response.is_success:
            # Do not echo the provider body: it can include arguments/image bytes.
            if "Invalid JPEG frame" in response.text:
                raise FrameUploadError("This camera image could not be shared. Try restarting the camera; images must fit the shared camera's size limits.")
            raise FrameUploadError(f"The image database rejected the frame (HTTP {response.status_code}). Check CAMERA_SPACETIMEDB_DATABASE and the upload_binary_frame reducer contract, then restart the camera.")
        return {"provider": "spacetimedb", "state": "uploaded", "session": session, "sequence": sequence}

    async def read(self, reference):
        receipt = reference["receipt"]
        session, sequence = receipt["session"], int(receipt["sequence"])
        # Receipts are server-generated, not browser-supplied SQL fragments.
        headers = {"Content-Type": "text/plain"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
                response = await client.post(self.base_url + "/sql", headers=headers,
                    content=f"SELECT width, height, jpeg FROM image_stream_binary WHERE session = '{session}' AND sequence = {sequence}")
            response.raise_for_status()
            rows = response.json()[0]["rows"]
            if len(rows) != 1:
                raise ValueError("Missing or duplicate frame")
            width, height, encoded = rows[0]
            jpeg = bytes.fromhex(encoded)
            if ((width, height) != (reference["width"], reference["height"])
                    or hashlib.sha256(jpeg).hexdigest() != reference["sha256"]):
                raise ValueError("Frame mismatch")
            return jpeg
        except (httpx.HTTPError, ValueError, TypeError, KeyError, IndexError):
            raise FrameUploadError("The saved camera image could not be verified. No objects were added. Restart the camera to try a new view.") from None


def create_frame_sink(settings):
    return SpacetimeFrameSink(settings) if settings.camera_frame_sink == "spacetimedb" else None
