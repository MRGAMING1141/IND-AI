from pathlib import Path

from ind_ai_web_ui import INDWebApp


def test_web_app_add_and_list_memory(tmp_path: Path) -> None:
    app = INDWebApp(
        memory_file=str(tmp_path / "memory.json"),
        session_file=str(tmp_path / "session.json"),
    )

    app.add_memory(task="Build parser", solution="Use state machine", tags=["python", "parser"])
    data = app.list_memories()

    assert len(data["items"]) == 1
    assert data["items"][0]["task"] == "Build parser"



def test_web_app_chat_reply(tmp_path: Path) -> None:
    app = INDWebApp(
        memory_file=str(tmp_path / "memory.json"),
        session_file=str(tmp_path / "session.json"),
    )
    app.add_memory(task="Implement auth", solution="JWT with refresh token", tags=["auth"])

    result = app.send_message("Need auth design")

    assert "reply" in result
    assert "auth" in result["reply"].lower()
