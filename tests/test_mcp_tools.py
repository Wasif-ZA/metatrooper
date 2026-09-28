import json
import os
import sys
import time
from pathlib import Path

import pytest

from callrouter import cli


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path, monkeypatch):
    home = tmp_path / "callrouter-home"
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.setenv("CALLROUTER_HOME", str(home))
    for name in (
        "AI_AGENT",
        "CLAUDECODE",
        "CALLROUTER_OUTPUT",
        "CLAUDE_CODE_SESSION_ID",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(work)


def invoke(capsys, *args):
    exit_code = cli.main(["--json", *(str(arg) for arg in args)])
    captured = capsys.readouterr()
    assert captured.err == ""
    return exit_code, json.loads(captured.out)


def write_fake_mcp_server(tmp_path):
    script = tmp_path / "fake_mcp_server.py"
    script.write_text(
        """import json
import sys

mode = sys.argv[1]
if mode == "exit-early":
    raise SystemExit(0)

tools = [
    {
        "name": "echo",
        "description": "Echoes synthetic input. A second sentence is omitted.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "required": {"type": "string"},
                "optional": {"type": "integer"}
            },
            "required": ["required"]
        }
    },
    {
        "name": "fail",
        "description": "Returns a synthetic MCP error.",
        "inputSchema": {"type": "object", "properties": {}}
    }
]

def reply(message_id, result):
    print(json.dumps({"jsonrpc": "2.0", "id": message_id, "result": result}), flush=True)

for line in sys.stdin:
    message = json.loads(line)
    method = message.get("method")
    if method == "initialize":
        reply(message["id"], {"protocolVersion": "2025-06-18", "capabilities": {}})
    elif method == "tools/list":
        reply(message["id"], {"tools": tools})
    elif method == "tools/call":
        params = message.get("params") or {}
        if params.get("name") == "fail":
            reply(message["id"], {
                "isError": True,
                "content": [{"type": "text", "text": "synthetic MCP failure"}]
            })
        else:
            reply(message["id"], {
                "content": [{"type": "text", "text": json.dumps({
                    "received": params.get("arguments") or {},
                    "source": "fake-server"
                })}]
            })
""",
        encoding="utf-8",
    )
    return script


def write_servers(monkeypatch, script, entries):
    home = Path(os.environ["CALLROUTER_HOME"])
    home.mkdir(parents=True, exist_ok=True)
    config = {
        "mcpServers": {
            name: {"command": sys.executable, "args": [str(script), mode]}
            for name, mode in entries.items()
        }
    }
    (home / "servers.json").write_text(json.dumps(config), encoding="utf-8")


def test_tools_one_liner_marks_optional_arguments_with_question_mark(
    tmp_path, monkeypatch, capsys
):
    script = write_fake_mcp_server(tmp_path)
    write_servers(monkeypatch, script, {"fake": "normal"})

    exit_code, result = invoke(capsys, "tools")

    assert exit_code == 0
    assert result["out"]["mcp:fake"] == [
        "echo(required, optional?)  Echoes synthetic input",
        "fail()  Returns a synthetic MCP error.",
    ]


def test_tools_call_returns_json_text_content_as_an_object(
    tmp_path, monkeypatch, capsys
):
    script = write_fake_mcp_server(tmp_path)
    write_servers(monkeypatch, script, {"fake": "normal"})

    exit_code, result = invoke(
        capsys,
        "mcp",
        "fake",
        "echo",
        json.dumps({"required": "synthetic", "optional": 7}),
    )

    assert exit_code == 0
    assert result["out"] == {
        "received": {"required": "synthetic", "optional": 7},
        "source": "fake-server",
    }
    assert isinstance(result["out"], dict)


def test_mcp_is_error_result_exits_one(tmp_path, monkeypatch, capsys):
    script = write_fake_mcp_server(tmp_path)
    write_servers(monkeypatch, script, {"fake": "normal"})

    exit_code, result = invoke(capsys, "mcp", "fake", "fail", "{}")

    assert exit_code == 1
    assert result["ok"] is False
    assert result["out"] == "synthetic MCP failure"


def test_unknown_server_exits_one_and_names_known_servers(
    tmp_path, monkeypatch, capsys
):
    script = write_fake_mcp_server(tmp_path)
    write_servers(monkeypatch, script, {"alpha": "normal", "beta": "normal"})

    exit_code, result = invoke(capsys, "mcp", "missing", "echo", "{}")

    assert exit_code == 1
    assert result["ok"] is False
    assert 'no MCP server "missing"' in result["note"]
    assert "Known: alpha, beta" in result["note"]


def test_server_that_exits_early_reports_clean_error_without_hanging(
    tmp_path, monkeypatch, capsys
):
    script = write_fake_mcp_server(tmp_path)
    write_servers(monkeypatch, script, {"early": "exit-early"})

    started = time.monotonic()
    exit_code, result = invoke(capsys, "mcp", "early", "echo", "{}")
    elapsed = time.monotonic() - started

    assert elapsed < 3
    assert exit_code == 1
    assert result["ok"] is False
    assert result["note"] == "the MCP server exited"
    assert "Traceback" not in result["note"]
