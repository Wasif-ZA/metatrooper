import json
from pathlib import Path

import pytest

from callrouter import cli, shrink
from callrouter.result import Result


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("CALLROUTER_HOME", str(tmp_path / "callrouter-home"))
    for name in (
        "AI_AGENT",
        "CLAUDECODE",
        "CALLROUTER_OUTPUT",
        "CLAUDE_CODE_SESSION_ID",
        "CALLROUTER_SHELL",
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
        ("--human", {"AI_AGENT": "1", "CALLROUTER_OUTPUT": "json"}, False),
        ("--json", {"CALLROUTER_OUTPUT": "human"}, True),
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
    logs = list((tmp_path / "callrouter-home").rglob("*.log"))
    assert len(logs) == 1
    assert logs[0].read_bytes() == b"--json\n"


def test_log_preserves_raw_non_ascii_and_binaryish_bytes(tmp_path, capsys):
    expected = b"caf\xc3\xa9\x00\xff\nraw\rbyte"
    command = r"printf 'caf\303\251\000\377\nraw\rbyte'"

    exit_code = cli.main(["--json", "exec", "--", command])

    captured = capsys.readouterr()
    result = json.loads(captured.out)
    log_path = Path(result["log"])
    assert exit_code == 0
    assert captured.out.count("\n") == 1
    assert log_path.name.endswith(".log")
    assert log_path.is_relative_to(tmp_path / "callrouter-home")
    assert b"\r\n" not in expected
    assert log_path.read_bytes() == expected


def test_shrinker_failure_prints_raw_output_and_preserves_exit_code(monkeypatch, capsys):
    def crash(_text):
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


def test_all_run_files_stay_under_callrouter_home(tmp_path, monkeypatch, capsys):
    callrouter_home = tmp_path / "callrouter-home"
    working_directory = tmp_path / "working"
    outside_directory = tmp_path / "outside"
    working_directory.mkdir()
    outside_directory.mkdir()
    monkeypatch.chdir(working_directory)

    exit_code = cli.main(["--json", "exec", "--", "printf isolated"])

    result = json.loads(capsys.readouterr().out)
    written_files = [path for path in tmp_path.rglob("*") if path.is_file()]
    assert exit_code == 0
    assert written_files
    assert not list(outside_directory.rglob("*"))
    assert all(path.is_relative_to(callrouter_home) for path in written_files)
    assert Path(result["log"]).is_relative_to(callrouter_home)


def test_unknown_verb_suggests_close_known_verb(capsys):
    exit_code = cli.main(["--json", "rum"])

    result = json.loads(capsys.readouterr().out)
    assert exit_code == 2
    assert 'no verb "rum"' in result["note"]
    assert "Did you mean: callrouter run" in result["note"]
