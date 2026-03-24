# IND-AI

A test version of a **memory-powered coding chatbot** that can:

- save earlier tasks and solutions,
- remember and retrieve relevant prior work,
- keep chat history for upcoming prompts,
- run in terminal CLI or a browser HTML UI,
- optionally use an OpenAI-compatible chat API backend.

## Quick start (CLI)

### 1) Save and search memories

```bash
python ind_ai_memory_agent.py add --task "Build login" --solution "Use JWT + refresh token" --tags auth python
python ind_ai_memory_agent.py search --prompt "I need auth"
python ind_ai_memory_agent.py list
```

### 2) Run full chatbot (interactive CLI)

```bash
python ind_ai_memory_agent.py chat
```

Chat commands:

- `/remember <task> => <solution>` save a solved pattern during chat
- `/exit` quit chat

## HTML Web UI

Run the web server:

```bash
python ind_ai_web_ui.py --host 127.0.0.1 --port 8000
```

Open in browser:

- `http://127.0.0.1:8000`

UI includes:

- live chat panel connected to `/api/chat`
- save memory form connected to `/api/memory`
- memory list panel from `/api/memories`

## Optional API integration

If `OPENAI_API_KEY` is set, the bot will call an OpenAI-compatible
`/chat/completions` endpoint and inject memory context automatically.

```bash
export OPENAI_API_KEY="your_key_here"
export OPENAI_MODEL="gpt-4o-mini"
# optional, defaults to https://api.openai.com/v1
export OPENAI_BASE_URL="https://api.openai.com/v1"
python ind_ai_web_ui.py
```

## Files created at runtime

- `memory_store.json` → persistent memory entries
- `session_history.json` → conversation history

## Run tests

```bash
python -m pytest -q
```
