"""IND-AI test chatbot with persistent memory and optional LLM API integration.

Features:
1) Persistent memory store for solved tasks.
2) Session conversation log for each chat run.
3) Memory retrieval to prime future responses.
4) Optional OpenAI-compatible chat completions via environment variables.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import List
from urllib import error, request


@dataclass
class MemoryEntry:
    """A single memory item saved by the coding AI."""

    task: str
    solution: str
    tags: List[str]
    created_at: str


@dataclass
class ChatTurn:
    """One user/assistant turn in a chat session."""

    role: str
    content: str
    created_at: str


class MemoryStore:
    """Disk-backed store for coding memories."""

    def __init__(self, memory_file: str = "memory_store.json") -> None:
        self.memory_path = Path(memory_file)
        self._entries: List[MemoryEntry] = []
        self._load()

    def _load(self) -> None:
        if not self.memory_path.exists():
            self._entries = []
            return

        raw = json.loads(self.memory_path.read_text(encoding="utf-8"))
        self._entries = [MemoryEntry(**item) for item in raw]

    def _save(self) -> None:
        data = [asdict(entry) for entry in self._entries]
        self.memory_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def add_memory(self, task: str, solution: str, tags: List[str] | None = None) -> MemoryEntry:
        entry = MemoryEntry(
            task=task.strip(),
            solution=solution.strip(),
            tags=tags or [],
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self._entries.append(entry)
        self._save()
        return entry

    def list_memories(self) -> List[MemoryEntry]:
        return list(self._entries)

    def find_relevant(self, prompt: str, limit: int = 3) -> List[MemoryEntry]:
        """Retrieve memories by keyword overlap with task + tags."""
        query_tokens = _tokenize(prompt)
        if not query_tokens:
            return self.list_memories()[-limit:]

        scored = []
        for entry in self._entries:
            haystack = f"{entry.task} {' '.join(entry.tags)}"
            entry_tokens = _tokenize(haystack)
            score = len(query_tokens & entry_tokens)
            if score > 0:
                scored.append((score, entry))

        scored.sort(key=lambda item: item[0], reverse=True)
        return [entry for _, entry in scored[:limit]]


class SessionStore:
    """Disk-backed conversation history."""

    def __init__(self, session_file: str = "session_history.json") -> None:
        self.session_path = Path(session_file)
        self._turns: List[ChatTurn] = []
        self._load()

    def _load(self) -> None:
        if not self.session_path.exists():
            self._turns = []
            return

        raw = json.loads(self.session_path.read_text(encoding="utf-8"))
        self._turns = [ChatTurn(**item) for item in raw]

    def _save(self) -> None:
        data = [asdict(turn) for turn in self._turns]
        self.session_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def add_turn(self, role: str, content: str) -> ChatTurn:
        turn = ChatTurn(
            role=role,
            content=content.strip(),
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self._turns.append(turn)
        self._save()
        return turn

    def recent(self, limit: int = 10) -> List[ChatTurn]:
        return self._turns[-limit:]


class ChatBot:
    """Memory-aware chatbot with optional OpenAI-compatible backend."""

    def __init__(self, memory_store: MemoryStore, session_store: SessionStore | None = None) -> None:
        self.memory_store = memory_store
        self.session_store = session_store or SessionStore()

    def reply(self, user_message: str) -> str:
        self.session_store.add_turn(role="user", content=user_message)

        memory_hints = self.memory_store.find_relevant(user_message, limit=3)
        response = self._maybe_call_llm(user_message=user_message, memory_hints=memory_hints)

        if response is None:
            response = self._fallback_response(user_message=user_message, memory_hints=memory_hints)

        self.session_store.add_turn(role="assistant", content=response)
        return response

    def remember_solution(self, task: str, solution: str, tags: List[str] | None = None) -> MemoryEntry:
        return self.memory_store.add_memory(task=task, solution=solution, tags=tags)

    def _maybe_call_llm(self, user_message: str, memory_hints: List[MemoryEntry]) -> str | None:
        api_key = os.getenv("OPENAI_API_KEY")
        model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

        if not api_key:
            return None

        memory_text = self._render_memory_context(memory_hints)
        recent_turns = self.session_store.recent(limit=8)

        messages = [
            {
                "role": "system",
                "content": (
                    "You are IND-AI, a coding assistant. Use memory context when relevant. "
                    "Be concise and practical."
                ),
            },
            {
                "role": "system",
                "content": f"Memory context:\n{memory_text}",
            },
        ]

        for turn in recent_turns:
            messages.append({"role": turn.role, "content": turn.content})

        messages.append({"role": "user", "content": user_message})

        payload = json.dumps(
            {
                "model": model,
                "messages": messages,
                "temperature": 0.2,
            }
        ).encode("utf-8")

        req = request.Request(
            url=f"{base_url.rstrip('/')}/chat/completions",
            data=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            return body["choices"][0]["message"]["content"].strip()
        except (error.URLError, error.HTTPError, KeyError, IndexError, json.JSONDecodeError):
            return None

    def _fallback_response(self, user_message: str, memory_hints: List[MemoryEntry]) -> str:
        if not memory_hints:
            return (
                "I do not have a similar memory yet. Share the task details and I will help, "
                "then you can save the result with the remember command."
            )

        top = memory_hints[0]
        return (
            f"I found a related previous task: '{top.task}'. "
            f"Suggested approach based on memory: {top.solution}"
        )

    @staticmethod
    def _render_memory_context(memory_hints: List[MemoryEntry]) -> str:
        if not memory_hints:
            return "No relevant memory entries."

        lines = []
        for idx, item in enumerate(memory_hints, start=1):
            tag_text = ", ".join(item.tags) if item.tags else "-"
            lines.append(
                f"{idx}. task={item.task}; tags={tag_text}; saved={item.created_at}; solution={item.solution}"
            )
        return "\n".join(lines)


def _tokenize(text: str) -> set[str]:
    return {
        token
        for token in "".join(c.lower() if c.isalnum() else " " for c in text).split()
        if len(token) > 1
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="IND-AI memory + chatbot prototype")
    subparsers = parser.add_subparsers(dest="command", required=True)

    add_parser = subparsers.add_parser("add", help="save a memory")
    add_parser.add_argument("--task", required=True)
    add_parser.add_argument("--solution", required=True)
    add_parser.add_argument("--tags", nargs="*", default=[])

    search_parser = subparsers.add_parser("search", help="find related memories")
    search_parser.add_argument("--prompt", required=True)
    search_parser.add_argument("--limit", type=int, default=3)

    subparsers.add_parser("list", help="list all memories")

    chat_parser = subparsers.add_parser("chat", help="start interactive chatbot")
    chat_parser.add_argument("--remember-tag", nargs="*", default=[])

    parser.add_argument("--memory-file", default="memory_store.json")
    parser.add_argument("--session-file", default="session_history.json")
    return parser


def _run_chat(bot: ChatBot, remember_tags: List[str]) -> None:
    print("IND-AI chat started. Type /exit to quit.")
    print("Use '/remember <task> => <solution>' to save new memory.")

    while True:
        user_text = input("you> ").strip()
        if not user_text:
            continue
        if user_text.lower() == "/exit":
            print("bye")
            break

        if user_text.startswith("/remember "):
            content = user_text[len("/remember ") :]
            if "=>" not in content:
                print("assistant> Invalid format. Use: /remember <task> => <solution>")
                continue
            task, solution = (part.strip() for part in content.split("=>", maxsplit=1))
            bot.remember_solution(task=task, solution=solution, tags=remember_tags)
            print("assistant> Memory saved.")
            continue

        response = bot.reply(user_text)
        print(f"assistant> {response}")


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    store = MemoryStore(memory_file=args.memory_file)

    if args.command == "add":
        entry = store.add_memory(task=args.task, solution=args.solution, tags=args.tags)
        print(f"Saved memory at {entry.created_at}")
        return

    if args.command == "search":
        hits = store.find_relevant(prompt=args.prompt, limit=args.limit)
        if not hits:
            print("No related memory found.")
            return
        for idx, item in enumerate(hits, start=1):
            print(f"[{idx}] Task: {item.task}")
            print(f"    Tags: {', '.join(item.tags) if item.tags else '-'}")
            print(f"    Saved: {item.created_at}")
            print(f"    Solution: {item.solution}\n")
        return

    if args.command == "list":
        memories = store.list_memories()
        if not memories:
            print("No memories yet.")
            return
        for idx, item in enumerate(memories, start=1):
            print(f"[{idx}] {item.created_at} | {item.task}")
        return

    session_store = SessionStore(session_file=args.session_file)
    bot = ChatBot(memory_store=store, session_store=session_store)
    _run_chat(bot=bot, remember_tags=args.remember_tag)


if __name__ == "__main__":
    main()
