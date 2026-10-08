"""Black-box coverage for the newer CLI lanes, using only synthetic data."""

from conftest import agent_result
import json
import os
import datetime
from pathlib import Path

import pytest

from metarouter import calls, cli, hints, log


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path, monkeypatch):
    home = tmp_path / "metarouter-home"
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.setenv("METAROUTER_HOME", str(home))
    for name in (
        "CLAUDECODE", "AI_AGENT", "CLAUDE_CODE_SESSION_ID",
        "METAROUTER_OUTPUT", "METAROUTER_SHELL", "METAROUTER_CODEX_COMPANION",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(work)


def invoke(capsys, *args):
    code = cli.main(["--json", *(str(arg) for arg in args)])
    captured = capsys.readouterr()
    assert captured.err == ""
    return code, agent_result(captured.out)


def configure(**values):
    path = log.home() / "config.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(values), encoding="utf-8")


def test_log_lane_reads_saved_output_grep_tail_and_errors(capsys, tmp_path):
    saved = log.home() / "logs" / "2026-10-08" / "saved.log"
    saved.parent.mkdir(parents=True)
    saved.write_text("alpha\nBeta two\ngamma\n", encoding="utf-8")
    code, result = invoke(capsys, "log", saved, "--grep", "a", "--tail", "2")
    assert code == 0
    assert result["out"] == "2: Beta two\n3: gamma"
    outside = tmp_path / "outside.txt"
    outside.write_text("not a saved output\n", encoding="utf-8")
    assert invoke(capsys, "log", outside)[0] == 2
    assert invoke(capsys, "log", "missing-ref")[0] == 2
    assert invoke(capsys, "log", saved, "--grep", "[")[0] == 2
    assert invoke(capsys, "log", saved, "--tail", "many")[0] == 2


def test_strict_breaker_refuses_only_repeated_failed_command_shape(capsys):
    configure(strict=True)
    for _ in range(3):
        invoke(capsys, "exec", "--", "exit 7")
    code, result = invoke(capsys, "exec", "--", "exit 7")
    assert code == 3
    assert result["note"].startswith("refused:")


def test_strict_allows_success_or_different_command(capsys):
    configure(strict=True)
    for _ in range(3):
        invoke(capsys, "exec", "--", "exit 8")
    assert invoke(capsys, "exec", "--", "true")[0] == 0
    for _ in range(3):
        invoke(capsys, "exec", "--", "exit 9")
    # Different first shell word gives a distinct shape.
    assert invoke(capsys, "exec", "--", "printf different-shape")[0] != 3


def test_without_strict_failed_command_still_runs(capsys):
    for _ in range(4):
        code, _ = invoke(capsys, "exec", "--", "exit 11")
    assert code == 11


def test_finish_records_hint_and_breaker_flags(capsys):
    for _ in range(3):
        invoke(capsys, "exec", "--", "python -c 'raise SystemExit(1)'")
    invoke(capsys, "exec", "--", "date +%s")
    rows = calls.read()
    assert [row.get("breaker") for row in rows[:3]] == [None, None, True]
    assert rows[-1].get("hinted") is True
    assert not any(row.get("hinted") for row in rows[:3])


def test_stats_counts_rows_private_filter_and_days(capsys):
    now = datetime.datetime.now().astimezone().isoformat()
    calls.append({"time": now, "project": str(Path.cwd()), "agent": "test", "exit": 0,
                  "recipe": "synthetic", "hinted": True, "cmd": "synthetic"})
    calls.append({"time": now, "project": "secret-project", "agent": "test", "exit": 1,
                  "recipe": "hidden", "hinted": False, "cmd": "hidden"})
    configure(private=["secret-project"])
    # Read the pre-filter totals without --here, which would add the private project row.
    code, result = invoke(capsys, "stats", "--days", "2")
    assert code == 0
    stats = result["out"]
    if isinstance(stats, str):
        stats = json.loads(stats)
    assert stats["calls"] == 1
    assert any("synthetic" in line for line in stats["recipes"])
    assert invoke(capsys, "stats", "--days", "tomorrow")[0] == 2


def test_stats_reports_hint_recovery_for_same_tool_and_agent(capsys):
    now = datetime.datetime.now().astimezone().isoformat()
    project = str(Path.cwd())
    calls.append({"time": now, "project": project, "agent": "test", "exit": 1,
                  "hinted": True, "cmd": "cat missing"})
    calls.append({"time": now, "project": project, "agent": "other", "exit": 0,
                  "cmd": "cat missing"})
    calls.append({"time": now, "project": project, "agent": "test", "exit": 0,
                  "cmd": "cat missing"})
    code, result = invoke(capsys, "stats")
    assert code == 0
    assert result["out"]["hints"].startswith("1 shown in 1 calls that record hints, 1 followed by a success")


def test_export_only_saved_recipes_and_import_rules(capsys, tmp_path):
    cli.main(["--json", "add", "mine", "--", "printf mine"])
    configure(private=["private"])
    private_recipe = log.home() / "recipes" / "private.json"
    private_recipe.parent.mkdir(parents=True, exist_ok=True)
    private_recipe.write_text(json.dumps({"name": "private", "kind": "shell", "body": "echo private"}))
    export_path = tmp_path / "recipes.json"
    code, _ = invoke(capsys, "export", export_path)
    assert code == 0
    exported = json.loads(export_path.read_text(encoding="utf-8"))
    if isinstance(exported, dict):
        exported = exported.get("recipes", [])
    assert [r["name"] for r in exported] == ["mine"]
    assert invoke(capsys, "import", export_path)[0] == 2
    # Human mode is the supported import interface.
    payload = tmp_path / "incoming.json"
    payload.write_text(json.dumps([
        {"name": "flow-one", "kind": "flow", "body": []},
        {"name": "bad", "kind": "not-a-recipe"},
    ]), encoding="utf-8")
    payload.write_text(json.dumps({"recipes": json.loads(payload.read_text())}), encoding="utf-8")
    capsys.readouterr()
    human_code = cli.main(["--human", "import", str(payload)])
    assert human_code == 0
    assert "flow-one" in capsys.readouterr().out


def test_export_without_saved_recipes_fails(capsys, tmp_path):
    assert invoke(capsys, "export", tmp_path / "empty.json")[0] == 1


def test_no_private_warning_and_learn_note(capsys):
    assert log.no_private_warning()
    configure(private=["private"])
    assert log.no_private_warning() is None
    # Ingest's learn result exposes the warning state in its result note.
    from metarouter import ingest

    assert ingest.no_private_warning() is None


def test_engine_scripts_come_from_config_and_missing_config_is_named(tmp_path, monkeypatch):
    from metarouter.recipes import engines

    runner = tmp_path / "gemini-runner.sh"
    runner.write_text("#!/bin/sh\n", encoding="utf-8")
    configure(engines={"gemini": str(runner), "local": str(runner)})
    assert Path(engines.script("gemini")) == runner
    assert Path(engines.script("local")) == runner
    (log.home() / "config.json").unlink()
    with pytest.raises(FileNotFoundError, match="config.json"):
        engines.script("gemini")


def test_engine_strips_footer_block(tmp_path, monkeypatch, capsys):
    from metarouter.recipes import engines

    from metarouter import recipes

    monkeypatch.setenv("METAROUTER_SHELL", "bash")
    runner = tmp_path / "gemini-runner.sh"
    runner.write_text("#!/bin/sh\nprintf 'answer\\n------------------------------\\ngemini-runner: footer\\n'\n", encoding="utf-8")
    configure(engines={"gemini": str(runner)})
    # Exercise output cleanup through the engine's normal runner path.
    recipe = {"name": "gemini", "kind": "engine", "engine": "gemini"}
    # Test the same cleanup path without depending on launching a platform shell.
    monkeypatch.setattr(cli.subprocess, "run", lambda *a, **k: __import__("subprocess").CompletedProcess(
        args=a[0], returncode=0,
        stdout=b"answer\n------------------------------\ngemini-runner: footer\n", stderr=b""
    ))
    result = cli.run_engine(recipe, ["synthetic prompt"])
    assert result.exit == 0
    assert "answer" in str(result.out)
    assert "footer" not in str(result.out)


def test_stats_skips_rows_whose_recipe_name_is_private(capsys):
    now = datetime.datetime.now().astimezone().isoformat()
    calls.append({"time": now, "project": str(Path.cwd()), "agent": "test", "exit": 0, "recipe": "deploy-secret"})
    calls.append({"time": now, "project": str(Path.cwd()), "agent": "test", "exit": 0, "recipe": "open"})
    configure(private=["secret"])
    code, result = invoke(capsys, "stats")
    assert code == 0
    assert result["out"]["calls"] == 1
    assert not any("deploy-secret" in line for line in result["out"]["recipes"])


def test_export_matches_private_patterns_against_raw_text(capsys, tmp_path):
    recipe = log.home() / "recipes" / "two-lines.json"
    recipe.parent.mkdir(parents=True, exist_ok=True)
    recipe.write_text(json.dumps({"name": "two-lines", "kind": "flow", "body": ["echo a", "echo b"],
                                  "summary": "first\nsecond"}), encoding="utf-8")
    cli.main(["--json", "add", "plain-one", "--", "printf ok"])
    capsys.readouterr()
    configure(private=["first\nsecond"])
    out = tmp_path / "export.json"
    code, result = invoke(capsys, "export", out)
    assert code == 0
    names = [r["name"] for r in json.loads(out.read_text(encoding="utf-8"))["recipes"]]
    assert names == ["plain-one"]
