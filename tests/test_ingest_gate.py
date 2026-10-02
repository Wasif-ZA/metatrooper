import json

import pytest

from toolrouter import calls, cli, ingest


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("TOOLROUTER_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("AI_AGENT", "1")
    for name in ("CLAUDECODE", "TOOLROUTER_OUTPUT", "CLAUDE_CODE_SESSION_ID", "TOOLROUTER_SHELL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(tmp_path)


def session(path, cwd, stamp, uses):
    """uses: list of (id, tool name, input, result text)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    for tid, name, inp, text in uses:
        lines.append({"timestamp": stamp, "cwd": cwd,
                      "message": {"content": [{"type": "tool_use", "id": tid, "name": name, "input": inp}]}})
        lines.append({"timestamp": stamp, "cwd": cwd,
                      "message": {"content": [{"type": "tool_result", "tool_use_id": tid, "content": text}]}})
    path.write_text("\n".join(json.dumps(x) for x in lines) + "\n", encoding="utf-8")


def gate_json(capsys, root, since, until):
    assert cli.main(["ingest", "--root", str(root), "--since", since, "--until", until, "--no-save", "--json"]) == 0
    return json.loads(capsys.readouterr().out)


def test_shell_read_tokens_skip_acu_sessions_and_other_tools(tmp_path, capsys):
    bash, read, grep = "b" * 400, "r" * 800, "g" * 1200
    session(tmp_path / "t" / "p1" / "s1.jsonl", "C:/repo", "2026-10-01T10:00:00+10:00",
            [("u1", "Bash", {"command": "ls"}, bash), ("u2", "Read", {"file_path": "a.py"}, read),
             ("u3", "Grep", {"pattern": "x"}, grep)])
    session(tmp_path / "t" / "p2" / "s2.jsonl", "C:/repo", "2026-10-01T10:00:00+10:00",
            [("u4", "Read", {"file_path": "C:\\teehee\\work\\ACU\\x.csv"}, "z" * 4000)])
    session(tmp_path / "t" / "p3" / "s3.jsonl", "C:/teehee/work/acu/hwb", "2026-10-01T10:00:00+10:00",
            [("u5", "Bash", {"command": "ls"}, "z" * 4000)])

    res = gate_json(capsys, tmp_path / "t", "2026-10-01T00:00+10:00", "2026-10-02T00:00+10:00")

    assert res["ok"] is True
    assert res["shell_read_tokens"] == (len(bash) + len(read)) // 4


def test_window_includes_since_and_excludes_until_across_offsets(tmp_path, capsys):
    at_since, at_until = "x" * 400, "y" * 4000
    session(tmp_path / "t" / "p" / "a.jsonl", "C:/repo", "2026-09-30T14:00:00Z", [("u1", "Bash", {}, at_since)])
    session(tmp_path / "t" / "p" / "b.jsonl", "C:/repo", "2026-10-01T20:00:00+10:00", [("u2", "Bash", {}, at_until)])
    calls.append({"time": "2026-10-01T00:00:00+10:00", "project": "C:/repo", "bytes": 1000, "shown_bytes": 200})
    calls.append({"time": "2026-10-01T10:00:00+00:00", "project": "C:/repo", "bytes": 9000, "shown_bytes": 0})

    res = gate_json(capsys, tmp_path / "t", "2026-10-01T00:00:00+10:00", "2026-10-01T10:00:00")

    assert res["shell_read_tokens"] == len(at_since) // 4
    assert res["saved_tokens"] == (1000 - 200) // 4


def test_saved_tokens_need_shown_bytes_and_skip_acu_and_bad_times():
    rows = [
        {"time": "2026-10-01T09:00:00+10:00", "project": "C:/repo", "bytes": 4000, "shown_bytes": 400},
        {"time": "2026-10-01T09:00:00+10:00", "project": "C:/repo", "bytes": 8000},
        {"time": "2026-10-01T09:00:00+10:00", "project": "C:/teehee/work/ACU", "bytes": 8000, "shown_bytes": 0},
        {"time": "not a time", "project": "C:/repo", "bytes": 8000, "shown_bytes": 0},
        {"time": "2026-10-01T09:00:00+10:00", "project": "C:/repo", "bytes": 100, "shown_bytes": 500},
    ]

    assert ingest.saved_tokens(rows, "2026-10-01T00:00+10:00", "2026-10-02T00:00+10:00") == (4000 - 400) // 4


def test_flow_of_two_steps_logs_one_row_with_shown_bytes(capsys):
    assert cli.main(["--json", "add", "two", "--step", "exec -- printf one", "--step", "exec -- printf two"]) == 0
    capsys.readouterr()
    before = len(calls.read())

    assert cli.main(["--json", "run", "two"]) == 0
    out = capsys.readouterr().out.strip()

    rows = calls.read()[before:]
    assert len(rows) == 3
    assert [("shown_bytes" in r) for r in rows] == [False, False, True]
    assert rows[-1]["shown_bytes"] == len(out.encode("utf-8"))
