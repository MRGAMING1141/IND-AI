from ind_ai_memory_agent import CodingAssistant


def test_empty_prompt_message() -> None:
    bot = CodingAssistant(api_key=None)
    assert bot.answer("   ") == "Please ask a coding question."


def test_fallback_without_api_key() -> None:
    bot = CodingAssistant(api_key=None)
    reply = bot.answer("How do I write a binary search?")

    assert "local fallback mode" in reply
    assert "How do I write a binary search?" in reply


def test_fallback_direct_call() -> None:
    reply = CodingAssistant._fallback("Need help with Python loops")

    assert "smallest function" in reply
    assert "Need help with Python loops" in reply
