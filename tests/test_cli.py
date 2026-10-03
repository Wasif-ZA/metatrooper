import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest

from toolrouter import cli, shrink
from toolrouter.result import Result


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("TOOLROUTER_HOME", str(tmp_path / "toolrouter-home"))
    for name in (
        "AI_AGENT",
        "CLAUDECODE",
        "TOOLROUTER_OUTPUT",
        "CLAUDE_CODE_SESSION_ID",
        "TOOLROUTER_SHELL",
    ):
        monkeypatch.delenv(name, raising=False)


@pytest.mark.parametrize("agent_variable", ["AI_AGENT", "CLAUDECODE"])
@pytest.mark.parametrize(
    "argv",
    [
        ["exec", "--", "printf agent-run"],
        [],
        ["rum"],
    ],
    ids=["exec", "bare-menu", "unknown-verb"],
)
def test_agent_environment_prints_exactly_one_json_line(
    agent_variable, argv, monkeypatch, capsys
):
    monkeypatch.setenv(agent_variable, "1")

    exit_code = cli.main(argv)

    captured = capsys.readouterr()
    assert captured.err == ""
    assert captured.out.count("\n") == 1
    result = json.loads(captured.out)
    assert isinstance(result, dict)
    assert result["exit"] == exit_code


@pytest.mark.parametrize(
    "argv",
    [
        ["exec", "--", "printf human-run"],
        [],
        ["rum"],
    ],
    ids=["exec", "bare-menu", "unknown-verb"],
)
def test_without_agent_environment_or_flag_output_is_not_json(argv, capsys):
    cli.main(argv)

    captured = capsys.readouterr()
    assert captured.err == ""
    with pytest.raises(json.JSONDecodeError):
        json.loads(captured.out)


@pytest.mark.parametrize(
    ("flag", "environment", "expect_json"),
    [
        ("--human", {"AI_AGENT": "1", "TOOLROUTER_OUTPUT": "json"}, False),
        ("--json", {"TOOLROUTER_OUTPUT": "human"}, True),
    ],
)
def test_output_flag_overrides_environment(flag, environment, expect_json, monkeypatch, capsys):
    for name, value in environment.items():
        monkeypatch.setenv(name, value)

    cli.main([flag])

    output = capsys.readouterr().out
    if expect_json:
        assert isinstance(json.loads(output), dict)
    else:
        with pytest.raises(json.JSONDecodeError):
            json.loads(output)


def test_output_flag_after_bare_separator_belongs_to_command(tmp_path, capsys):
    exit_code = cli.main(["exec", "--", "echo", "--json"])

    captured = capsys.readouterr()
    assert exit_code == 0
    assert "--json" in captured.out
    with pytest.raises(json.JSONDecodeError):
        json.loads(captured.out)
    logs = list((tmp_path / "toolrouter-home").rglob("*.log"))
    assert len(logs) == 1
    assert logs[0].read_bytes() == b"--json\n"


@pytest.mark.parametrize(
    "pythonioencoding",
    [None, "cp1252"],
    ids=["unset", "cp1252"],
)
def test_subprocess_stdout_is_utf8_regardless_of_pythonioencoding(
    pythonioencoding, tmp_path
):
    repo_root = Path(__file__).resolve().parents[1]
    environment = os.environ.copy()
    environment["TOOLROUTER_HOME"] = str(tmp_path / "subprocess-home")
    environment["PYTHONPATH"] = str(repo_root)
    if pythonioencoding is None:
        environment.pop("PYTHONIOENCODING", None)
    else:
        environment["PYTHONIOENCODING"] = pythonioencoding

    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            "from toolrouter.cli import entry; entry()",
            "--json",
            "exec",
            "--",
            r"printf 'I\342\200\231ve caf\303\251'",
        ],
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    decoded = completed.stdout.decode("utf-8")
    assert completed.returncode == 0, completed.stderr.decode(errors="replace")
    assert decoded.count("\n") == 1
    assert decoded.endswith("\n")
    assert json.loads(decoded)["out"] == "I’ve café"


def test_exec_no_trunc_returns_exactly_8000_cleaned_characters_whole(monkeypatch, capsys):
    raw = b"\x1b[31m" + (b"x" * 8000) + b"\x1b[0m"
    monkeypatch.setattr(cli, "run_shell", lambda _command: (0, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--no-trunc", "--", "synthetic"])

    result = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert result["out"] == "x" * 8000
    assert "\x1b" not in result["out"]
    assert "log" not in result


def test_exec_no_trunc_cuts_after_8000_characters_and_names_log(monkeypatch, capsys):
    monkeypatch.setattr(cli, "run_shell", lambda _command: (0, b"y" * 8001, 0.0))

    exit_code = cli.main(["--json", "exec", "--no-trunc", "--", "synthetic"])

    result = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert result["out"] == ("y" * 8000) + "\n... (cut, full output in the log)"
    assert Path(result["log"]).read_bytes() == b"y" * 8001


def test_exec_no_trunc_after_separator_is_part_of_command(monkeypatch, capsys):
    seen = []

    def fake_run_shell(command):
        seen.append(command)
        return 0, b"command received its flag", 0.0

    monkeypatch.setattr(cli, "run_shell", fake_run_shell)

    exit_code = cli.main(
        ["--json", "exec", "--", "printf", "%s", "--no-trunc"]
    )

    result = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert seen == ["printf %s --no-trunc"]
    assert result["out"] == "command received its flag"


def test_successful_shrunk_exec_note_names_no_trunc(monkeypatch, capsys):
    raw = ("ordinary output\n" * 150).encode()
    assert len(raw) > 2000
    monkeypatch.setattr(cli, "run_shell", lambda _command: (0, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--", "synthetic"])

    result = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert "lines not shown" in result["out"]
    assert "--no-trunc" in result["note"]
    assert "log" in result


def test_short_exec_has_no_shrinking_note(monkeypatch, capsys):
    monkeypatch.setattr(cli, "run_shell", lambda _command: (0, b"short output", 0.0))

    exit_code = cli.main(["--json", "exec", "--", "synthetic"])

    result = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert result["out"] == "short output"
    assert "note" not in result


def test_successful_shrunk_json_exec_note_names_no_trunc(monkeypatch, capsys):
    raw = json.dumps({"records": ["x" * 100 for _ in range(30)]}).encode()
    assert len(raw) > 2000
    monkeypatch.setattr(cli, "run_shell", lambda _command: (0, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--", "synthetic"])

    result = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert "--no-trunc" in result["note"]
    assert "log" in result


def install_python_recipe(monkeypatch, response):
    recipe = {
        "name": "synthetic",
        "kind": "python",
        "body": "synthetic_recipe",
        "purity": "read",
    }
    module = SimpleNamespace(run=lambda _args: response)
    monkeypatch.setattr(cli.store, "load", lambda: {"synthetic": recipe})
    monkeypatch.setattr(cli.store, "module", lambda _recipe: module)
    return recipe


@pytest.mark.parametrize(
    ("answer", "expected_shape"),
    [
        ({"records": ["x" * 100 for _ in range(100)]}, {"records": {"len": 100, "first": ["x" * 80 + "..."] * 3}}),
        (["x" * 100 for _ in range(100)], {"len": 100, "first": ["x" * 80 + "..."] * 3}),
    ],
    ids=["dict", "list"],
)
def test_oversized_structured_recipe_answer_returns_json_shape(
    answer, expected_shape, monkeypatch, capsys
):
    assert len(json.dumps(answer)) > 8000
    install_python_recipe(monkeypatch, {"exit": 0, "out": answer})

    exit_code = cli.main(["--json", "run", "synthetic"])

    result = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert result["out"] == expected_shape
    assert isinstance(result["out"], dict)
    assert "shape" in result["note"]
    assert Path(result["log"]).is_file()


def test_oversized_string_recipe_answer_is_cut_with_marker(monkeypatch, capsys):
    install_python_recipe(monkeypatch, {"exit": 0, "out": "z" * 8001})

    exit_code = cli.main(["--json", "run", "synthetic"])

    result = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert result["out"] == ("z" * 8000) + "\n... (cut, full output in the log)"
    assert Path(result["log"]).is_file()


def test_run_python_returns_five_values_and_propagates_whole(monkeypatch, capsys):
    response = {"exit": 0, "out": {"answer": 42}, "full": "verbose raw data", "whole": True}
    recipe = install_python_recipe(monkeypatch, response)

    values = cli.run_python(recipe, [])
    exit_code = cli.main(["--json", "run", "synthetic"])

    result = json.loads(capsys.readouterr().out)
    assert len(values) == 5
    assert values[0] == 0
    assert values[1] == {"answer": 42}
    assert values[2] == b"verbose raw data"
    assert values[4] is True
    assert exit_code == 0
    assert result["out"] == {"answer": 42}
    assert "log" not in result


def test_log_preserves_raw_non_ascii_and_binaryish_bytes(tmp_path, capsys):
    expected = b"caf\xc3\xa9\x00\xff\nraw\rbyte"
    command = r"printf 'caf\303\251\000\377\nraw\rbyte'"

    exit_code = cli.main(["--json", "exec", "--", command])

    captured = capsys.readouterr()
    result = json.loads(captured.out)
    logs = list((tmp_path / "toolrouter-home").rglob("*.log"))
    assert exit_code == 0
    assert captured.out.count("\n") == 1
    assert "log" not in result
    assert len(logs) == 1
    log_path = logs[0]
    assert log_path.name.endswith(".log")
    assert log_path.is_relative_to(tmp_path / "toolrouter-home")
    assert b"\r\n" not in expected
    assert log_path.read_bytes() == expected


def test_shrinker_failure_prints_raw_output_and_preserves_exit_code(monkeypatch, capsys):
    def crash(_text, **_kw):
        raise RuntimeError("synthetic shrink failure")

    monkeypatch.setattr(shrink, "shrink", crash)

    exit_code = cli.main(["--human", "exec", "--", "printf 'visible raw output'; exit 3"])

    captured = capsys.readouterr()
    assert exit_code == 3
    assert "visible raw output" in captured.out
    assert "shrinker failed (RuntimeError); output shown whole" in captured.out


@pytest.mark.parametrize("command_exit", [0, 1, 3, 42])
def test_main_returns_underlying_command_exit_code(command_exit, capsys):
    returned = cli.main(["--json", "exec", "--", f"exit {command_exit}"])

    result = json.loads(capsys.readouterr().out)
    assert returned == command_exit
    assert result["exit"] == command_exit


@pytest.mark.parametrize(
    "marker",
    [
        None,
        {"ran": "backup", "why": "unavailable"},
        {"requested": "primary", "why": "unavailable"},
        {"requested": "primary", "ran": "backup"},
    ],
    ids=["no-marker", "missing-requested", "missing-ran", "missing-why"],
)
def test_result_rejects_fallback_without_complete_marker(marker):
    with pytest.raises(ValueError, match="fallback result needs a marker"):
        Result(ok=True, lane="exec", fallback="backup", marker=marker)


def test_result_accepts_fallback_with_complete_marker():
    marker = {"requested": "primary", "ran": "backup", "why": "primary unavailable"}

    result = Result(ok=True, lane="exec", fallback="backup", marker=marker)

    assert result.fallback == "backup"
    assert result.marker == marker


def test_all_run_files_stay_under_toolrouter_home(tmp_path, monkeypatch, capsys):
    toolrouter_home = tmp_path / "toolrouter-home"
    working_directory = tmp_path / "working"
    outside_directory = tmp_path / "outside"
    working_directory.mkdir()
    outside_directory.mkdir()
    monkeypatch.chdir(working_directory)

    exit_code = cli.main(["--json", "exec", "--", "printf isolated"])

    result = json.loads(capsys.readouterr().out)
    written_files = [path for path in tmp_path.rglob("*") if path.is_file()]
    logs = list(toolrouter_home.rglob("*.log"))
    assert exit_code == 0
    assert "log" not in result
    assert written_files
    assert len(logs) == 1
    assert not list(outside_directory.rglob("*"))
    assert all(path.is_relative_to(toolrouter_home) for path in written_files)
    assert logs[0].is_relative_to(toolrouter_home)


def test_unknown_verb_suggests_close_known_verb(capsys):
    exit_code = cli.main(["--json", "rum"])

    result = json.loads(capsys.readouterr().out)
    assert exit_code == 2
    assert 'no verb "rum"' in result["note"]
    assert "Did you mean: toolrouter run" in result["note"]
