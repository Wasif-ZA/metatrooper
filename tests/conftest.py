import json
import pytest


@pytest.fixture(autouse=True)
def no_mcp_keepalive(monkeypatch):
    monkeypatch.setenv("METAROUTER_MCP_KEEP", "0")


def agent_result(text):
    """Parse agent-mode output: a JSON result line, or plain text for a whole successful output."""
    try:
        value = json.loads(text)
    except ValueError:
        value = None
    if isinstance(value, dict) and "ok" in value:
        value.setdefault("exit", 0)
        return value
    return {"ok": True, "exit": 0, "out": text[:-1] if text.endswith("\n") else text}
