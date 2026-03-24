import json
from pathlib import Path

from ind_ai_memory_agent import ChatBot, MemoryStore, SessionStore


def test_add_and_list_memories(tmp_path: Path) -> None:
    memory_file = tmp_path / "memories.json"
    store = MemoryStore(memory_file=str(memory_file))

    store.add_memory(task="Create API", solution="Use FastAPI", tags=["python", "api"])
    entries = store.list_memories()

    assert len(entries) == 1
    assert entries[0].task == "Create API"
    assert entries[0].solution == "Use FastAPI"



def test_retrieval_by_keyword_overlap(tmp_path: Path) -> None:
    memory_file = tmp_path / "memories.json"
    store = MemoryStore(memory_file=str(memory_file))

    store.add_memory(task="Build auth service", solution="Use JWT", tags=["auth", "security"])
    store.add_memory(task="Build cache layer", solution="Use Redis", tags=["performance", "cache"])

    hits = store.find_relevant("need auth for users", limit=2)

    assert len(hits) == 1
    assert hits[0].task == "Build auth service"



def test_json_persistence(tmp_path: Path) -> None:
    memory_file = tmp_path / "memories.json"

    first = MemoryStore(memory_file=str(memory_file))
    first.add_memory(task="Refactor parser", solution="Split into functions", tags=["cleanup"])

    second = MemoryStore(memory_file=str(memory_file))
    entries = second.list_memories()

    assert len(entries) == 1
    assert entries[0].tags == ["cleanup"]

    raw = json.loads(memory_file.read_text(encoding="utf-8"))
    assert raw[0]["task"] == "Refactor parser"



def test_chatbot_fallback_uses_memory(tmp_path: Path) -> None:
    memory_file = tmp_path / "memories.json"
    session_file = tmp_path / "session.json"
    store = MemoryStore(memory_file=str(memory_file))
    store.add_memory(task="Create auth login", solution="Use JWT access+refresh", tags=["auth"])

    bot = ChatBot(memory_store=store, session_store=SessionStore(session_file=str(session_file)))
    reply = bot.reply("how should i implement auth?")

    assert "Create auth login" in reply
    assert "Use JWT" in reply



def test_chat_session_is_persisted(tmp_path: Path) -> None:
    memory_file = tmp_path / "memories.json"
    session_file = tmp_path / "session.json"
    store = MemoryStore(memory_file=str(memory_file))
    bot = ChatBot(memory_store=store, session_store=SessionStore(session_file=str(session_file)))

    bot.reply("hello")

    raw = json.loads(session_file.read_text(encoding="utf-8"))
    assert len(raw) == 2
    assert raw[0]["role"] == "user"
    assert raw[1]["role"] == "assistant"
