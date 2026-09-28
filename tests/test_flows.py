import json
from pathlib import Path

import pytest

from callrouter import cli


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("CALLROUTER_HOME", str(tmp_path))
    monkeypatch.setenv("AI_AGENT", "1")
    for name in (
        "CLAUDECODE",
        "CALLROUTER_OUTPUT",
        "CLAUDE_CODE_SESSION_ID",
        "CALLROUTER_SHELL",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(tmp_path)


def invoke(capsys, *args):
    exit_code = cli.main(["--json", *(str(arg) for arg in args)])
    captured = capsys.readouterr()
    assert captured.err == ""
    return exit_code, json.loads(captured.out)


def force_check_temp_under(tmp_path, monkeypatch):
    temp_root = tmp_path / "temporary-directories"
    temp_root.mkdir()
    monkeypatch.setattr(cli.tempfile, "tempdir", str(temp_root))


def test_add_flow_saves_recipe_file_with_steps_and_summary(tmp_path, capsys):
    save_exit, save_res = invoke(
        capsys,
        "add",
        "test-flow",
        "--step",
        "exec -- printf step1",
        "--step",
        "exec -- printf step2",
        "--summary",
        "synthetic summary",
    )

    assert save_exit == 0
    assert save_res["ok"] is True
    assert save_res["recipe"] == "test-flow"

    recipe_file = tmp_path / "recipes" / "test-flow.json"
    assert recipe_file.exists()

    data = json.loads(recipe_file.read_text(encoding="utf-8"))
    assert data["kind"] == "flow"
    assert data["body"] == ["exec -- printf step1", "exec -- printf step2"]
    assert data["summary"] == "synthetic summary"


def test_run_flow_with_placeholder_runs_steps_in_order(capsys):
    save_exit, _ = invoke(
        capsys,
        "add",
        "placeholder-flow",
        "--step",
        "exec -- printf first:%s {1}",
        "--step",
        "exec -- printf second:%s {1}",
    )
    assert save_exit == 0

    run_exit, result = invoke(capsys, "run", "placeholder-flow", "synthetic-arg")

    assert run_exit == 0
    assert result["exit"] == 0
    assert result["ok"] is True
    assert isinstance(result["out"], list)
    assert len(result["out"]) == 2

    first_step = result["out"][0]
    assert first_step["step"] == "exec -- printf first:%s synthetic-arg"
    assert first_step["ok"] is True
    assert first_step["exit"] == 0
    assert first_step["out"] == "first:synthetic-arg"

    second_step = result["out"][1]
    assert second_step["step"] == "exec -- printf second:%s synthetic-arg"
    assert second_step["ok"] is True
    assert second_step["exit"] == 0
    assert second_step["out"] == "second:synthetic-arg"


def test_first_failing_step_stops_flow(capsys):
    marker = Path("marker.txt")
    save_exit, _ = invoke(
        capsys,
        "add",
        "failing-flow",
        "--step",
        "exec -- exit 42",
        "--step",
        "exec -- printf ran > marker.txt",
    )
    assert save_exit == 0

    run_exit, result = invoke(capsys, "run", "failing-flow")

    assert run_exit == 42
    assert result["exit"] == 42
    assert result["ok"] is False
    assert not marker.exists()
    assert isinstance(result["out"], list)
    assert len(result["out"]) == 1
    assert result["out"][0]["exit"] == 42
    assert result["out"][0]["ok"] is False


def test_step_running_another_flow_is_refused(capsys):
    save_inner, _ = invoke(
        capsys,
        "add",
        "inner-flow",
        "--step",
        "exec -- printf inner",
    )
    save_outer, _ = invoke(
        capsys,
        "add",
        "outer-flow",
        "--step",
        "run inner-flow",
    )
    assert save_inner == 0
    assert save_outer == 0

    run_exit, result = invoke(capsys, "run", "outer-flow")

    assert run_exit == 2
    assert result["exit"] == 2
    assert result["ok"] is False
    assert isinstance(result["out"], list)
    assert len(result["out"]) == 1
    assert result["out"][0]["exit"] == 2
    assert result["out"][0]["ok"] is False
    assert result["out"][0]["note"] == "a step may not run another flow"


def test_flow_needing_argument_run_without_one_exits_two(capsys):
    save_exit, _ = invoke(
        capsys,
        "add",
        "needs-arg-flow",
        "--step",
        "exec -- printf got:%s {1}",
    )
    assert save_exit == 0

    run_exit, result = invoke(capsys, "run", "needs-arg-flow")

    assert run_exit == 2
    assert result["exit"] == 2
    assert result["ok"] is False
    assert isinstance(result["out"], list)
    assert len(result["out"]) == 1
    assert result["out"][0]["exit"] == 2
    assert result["out"][0]["ok"] is False
    note = result.get("note") or result["out"][0].get("note")
    assert note is not None
    assert "needs 1 arguments" in note


def test_step_with_unknown_verb_exits_two(capsys):
    save_exit, _ = invoke(
        capsys,
        "add",
        "bad-verb-flow",
        "--step",
        "unknownverb argument",
    )
    assert save_exit == 0

    run_exit, result = invoke(capsys, "run", "bad-verb-flow")

    assert run_exit == 2
    assert result["exit"] == 2
    assert result["ok"] is False
    assert isinstance(result["out"], list)
    assert len(result["out"]) == 1
    assert result["out"][0]["exit"] == 2
    assert result["out"][0]["ok"] is False
    assert result["out"][0]["note"] == 'unknown verb "unknownverb"'


def test_check_reports_flows_as_skipped_and_exits_zero(tmp_path, monkeypatch, capsys):
    force_check_temp_under(tmp_path, monkeypatch)
    save_exit, _ = invoke(
        capsys,
        "add",
        "flow-check",
        "--step",
        "exec -- printf checked",
    )
    assert save_exit == 0

    check_exit, result = invoke(capsys, "check")

    assert check_exit == 0
    assert result["exit"] == 0
    assert result["ok"] is True
    assert "skip  flow-check: flow, its steps are checked as recipes" in result["out"]
    assert "FAIL  flow-check" not in result["out"]
    assert "FAIL" not in result["out"]


def test_argument_with_space_and_semicolon_stays_one_argument(capsys):
    marker = Path("injected.txt")
    save_exit, _ = invoke(
        capsys,
        "add",
        "safe-arg-flow",
        "--step",
        "exec -- printf ARG:%s {1}",
    )
    assert save_exit == 0

    malicious = "value with space; touch injected.txt"
    run_exit, result = invoke(capsys, "run", "safe-arg-flow", malicious)

    assert run_exit == 0
    assert result["exit"] == 0
    assert not marker.exists()
    assert isinstance(result["out"], list)
    assert len(result["out"]) == 1
    assert result["out"][0]["ok"] is True
    assert result["out"][0]["exit"] == 0
    assert result["out"][0]["out"] == f"ARG:{malicious}"
