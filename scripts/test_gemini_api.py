"""Manual Gemini assistant checks without the app, database, camera, or other services.

Default: one short text request. --tools: the real assistant adapter with a synthetic
in-memory search result (at most two requests). Never run automatically by CI.
"""
import argparse
import asyncio
import os
import re
import sys

import httpx

from commonplace_api.assistant import AssistantError, answer_question, candidate_content
from commonplace_api.config import ROOT, Settings
from commonplace_api.models import ChatRequest


def text_check(settings: Settings) -> int:
    try:
        response = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_chat_model}:generateContent",
            headers={"x-goog-api-key": settings.chat_api_key},
            json={"contents": [{"role": "user", "parts": [{"text": "Reply with exactly GEMINI_API_OK and nothing else."}]}],
                  "generationConfig": {"maxOutputTokens": 2048}},
            timeout=httpx.Timeout(45, connect=10), follow_redirects=False,
        )
    except httpx.RequestError:
        print("FAIL: Could not reach Gemini. Check your network and retry manually.")
        return 1
    print(f"HTTP {response.status_code}")
    if response.status_code != 200:
        print({400: "FAIL: Check the API key, model, and supported request settings.",
               401: "FAIL: Check the assistant API key.",
               403: "FAIL: Check API key restrictions, project permissions, and model/region access.",
               404: "FAIL: Model not found. Choose a model available to this key's project.",
               429: "FAIL: Check this project's quota and rate limits; wait before retrying."}.get(
                   response.status_code, "FAIL: Gemini rejected the request. Check Google AI Studio and retry manually."))
        return 1
    try:
        content = candidate_content(response)
        answer = "".join(part.get("text", "") for part in content["parts"] if not part.get("thought")).strip()
    except (AssistantError, ValueError, KeyError, TypeError, IndexError, AttributeError):
        print("FAIL: Gemini returned no complete text answer. Check model support, safety feedback, and output/thinking budget.")
        return 1
    if answer != "GEMINI_API_OK":
        print("FAIL: Gemini responded, but not with the expected test text. Review the model and output/thinking budget.")
        return 1
    print("PASS: Gemini text reply received using the assistant key and model.")
    print("This verifies API access only; it does not test memory integration or voice.")
    return 0


async def tool_check(settings: Settings) -> int:
    calls = []

    async def synthetic_search(query: str):
        calls.append(query)
        # Synthetic local test data only. Never imports or instantiates the database.
        observation = {
            "id": "test-observation", "object_id": "test-keys", "room": "Kitchen",
            "location": "In the green test box", "image_url": None, "bbox": None,
            "source": "reported", "kind": "moved", "actor_name": "Test teammate",
            "observed_at": "2026-10-24T12:00:00+00:00",
        }
        return {
            "query": query, "matches": [{"id": "test-keys", "label": "Test keys",
                "appearance": "Synthetic keys for an API check", "aliases": ["keys"],
                "latest": observation, "last_visual": None}],
            "needs_disambiguation": False,
            "guidance": "This is synthetic test data. Preserve contributor, source, and timestamp.",
        }

    try:
        response = await answer_question(settings, ChatRequest(message="Where are the test keys? Include the exact stored location in your answer."), synthetic_search)
    except AssistantError as error:
        print(f"FAIL: {error}")
        return 1
    if len(calls) != 1 or "green test box" not in response.answer.casefold():
        print("FAIL: The model did not complete the expected search-and-answer flow. Review model support and reasoning/output settings.")
        return 1
    print("PASS: Gemini requested search_household_memory and answered from the synthetic result.")
    print("Synthetic evidence: Test teammate reported the test keys in the green test box, Kitchen.")
    print("No database, web app, photograph, vision key, Vultr, or SpacetimeDB was used. Voice was not tested.")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tools", action="store_true", help="Test the real assistant adapter with synthetic memory (at most two Gemini requests).")
    args = parser.parse_args(argv)
    # config loads the root .env. Read only assistant settings; unrelated provider
    # configuration must not prevent this isolated test from running.
    key = os.getenv("GEMINI_CHAT_API_KEY", "").strip() or os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_CHAT_MODEL", "").strip() or os.getenv("GEMINI_MODEL", "").strip()
    if not key:
        print("Set GEMINI_CHAT_API_KEY in the repository-root .env. No request was sent.")
        return 1
    if not re.fullmatch(r"[A-Za-z0-9._-]+", model):
        print("Set GEMINI_CHAT_MODEL to an available model ID, without a URL or models/ prefix. No request was sent.")
        return 1
    settings = Settings(data_dir=ROOT / ".data", gemini_chat_api_key=key, gemini_chat_model=model)
    return asyncio.run(tool_check(settings)) if args.tools else text_check(settings)


if __name__ == "__main__":
    sys.exit(main())
