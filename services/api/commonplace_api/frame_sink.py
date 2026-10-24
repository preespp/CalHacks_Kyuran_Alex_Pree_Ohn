"""Append captured JPEGs to the team's image stream; never acknowledge/delete frames.

This is an ingestion connection, separate from retained evidence images and the
guest registry. The team's consumer owns processing and acknowledgement policy.
"""
import base64

import httpx


class FrameUploadError(Exception):
    pass


class SpacetimeFrameSink:
    def __init__(self, settings):
        self.url = (settings.camera_spacetime_url.rstrip("/") + "/v1/database/"
                    + settings.camera_spacetime_database + "/call/upload_image_frame")
        # Never borrow the guest registry credential for the image database.
        self.token = settings.camera_spacetime_token

    async def put(self, household, scan_id, sequence, captured_us, width, height, jpeg):
        session = f"commonplace:{household}:{scan_id}"
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(15, connect=5), follow_redirects=False) as client:
                response = await client.post(self.url, headers=headers, json=[
                    session, sequence, captured_us, width, height,
                    base64.b64encode(jpeg).decode("ascii"),
                ])
        except httpx.RequestError:
            raise FrameUploadError("Image upload could not be confirmed. Check the image database connection, then restart the camera.") from None
        if response.status_code in {401, 403} or (response.status_code == 530 and response.text.strip() == "Capture backend only"):
            raise FrameUploadError("The image database rejected upload access. Configure CAMERA_SPACETIMEDB_TOKEN locally with an identity allowed to upload, or ask the database teammate to permit the upload reducer.")
        if not response.is_success:
            # Do not echo the provider body: it can include arguments/image bytes.
            raise FrameUploadError(f"The image database rejected the frame (HTTP {response.status_code}). Check CAMERA_SPACETIMEDB_DATABASE and the upload_image_frame reducer contract, then restart the camera.")
        return {"provider": "spacetimedb", "state": "uploaded", "session": session, "sequence": sequence}


def create_frame_sink(settings):
    return SpacetimeFrameSink(settings) if settings.camera_frame_sink == "spacetimedb" else None
