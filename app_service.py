"""Serve the built React app and existing API on Azure App Service.

Build with ``npm run build`` first, then start one worker with:
python -m uvicorn app_service:app --host 0.0.0.0 --port 8000 --workers 1
"""

from pathlib import Path

from fastapi.responses import FileResponse
from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles

from commonplace_api.main import app

WEB_DIST = Path(__file__).resolve().parent / "apps" / "web" / "dist"
if not (WEB_DIST / "index.html").is_file():
    raise RuntimeError(
        "Frontend build is missing. Run npm run build and include apps/web/dist "
        "in the deployment package."
    )


class FrontendFiles(StaticFiles):
    """Use SPA fallback for page routes, preserving API and asset errors."""

    async def get_response(self, path, scope):
        hidden_path = any(part.startswith(".") for part in Path(path).parts if part != ".")
        if path == "api" or path.startswith("api/") or hidden_path:
            raise HTTPException(status_code=404)
        try:
            response = await super().get_response(path, scope)
        except HTTPException as error:
            if (
                error.status_code != 404
                or Path(path).suffix
                or path == "assets"
                or path.startswith("assets/")
            ):
                raise
            response = FileResponse(WEB_DIST / "index.html")
        if response.headers.get("content-type", "").startswith("text/html"):
            response.headers["Cache-Control"] = "no-store"
        return response


# Mount last: the existing API routes retain their authorization and behavior.
app.mount("/", FrontendFiles(directory=WEB_DIST, html=True), name="frontend")
