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
