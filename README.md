# IND-AI

A test version of a **memory-powered coding chatbot** that can:

- save earlier tasks and solutions,
- remember and retrieve relevant prior work,
- keep chat history for upcoming prompts,
- optionally use an OpenAI-compatible chat API backend.

## Quick start

### 1) Save and search memories

```bash
python ind_ai_memory_agent.py add --task "Build login" --solution "Use JWT + refresh token" --tags auth python
python ind_ai_memory_agent.py search --prompt "I need auth"
python ind_ai_memory_agent.py list
```

### 2) Run full chatbot (interactive)

```bash
python ind_ai_memory_agent.py chat
```

Chat commands:

- `/remember <task> => <solution>` save a solved pattern during chat
- `/exit` quit chat

## Optional API integration

If `OPENAI_API_KEY` is set, the bot will call an OpenAI-compatible
`/chat/completions` endpoint and inject memory context automatically.

```bash
export OPENAI_API_KEY="your_key_here"
export OPENAI_MODEL="gpt-4o-mini"
# optional, defaults to https://api.openai.com/v1
export OPENAI_BASE_URL="https://api.openai.com/v1"
python ind_ai_memory_agent.py chat
```

## Files created at runtime

- `memory_store.json` → persistent memory entries
- `session_history.json` → conversation history

## Run tests

```bash
python -m pytest -q
```
