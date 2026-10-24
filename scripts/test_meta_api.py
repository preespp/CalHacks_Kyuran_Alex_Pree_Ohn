"""One live Meta Model API smoke test. Run manually after redeeming API credits.

The key is read from MODEL_API_KEY in the root .env or entered through getpass.
This script is not run by CI and never claims a Muse connector was established.
"""
import getpass
import os
from pathlib import Path
import re
import sys

from dotenv import load_dotenv
import httpx

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)


def main() -> int:
    key = os.getenv("MODEL_API_KEY", "").strip() or getpass.getpass("Meta Model API key (hidden): ").strip()
    if not key:
        print("No key supplied. No request was sent.")
        return 1
    model = os.getenv("META_MODEL", "").strip() or input("Model ID enabled in your dashboard (e.g. muse-spark-1.3): ").strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]+", model):
        print("Enter a model ID, without a URL or models/ prefix. No request was sent.")
        return 1
    try:
        response = httpx.post(
            "https://api.meta.ai/v1/responses",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": model, "input": "Reply with exactly META_API_OK and nothing else.", "max_output_tokens": 4096,
                  "reasoning": {"effort": "low"}, "store": False},
            timeout=httpx.Timeout(60, connect=10),
            follow_redirects=False,
        )
    except httpx.RequestError:
        print("Could not reach Meta Model API. Check the network and retry manually.")
        return 1
    print(f"HTTP {response.status_code}")
    if response.status_code != 200:
        print({401: "Check the API key.", 403: "Check project permissions and model access.",
               429: "Check quota, available credits, and rate limits."}.get(response.status_code,
               "Check your dashboard and Meta's current API documentation."))
        return 1
    try:
        body = response.json()
        answer = "".join(
            part.get("text", "")
            for item in body.get("output", []) if item.get("type") == "message"
            for part in item.get("content", []) if part.get("type") == "output_text"
        ).strip()
        usage = body.get("usage", {})
    except (ValueError, TypeError, AttributeError):
        print("The API returned an unexpected response format. Check the current response schema.")
        return 1
    if answer == "META_API_OK":
        print("PASS: Meta model response received. This verifies model API access, not a Muse connector.")
    else:
        print("The model answered differently or exhausted its output budget. Review the model/request settings.")
    print(f"Input tokens: {usage.get('input_tokens', 'unknown')}; output tokens: {usage.get('output_tokens', 'unknown')}")
    return 0 if answer == "META_API_OK" else 1


if __name__ == "__main__":
    sys.exit(main())
