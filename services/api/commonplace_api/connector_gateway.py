"""Read-only gateway for a controlled Muse connector test using sample data.

Run the main API on loopback port 8000. Tunnel only this gateway on port 8001.
COMMONPLACE_CONNECTOR_TOKEN is a 24-hour local API demo session token, never a
Meta Model API key. This does not implement MCP or production OAuth.
"""
from contextlib import asynccontextmanager
import os
import secrets
from typing import Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from dotenv import load_dotenv

from .config import ROOT
from .models import ConnectorSearchResponse

load_dotenv(ROOT / ".env", override=False)
bearer = HTTPBearer(auto_error=False)


def create_gateway(
    token: Optional[str] = None,
    transport: Optional[httpx.AsyncBaseTransport] = None,
) -> FastAPI:
    configured_token = token if token is not None else os.getenv("COMMONPLACE_CONNECTOR_TOKEN", "")

    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(
            base_url="http://127.0.0.1:8000",
            timeout=httpx.Timeout(15, connect=3),
            transport=transport,
            follow_redirects=False,
        ) as client:
            app.state.backend = client
            yield

    app = FastAPI(
        title="Commonplace read-only Muse demo connector",
        version="0.1.0",
        description="Search sample household memory. No login, upload, write, or image-serving endpoints are exposed.",
        lifespan=lifespan,
        swagger_ui_parameters={"persistAuthorization": False},
    )

    def authorize(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer)):
        if len(configured_token) < 32:
            raise HTTPException(503, "Configure COMMONPLACE_CONNECTOR_TOKEN with a local demo session token, then restart the gateway.")
        if credentials is None or not secrets.compare_digest(
            credentials.credentials.encode(), configured_token.encode()
        ):
            raise HTTPException(401, "Connector credential required", headers={"WWW-Authenticate": "Bearer"})

    @app.get(
        "/api/connector/search",
        operation_id="search_household_memory",
        response_model=ConnectorSearchResponse,
        dependencies=[Depends(authorize)],
    )
    async def search(q: str = Query(..., min_length=1, max_length=200)):
        """Search this authorized demo household using object-name keywords, color, or aliases.

        This tool only reads memory. Report last-seen/member-reported locations with
        source, contributor, and time. Label sample illustrations as sample data.
        An empty match list means there is no stored match. Multiple matches require
        clarification. Relative image paths refer to the local app; this gateway
        does not publish private photographs or provide live camera/depth data.
        """
        try:
            response = await app.state.backend.get(
                "/api/connector/search",
                params={"q": q},
                headers={"Authorization": f"Bearer {configured_token}"},
            )
        except httpx.RequestError:
            raise HTTPException(502, "The local API is unavailable. Start make api on port 8000.")
        if response.status_code == 401:
            raise HTTPException(401, "Demo session expired. Create a new token and update the gateway and Muse credentials.",
                                headers={"WWW-Authenticate": "Bearer"})
        if response.status_code != 200:
            raise HTTPException(502, "The local API could not complete the memory search.")
        try:
            return ConnectorSearchResponse.model_validate(response.json())
        except ValueError:
            raise HTTPException(502, "The local API returned an invalid memory response.")

    return app


app = create_gateway()
