import io
import json
import sys

from metarouter import hook


def test_main_ignores_other_tools(monkeypatch, capsys):
    for tool in ("Write", "Read"):
        payload = json.dumps({"tool_name": tool, "tool_input": {"file_path": "a.txt", "content": "x"}})
        monkeypatch.setattr(sys, "stdin", io.StringIO(payload))
        hook.main()
        assert capsys.readouterr() == ("", "")


def test_main_invalid_json(monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO("{invalid json"))
    hook.main()
    assert capsys.readouterr() == ("", "")


def test_main_decodes_utf8_stdin_with_cp1252_wrapper(monkeypatch, capsys):
    # Feeds a Bash event with non-ASCII command text through a cp1252 buffer wrapper.
    cmd = "pytest café.txt"
    payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}}, ensure_ascii=False)
    raw_bytes = payload.encode("utf-8")
    fake_stdin = io.TextIOWrapper(io.BytesIO(raw_bytes), encoding="cp1252")
    monkeypatch.setattr(sys, "stdin", fake_stdin)
    hook.main()
    out, _ = capsys.readouterr()
    result = json.loads(out)
    rewritten = result["hookSpecificOutput"]["updatedInput"]["command"]
    assert cmd in rewritten

