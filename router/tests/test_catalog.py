from conftest import agent_result
import json

import pytest

from metarouter import calls, cli, log
from metarouter import recipes as store
from metarouter.result import human_out


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("METAROUTER_HOME", str(tmp_path / "home"))
    monkeypatch.delenv("METAROUTER_MODE", raising=False)


def test_bad_mode_is_refused():
    with pytest.raises(ValueError):
        store.set_mode("everything")


def test_human_out_lists_and_empties():
    assert human_out(["a", "b"]) == "  a\n  b"
    assert human_out({"cli": ["x"]}) == "  cli:\n    x"
    assert human_out([]) == "[]" and human_out({}) == "{}"


def test_successful_long_output_keeps_head_and_tail_not_error_words():
    from metarouter import shrink
    lines = [f"line {i} test_failed_case passed" for i in range(600)]
    out = shrink.shrink("\n".join(lines), failed=False)
    assert out["errors"] == [] and out["out"].startswith("line 0 ")
    assert "line 599 " in out["out"] and "more like these" in out["out"]
    assert shrink.shrink("\n".join(lines), failed=True)["out"] is None


def test_whole_recipe_output_is_not_shrunk(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "big.txt").write_text("\n".join(f"row {i} failed" for i in range(300)), encoding="utf-8")
    store.save("lines", "cat {1}")
    path = log.home() / "recipes" / "lines.json"
    path.write_text(json.dumps({**json.loads(path.read_text(encoding="utf-8")), "whole": True}), encoding="utf-8")
    assert cli.main(["--json", "run", "lines", "big.txt"]) == 0
    out = agent_result(capsys.readouterr().out)
    assert "errors" not in out and "row 299 failed" in out["out"]


def test_mode_verb(capsys):
    assert cli.main(["--json", "mode", "auto"]) == 0
    assert '"auto:' in capsys.readouterr().out
    assert store.mode() == "auto"


def test_hints_json_field():
    from metarouter import hints
    assert (
        hints.match("x", 'Unknown JSON field: "licenseInfo"', failed=True)
        == "gh lists the valid --json fields in this error, under 'Available fields'. Pick from that list"
    )


def test_page_github_readme(monkeypatch):
    import subprocess
    import types
    import urllib.error
    from metarouter.recipes import web

    calls = []

    def fake_run(*args, **kwargs):
        calls.append((args, kwargs))
        return subprocess.CompletedProcess(args=args[0] if args else [], returncode=0, stdout=b"# Title\nreadme body")

    monkeypatch.setattr("metarouter.recipes.web.subprocess.run", fake_run)
    res = web.page(types.SimpleNamespace(url="github.com/a/b"))
    assert res["exit"] == 0
    assert "readme body" in res["out"]
    assert len(calls) == 1

    calls.clear()

    def fake_urlopen(*args, **kwargs):
        raise urllib.error.URLError("offline")

    monkeypatch.setattr("metarouter.recipes.web.urllib.request.urlopen", fake_urlopen)
    res_issues = web.page(types.SimpleNamespace(url="github.com/a/b/issues/3"))
    assert res_issues["exit"] == 1
    assert len(calls) == 0


def test_replace_undoes_edit_that_breaks_python(tmp_path):
    from metarouter.recipes import replace

    path = tmp_path / "example.py"
    original = "value = 1\n"
    path.write_text(original, encoding="utf-8")

    result = replace.run([str(path), "1", "("])

    assert result["exit"] == 1
    assert "undone" in result["out"]
    assert path.read_text(encoding="utf-8") == original


def test_replace_allows_valid_python_edit(tmp_path):
    from metarouter.recipes import replace

    path = tmp_path / "example.py"
    path.write_text("value = 1\n", encoding="utf-8")

    result = replace.run([str(path), "1", "2"])

    assert result["exit"] == 0
    assert path.read_text(encoding="utf-8") == "value = 2\n"


def test_replace_does_not_block_already_invalid_json(tmp_path):
    from metarouter.recipes import replace

    path = tmp_path / "example.json"
    path.write_text('{"value": }\n', encoding="utf-8")

    result = replace.run([str(path), "value", "renamed"])

    assert result["exit"] == 0
    assert path.read_text(encoding="utf-8") == '{"renamed": }\n'


def test_replace_does_not_parse_text_files(tmp_path):
    from metarouter.recipes import replace

    path = tmp_path / "example.txt"
    path.write_text("value = 1\n", encoding="utf-8")

    result = replace.run([str(path), "1", "("])

    assert result["exit"] == 0
    assert path.read_text(encoding="utf-8") == "value = (\n"


def test_exec_want_finds_matching_chunk(monkeypatch, capsys):
    lines = [f"row {i} ok" for i in range(1, 1001)]
    for i in range(20, 1001, 20):
        lines[i - 1] = ""
    lines[899] = "error: connection refused"
    raw = ("\n".join(lines) + "\n").encode()
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (0, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--want", "connection refused", "--", "x"])

    assert exit_code == 0
    result = agent_result(capsys.readouterr().out)
    assert "connection refused" in result["out"]
    assert "lines " in result["out"]


def test_exec_want_no_match_returns_message(monkeypatch, capsys):
    lines = [f"row {i} ok" for i in range(1, 1001)]
    for i in range(20, 1001, 20):
        lines[i - 1] = ""
    raw = ("\n".join(lines) + "\n").encode()
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (0, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--want", "something absent", "--", "x"])

    assert exit_code == 0
    result = agent_result(capsys.readouterr().out)
    assert result["out"] == "no part of the output matched: something absent (1000 lines; full output in the log)"


def test_shrink_want_unit_test():
    from metarouter import shrink

    text = "section:\nline 1\nline 2\n\nother:\nline 3\nline 4\n"
    res = shrink.want(text, "line 1")
    assert res is not None
    assert "lines 1-3:" in res
    assert "line 1" in res
    assert "lines 5-7:" in res
    assert shrink.want(text, "nothing matches this") is None


def test_exec_no_trunc_wins_over_want(monkeypatch, capsys):
    lines = [f"row {i} ok" for i in range(1, 50)]
    raw = ("\n".join(lines) + "\n").encode()
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (0, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--no-trunc", "--want", "row 10", "--", "x"])

    assert exit_code == 0
    result = agent_result(capsys.readouterr().out)
    assert "lines " not in result["out"]
    assert result["out"].rstrip("\n") == "\n".join(lines)


def test_exec_want_failed_command_fills_errors_and_tail(monkeypatch, capsys):
    lines = ["error: syntax error"] + [f"row {i} ok" for i in range(1, 1500)]
    raw = ("\n".join(lines) + "\n").encode()
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (1, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--want", "syntax", "--", "x"])

    assert exit_code == 1
    result = agent_result(capsys.readouterr().out)
    assert "lines 1-40:" in result["out"]
    assert "error: syntax error" in result["out"]
    assert len(result["tail"]) > 0


def test_filtered_exec_shows_filtered_text_and_note(monkeypatch, capsys):
    raw = b"Requirement already satisfied: pkg\n" * 350 + (
        b"Collecting requests\n"
        b"  Downloading requests-2.31.0-py3-none-any.whl (62 kB)\n"
        b"WARNING: Target directory already exists\n"
        b"Successfully installed requests-2.31.0\n"
    )
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (0, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--", "pip install requests"])

    assert exit_code == 0
    result = agent_result(capsys.readouterr().out)
    assert result["out"] == "WARNING: Target directory already exists\nSuccessfully installed requests-2.31.0"
    assert result["note"] == "filtered by pip-install; full output in the log"


def test_failing_command_with_matching_filter_is_not_filtered(monkeypatch, capsys):
    lines = ["error: Command failed"] + [f"row {i} ok" for i in range(1, 1500)]
    raw = ("\n".join(lines) + "\n").encode()
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (1, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--", "pip install broken"])

    assert exit_code == 1
    result = agent_result(capsys.readouterr().out)
    assert "filtered by" not in (result.get("note") or "")
    assert len(result.get("errors", [])) > 0
    assert len(result.get("tail", [])) > 0


def test_unmatched_command_is_unchanged(monkeypatch, capsys):
    raw = b"unmatched tool output\nhello world\n"
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (0, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--", "echo hello world"])

    assert exit_code == 0
    result = agent_result(capsys.readouterr().out)
    assert result["out"].rstrip("\n") == "unmatched tool output\nhello world"
    assert "filtered by" not in (result.get("note") or "")


def test_check_reports_every_filter_test_as_pass():
    from metarouter import filters

    all_filters = filters.load()
    assert len(all_filters) == 7

    res = cli.check([])
    assert res.ok is True
    assert res.exit == 0

    for flt in all_filters:
        name = flt["name"]
        tests = flt.get("tests", [])
        assert len(tests) >= 2
        assert f"pass  filter:{name}" in res.out

    assert "FAIL  filter:" not in res.out


def test_filtered_shell_recipe_shows_filtered_text_and_note(monkeypatch, capsys):
    store.save("pytest-quick", "pytest -q")
    raw = b"tests/test_cli.py ....                                                   [ 50%]\n" * 150 + (
        b"tests/test_cli.py ....                                                   [ 80%]\n"
        b"tests/test_cli.py .                                                      [100%]\n"
        b"============================== warnings summary ===============================\n"
        b"tests/test_cli.py:10: UserWarning: deprecated setting\n"
        b"  warnings.warn(\"deprecated setting\")\n"
        b"=========================== 5 passed, 1 warning in 0.10s ===========================\n"
    )
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (0, raw, 0.0))

    exit_code = cli.main(["--json", "run", "pytest-quick"])

    assert exit_code == 0
    result = agent_result(capsys.readouterr().out)
    assert "warnings summary" in result["out"]
    assert "5 passed" in result["out"]
    assert result["note"] == "filtered by pytest; full output in the log"


def test_recipe_choices(capsys):
    store.set_mode("auto")
    rdir = log.home() / "recipes"
    rdir.mkdir(parents=True, exist_ok=True)
    pick_json = {
        "name": "pick",
        "summary": "x",
        "args": ["arg1"],
        "kind": "shell",
        "body": "echo {1}",
        "purity": "read",
        "source": "saved",
        "choices": {"1": "printf 'a\\nb\\n'"}
    }
    (rdir / "pick.json").write_text(json.dumps(pick_json), encoding="utf-8")

    assert cli.main(["--json", "run", "pick"]) == 2
    res_pick = agent_result(capsys.readouterr().out)
    assert res_pick["out"] == {"choices for {1}": ["a", "b"]}

    pickfail_json = {
        "name": "pickfail",
        "summary": "x",
        "args": ["arg1"],
        "kind": "shell",
        "body": "exit 3 # {1}",
        "purity": "read",
        "source": "saved",
        "choices": {"1": "printf 'a\\nb\\n'"}
    }
    (rdir / "pickfail.json").write_text(json.dumps(pickfail_json), encoding="utf-8")

    assert cli.main(["--json", "run", "pickfail", "zzz"]) == 3
    res_fail = agent_result(capsys.readouterr().out)
    assert "valid values for {1}: a, b" in res_fail["note"]

    assert cli.main(["--json", "run", "pick", "argval"]) == 0
    res_ok = agent_result(capsys.readouterr().out)
    assert res_ok["ok"] is True
    assert "argval" in res_ok["out"]


def test_recipe_choices_command_fails_or_empty(capsys):
    store.set_mode("auto")
    rdir = log.home() / "recipes"
    rdir.mkdir(parents=True, exist_ok=True)
    pick_empty = {
        "name": "pickempty",
        "summary": "x",
        "args": ["arg1"],
        "kind": "shell",
        "body": "echo {1}",
        "purity": "read",
        "source": "saved",
        "choices": {"1": "printf ''"}
    }
    (rdir / "pickempty.json").write_text(json.dumps(pick_empty), encoding="utf-8")
    assert cli.main(["--json", "run", "pickempty"]) == 2
    res = agent_result(capsys.readouterr().out)
    assert res.get("out") is None
    assert "this recipe needs 1 arguments" in res.get("note", "")

    pick_failcmd = {
        "name": "pickfailcmd",
        "summary": "x",
        "args": ["arg1"],
        "kind": "shell",
        "body": "echo {1}",
        "purity": "read",
        "source": "saved",
        "choices": {"1": "exit 1"}
    }
    (rdir / "pickfailcmd.json").write_text(json.dumps(pick_failcmd), encoding="utf-8")
    assert cli.main(["--json", "run", "pickfailcmd"]) == 2
    res = agent_result(capsys.readouterr().out)
    assert res.get("out") is None
    assert "this recipe needs 1 arguments" in res.get("note", "")


def test_exec_want_word_also_in_the_command_is_kept(monkeypatch, tmp_path):
    monkeypatch.setenv("METAROUTER_HOME", str(tmp_path))
    ran = []
    monkeypatch.setattr(cli, "run_shell", lambda cmd: (ran.append(cmd), (0, b"", 0.0))[1])

    cli.main(["--json", "exec", "--want", "error", "grep", "error", "log.txt"])

    assert ran == ["grep error log.txt"]
