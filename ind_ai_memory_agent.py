"""Simple coding assistant CLI with optional OpenAI-compatible API support."""

from __future__ import annotations

import argparse
import json
import os
from urllib import error, request

SYSTEM_PROMPT = (
    "You are IND-AI, a simple coding assistant. "
    "Give practical, concise help with code, debugging, and design."
)


class CodingAssistant:
    """Simple coding helper with API + local fallback modes."""

    def __init__(self, api_key: str | None = None, model: str = "gpt-4o-mini", base_url: str | None = None) -> None:
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.model = model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        self.base_url = (base_url or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")).rstrip("/")

    def answer(self, prompt: str) -> str:
        prompt = prompt.strip()
        if not prompt:
            return "Please ask a coding question."

        remote = self._call_api(prompt)
        if remote is not None:
            return remote
        return self._fallback(prompt)

    def _call_api(self, prompt: str) -> str | None:
        if not self.api_key:
            return None

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
        }

        req = request.Request(
            url=f"{self.base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with request.urlopen(req, timeout=30) as response:
                body = json.loads(response.read().decode("utf-8"))
            return body["choices"][0]["message"]["content"].strip()
        except (error.URLError, error.HTTPError, KeyError, IndexError, json.JSONDecodeError):
            return None

    @staticmethod
    def _fallback(prompt: str) -> str:
        return (
            "I am running in local fallback mode (no API response).\n"
            "Try this quick coding workflow:\n"
            "1) Define expected input/output in one sentence.\n"
            "2) Write the smallest function that satisfies that behavior.\n"
            "3) Add one test for normal case and one edge case.\n\n"
            f"Your question: {prompt}"
        )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Simple AI coding assistant")
    parser.add_argument("prompt", nargs="?", help="One coding question")
    parser.add_argument("--api-key", default=None, help="OpenAI-compatible API key")
    parser.add_argument("--model", default=os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
    parser.add_argument("--base-url", default=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"))
    parser.add_argument("--chat", action="store_true", help="Start interactive mode")
    return parser


def _run_chat(bot: CodingAssistant) -> None:
    print("IND-AI coding assistant started. Type /exit to quit.")
    while True:
        question = input("you> ").strip()
        if not question:
            continue
        if question.lower() == "/exit":
            print("bye")
            return
        print(f"assistant> {bot.answer(question)}")


def main() -> None:
    args = _build_parser().parse_args()
    bot = CodingAssistant(api_key=args.api_key, model=args.model, base_url=args.base_url)

    if args.chat:
        _run_chat(bot)
        return

    if not args.prompt:
        raise SystemExit("Provide a prompt or use --chat")

    print(bot.answer(args.prompt))


if __name__ == "__main__":
    main()
