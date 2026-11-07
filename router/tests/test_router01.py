import json
import os
import shlex
import sys
from pathlib import Path

import pytest

from metarouter import calls, cli, digest, hints
from metarouter.recipes import engines, json_get


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


def test_inline_python_json_read_hint_names_recipe():
    command = 'python -c "import json; print(json.load(open(\'x.json\'))[\'a\'])"'

    assert "metarouter run json" in hints.match(command)


def test_exec_inline_python_json_loads_records_recipe_hint():
    code = "import json; print(json.loads('{\"a\": 1}')[\"a\"])"
    command = shlex.join([Path(sys.executable).as_posix(), "-c", code])

    result = cli.exec_lane(["--", command])

    assert result.exit == 0
    assert "metarouter run json" in result.hint
    assert result.rec["hinted"] is True


def test_run_json_strips_no_trunc(tmp_path):
    file = tmp_path / "data.json"
    file.write_text('{"a": "value"}', encoding="utf-8")

    result = cli.run_lane(["json", str(file), "a", "--no-trunc"])

    assert result.exit == 0
    assert result.out == "value"


def test_codex_prompt_file_is_passed_through_and_must_exist(tmp_path, monkeypatch):
    companion = tmp_path / "dummy-companion.mjs"
    companion.write_text("", encoding="utf-8")
    monkeypatch.setenv("METAROUTER_CODEX_COMPANION", str(companion))
    prompt_file = Path("prompt.txt")
    prompt_file.write_text("synthetic task text", encoding="utf-8")

    argv = engines.argv(
        {"engine": "codex"}, ["--prompt-file", str(prompt_file), "--write"], "bash"
    )

    assert argv == [
        "node", str(companion), "task", "--write",
        "--prompt-file", str(prompt_file.resolve()),
    ]
    with pytest.raises(FileNotFoundError):
        engines.argv(
            {"engine": "codex"},
            ["--prompt-file", str(tmp_path / "missing.txt"), "--write"],
            "bash",
        )


def test_json_bom_file_dotted_path(tmp_path):
    file = tmp_path / "data.json"
    file.write_text(
        '{"columns":{"task_03":{"from":"todo"}},"notes":"hi"}', encoding="utf-8-sig"
    )

    result = json_get.run([str(file), "columns.task_03.from"])

    assert result["exit"] == 0
    assert result["out"] == "todo"


def test_json_bom_file_single_key(tmp_path):
    file = tmp_path / "data.json"
    file.write_text(
        '{"columns":{"task_03":{"from":"todo"}},"notes":"hi"}', encoding="utf-8-sig"
    )

    result = json_get.run([str(file), "notes"])

    assert result["exit"] == 0
    assert result["out"] == "hi"


def test_checker_findings_are_successful_and_excluded_from_digest_failures(tmp_path):
    script = tmp_path / "checker.py"
    script.write_text("print('synthetic finding')\nraise SystemExit(1)\n", encoding="utf-8")
    folder = Path(os.environ["METAROUTER_HOME"]) / "recipes"
    folder.mkdir(parents=True)
    recipe = {
        "name": "page-check", "summary": "x", "args": [], "kind": "shell",
        "body": shlex.join([Path(sys.executable).as_posix(), script.as_posix()]),
        "purity": "read", "source": "saved", "findings": [1],
    }
    (folder / "page-check.json").write_text(json.dumps(recipe), encoding="utf-8")

    result = cli.run_lane(["page-check"])

    assert result.ok is True
    assert result.exit == 1
    assert result.rec["findings"] is True
    # Direct lane calls return the record; main normally appends it.
    calls.append(result.rec)
    report = digest.build(calls.read(), 7)
    assert report["failed"] == 0
    assert report["findings"] == 1
    assert report["top_failures"] == []
