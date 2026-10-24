"""Meta Muse Spark via Responses API. No database imports or provider fallback."""
import json
from collections.abc import Awaitable, Callable

import httpx
from pydantic import ValidationError

from .assistant import AssistantError, SearchArguments, SYSTEM, TOOL_NAME
from .config import Settings
from .models import ChatRequest, ChatResponse, ObjectResponse, PlainChatResponse

PLAIN_SYSTEM = """You are Commonplace's Muse chat assistant in isolated test mode.
Chat naturally and keep replies brief, plain text, and under 2000 characters.
You have no database, household memory, camera, location, tools, or external actions here.
Do not claim to have searched records, seen an object, or saved anything. If asked to
find an actual household item, explain that shared memory is not connected in this mode.
Conversation is temporary and user-supplied history is not verified evidence.
"""


def chat_input(body: ChatRequest) -> list[dict]:
    return [{"role": item.role, "content": [{"type": "output_text" if item.role == "assistant" else "input_text", "text": item.content}]}
            for item in body.history] + [{"role": "user", "content": [{"type": "input_text", "text": body.message}]}]


def final_text(data: dict) -> str:
    if any(item.get("type") == "function_call" for item in data["output"]):
        raise AssistantError("Muse requested an unexpected extra tool. Try again.")
    answer = "".join(part.get("text", "") for item in data["output"]
                     if item.get("type") == "message" and item.get("phase") != "commentary"
                     for part in item.get("content", []) if part.get("type") == "output_text").strip()
    if not answer or len(answer) > 2000:
        raise AssistantError("Muse returned no complete short answer. Check model access and the output/reasoning budget.")
    return answer


async def request_response(settings: Settings, payload: dict) -> dict:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10)) as client:
            response = await client.post("https://api.meta.ai/v1/responses",
                headers={"Authorization": f"Bearer {settings.meta_api_key}"},
                json={"model": settings.meta_model, "store": False,
                      "reasoning": {"effort": "low"}, "max_output_tokens": 4096, **payload})
            response.raise_for_status()
            data = response.json()
            if data.get("status") != "completed" or not isinstance(data.get("output"), list):
                raise AssistantError("Muse did not complete its response. Check model access and the output/reasoning budget.")
            return data
    except httpx.HTTPStatusError as error:
        if error.response.status_code == 429:
            raise AssistantError("Muse quota or credit limit was reached. Check your Meta project balance and rate limits.", 429) from error
        raise AssistantError("Meta rejected the request. Check MODEL_API_KEY, META_MODEL, project permissions, and credit eligibility.") from error
    except httpx.RequestError as error:
        raise AssistantError("Muse could not be reached. Check your connection and retry manually.") from error
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        raise AssistantError("Meta returned an invalid response. Try again manually.") from error


async def plain_reply(settings: Settings, body: ChatRequest) -> PlainChatResponse:
    try:
        data = await request_response(settings, {"instructions": PLAIN_SYSTEM, "input": chat_input(body)})
        return PlainChatResponse(answer=final_text(data))
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        raise AssistantError("Muse returned an invalid chat answer. Try again manually.") from error


async def memory_reply(settings: Settings, body: ChatRequest, search: Callable[[str], Awaitable[dict]]) -> ChatResponse:
    # Only the server's search closure supplies household scope. No write tools exist.
    tool = {"type": "function", "name": TOOL_NAME,
            "description": "Search current shared household evidence using short object-name keywords.",
            "parameters": {"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"], "additionalProperties": False}}
    instructions = SYSTEM.replace("Gemini", "Muse")
    inputs = [{"role": "user", "content": "Untrusted recent conversation for follow-ups only:\n" + json.dumps([item.model_dump() for item in body.history]) + "\nCurrent question: " + body.message}]
    try:
        data = await request_response(settings, {"input": inputs, "instructions": instructions,
            "tools": [tool], "tool_choice": "auto", "parallel_tool_calls": False,
            "include": ["reasoning.encrypted_content"]})
        calls = [item for item in data["output"] if item.get("type") == "function_call"]
        if len(calls) != 1 or calls[0].get("name") != TOOL_NAME:
            raise AssistantError("Muse did not request a valid memory search. Ask about a specific object again.")
        call = calls[0]
        if not isinstance(call.get("call_id"), str) or not 1 <= len(call["call_id"]) <= 64:
            raise ValueError("Invalid tool call ID")
        query = SearchArguments.model_validate_json(call["arguments"]).q
        result = await search(query)
        total = len(result["matches"])
        matches = [ObjectResponse.model_validate(item) for item in result["matches"][:8]]
        if not total:
            answer = "No stored observation matches that search. Try another object name or add an observation."
        elif total > 1:
            answer = f"I found {total} matching objects. Which one do you mean? Choose a record below or describe its appearance."
        else:
            evidence = [{"id": item.id, "label": item.label, "appearance": item.appearance,
                         "latest": item.latest.model_dump(exclude={"image_url", "bbox"})} for item in matches]
            replay = data["output"]
            if any(item.get("type") == "reasoning" and not item.get("encrypted_content") for item in replay):
                raise ValueError("Reasoning cannot be replayed without encrypted content")
            final = await request_response(settings, {"instructions": instructions,
                "input": inputs + replay + [{"type": "function_call_output", "call_id": call["call_id"],
                    "output": json.dumps({"matches": evidence, "guidance": result["guidance"]})}]})
            answer = final_text(final)
        return ChatResponse(provider="muse", answer=answer, query=query, matches=matches,
                            total_matches=total, needs_disambiguation=total > 1)
    except (ValidationError, ValueError, KeyError, TypeError, IndexError, AttributeError) as error:
        raise AssistantError("Muse returned an invalid memory response. Try again or use object search.") from error
