import json
import pytest


@pytest.fixture(autouse=True)
def no_mcp_keepalive(monkeypatch):
    monkeypatch.setenv("METAROUTER_MCP_KEEP", "0")


@pytest.fixture(autouse=True)
def no_real_sessions(tmp_path_factory, monkeypatch):
    from metarouter import transcripts
    empty = tmp_path_factory.mktemp("no-sessions")
    monkeypatch.setattr(transcripts, "ROOTS", {k: empty / k for k in transcripts.ROOTS})


def agent_result(text):
    """Parse agent-mode output: a JSON result line, or plain text for a whole successful output."""
    try:
        value = json.loads(text)
    except ValueError:
        value = None
    if isinstance(value, dict) and "ok" in value:
        value.setdefault("exit", 0)
        return value
    text = text[:-1] if text.endswith("\n") else text
    lines = text.split("\n")
    result = {"ok": True, "exit": 0}
    if lines[0].startswith("[exit ") and lines[0].endswith("]"):
        result.update(ok=False, exit=int(lines[0][6:-1]))
        lines = lines[1:]
    while lines and lines[-1].split(": ", 1)[0] in ("hint", "breaker", "note"):
        key, value = lines.pop().split(": ", 1)
        result[key] = value
    result["out"] = "\n".join(lines)
    return result
