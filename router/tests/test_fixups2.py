import json
import os
import shlex
import sys
from datetime import datetime
from pathlib import Path

import pytest

from metarouter import cli, digest
from metarouter import recipes as store
from metarouter.result import render


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("METAROUTER_HOME", str(tmp_path / "metarouter-home"))
    for name in (
        "AI_AGENT",
        "CLAUDECODE",
        "METAROUTER_OUTPUT",
        "CLAUDE_CODE_SESSION_ID",
        "METAROUTER_CODEX_COMPANION",
        "METAROUTER_SHELL",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(tmp_path)


def checker_body(tmp_path):
    # Writes a python checker that prints a finding and exits 1, and returns the command that runs it.
    script = tmp_path / "checker.py"
    script.write_text("print('synthetic finding')\nraise SystemExit(1)\n", encoding="utf-8")
    return shlex.join([Path(sys.executable).as_posix(), script.as_posix()])


def write_recipe(folder, name, body, source="saved"):
    # Saves a shell recipe with findings [1] into folder as name.json.
    folder.mkdir(parents=True, exist_ok=True)
    recipe = {"name": name, "summary": "x", "args": [], "kind": "shell", "body": body,
              "purity": "read", "source": source, "findings": [1]}
    (folder / f"{name}.json").write_text(json.dumps(recipe), encoding="utf-8")


def user_recipes():
    return Path(os.environ["METAROUTER_HOME"]) / "recipes"


def test_fixups2_compound_exit_is_not_a_finding(tmp_path):
    body = checker_body(tmp_path)
    write_recipe(user_recipes(), "page-check", body)

    plain = cli.exec_lane(["--", body])
    assert plain.ok is True and plain.rec["findings"] is True, "control: the plain command is a finding"

    result = cli.exec_lane(["--", body + " ; exit 1"])
    assert result.ok is False
    assert not result.rec.get("findings")


@pytest.mark.parametrize("joiner", [" ; ", " && ", " || ", " | ", "\n"])
def test_fixups2_runs_body_is_false_for_compound_suffix(joiner):
    body = "checker --strict"
    assert cli.runs_body(body + joiner + "echo hi", body) is False, repr(joiner)


def test_fixups2_runs_body_still_accepts_plain_extra_arguments():
    assert cli.runs_body("checker --strict", "checker --strict") is True
    assert cli.runs_body("checker --strict --verbose", "checker --strict") is True


def test_fixups2_untrusted_project_recipe_gets_no_finding_exemption(tmp_path):
    (tmp_path / ".git").mkdir()
    body = checker_body(tmp_path)
    write_recipe(tmp_path / ".metarouter" / "recipes", "project-check", body, source="project")

    recipe = store.load()["project-check"]
    assert recipe["source"] == "project", "precondition: the repo recipe is loaded"
    assert store.needs_trust(recipe) is True, "precondition: the repo recipe is untrusted"

    result = cli.exec_lane(["--", body])
    assert result.ok is False
    assert not result.rec.get("findings")


def test_fixups2_trusted_saved_recipe_keeps_finding_exemption(tmp_path):
    body = checker_body(tmp_path)
    write_recipe(user_recipes(), "page-check", body, source="saved")

    result = cli.exec_lane(["--", body])
    assert result.ok is True
    assert result.rec["findings"] is True


def test_fixups2_find_no_trunc_returns_every_match(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.txt").write_text("needle one\nneedle two\nneedle three\n", encoding="utf-8")

    result = cli.run_lane(["find", "needle", str(src), "--no-trunc"])

    assert result.ok is True
    for hit in ("needle one", "needle two", "needle three"):
        assert hit in result.out, hit
    assert result.log


def test_fixups2_no_trunc_json_render_keeps_log_key(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.txt").write_text("needle one\nneedle two\nneedle three\n", encoding="utf-8")

    result = cli.run_lane(["find", "needle", str(src), "--no-trunc"])

    assert result.log
    rendered = json.loads(render(result, "json", False))
    assert rendered.get("log") == result.log


def test_fixups2_json_no_trunc_still_returns_short_value(tmp_path):
    file = tmp_path / "data.json"
    file.write_text('{"a": "value"}', encoding="utf-8")

    result = cli.run_lane(["json", str(file), "a", "--no-trunc"])

    assert result.exit == 0
    assert result.out == "value"


def test_fixups2_findings_run_after_success_is_not_broke():
    now = datetime.now().astimezone().isoformat()
    rows = [
        {"recipe": "page-check", "exit": 0, "time": now},
        {"recipe": "page-check", "exit": 1, "findings": True, "time": now},
    ]

    report = digest.build(rows, 7)

    assert report["failed"] == 0
    assert isinstance(report["recipes_broke"], str) and report["recipes_broke"].startswith("none")


def test_fixups2_failing_run_after_success_is_broke():
    now = datetime.now().astimezone().isoformat()
    rows = [
        {"recipe": "page-check", "exit": 0, "time": now},
        {"recipe": "page-check", "exit": 1, "time": now},
    ]

    report = digest.build(rows, 7)

    assert report["failed"] == 1
    assert report["recipes_broke"] == ["page-check"]
