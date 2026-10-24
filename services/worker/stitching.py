"""
Multi-view Panorama Stitching module using OpenCV Stitcher.
Automatically stitches overlapping room photos into a wide-angle scene view.
Tries cv2.Stitcher_PANORAMA (rotational pan), then cv2.Stitcher_SCANS (affine translation).
"""

from typing import Optional, Tuple
import cv2
import numpy as np


def stitch_images(
    image_bytes_list: list[bytes],
    quality: int = 88,
) -> Tuple[bool, Optional[bytes], str]:
    """
    Stitches a list of JPEG/PNG image bytes into a unified wide panorama image.

    Returns:
        (success, stitched_jpeg_bytes, method_or_error_message)
    """
    if len(image_bytes_list) < 2:
        return False, None, "At least 2 images required for stitching"

    cv_images = []
    for raw in image_bytes_list:
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is not None:
            cv_images.append(img)

    if len(cv_images) < 2:
        return False, None, "Failed to decode image buffers"

    # 1. Try cv2.Stitcher_PANORAMA (best for rotational pan from single viewpoint)
    stitcher_pano = cv2.Stitcher.create(cv2.Stitcher_PANORAMA)
    status_p, pano_p = stitcher_pano.stitch(cv_images)
    if status_p == cv2.Stitcher_OK and pano_p is not None:
        ok, buf = cv2.imencode(".jpg", pano_p, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
        if ok:
            return True, buf.tobytes(), "PANORAMA"

    # 2. Fall back to cv2.Stitcher_SCANS (best for lateral walking / translation with parallax)
    stitcher_scans = cv2.Stitcher.create(cv2.Stitcher_SCANS)
    status_s, pano_s = stitcher_scans.stitch(cv_images)
    if status_s == cv2.Stitcher_OK and pano_s is not None:
        ok, buf = cv2.imencode(".jpg", pano_s, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
        if ok:
            return True, buf.tobytes(), "SCANS"

    return False, None, f"Stitching failed (panorama_status={status_p}, scans_status={status_s})"
