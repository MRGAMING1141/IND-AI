# IND-AI

A **simple AI coding assistant** you can run from the terminal.

It supports:
- one-shot coding questions,
- interactive chat mode,
- optional OpenAI-compatible `/chat/completions` API usage,
- local fallback guidance when no API key is available.

## Quick start

### 1) Ask one coding question

```bash
python ind_ai_memory_agent.py "How do I parse JSON in Python?"
```

### 2) Run interactive mode

```bash
python ind_ai_memory_agent.py --chat
```

## Optional API integration

Set your key as an environment variable (recommended):

```bash
export OPENAI_API_KEY="your_key_here"
export OPENAI_MODEL="gpt-4o-mini"
# optional, defaults to https://api.openai.com/v1
export OPENAI_BASE_URL="https://api.openai.com/v1"
```

Or pass it directly:

```bash
python ind_ai_memory_agent.py --api-key "your_key_here" "Help me write a REST endpoint"
```

If no API response is available, IND-AI returns a local coding workflow fallback.

## Run tests

```bash
python -m pytest -q
```
