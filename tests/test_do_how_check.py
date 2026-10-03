from conftest import agent_result
import json
from pathlib import Path

import pytest
from PIL import Image

from metarouter import calls, cli


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path, monkeypatch):
    home = tmp_path / "metarouter-home"
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.setenv("METAROUTER_HOME", str(home))
    for name in (
        "AI_AGENT",
        "CLAUDECODE",
        "METAROUTER_OUTPUT",
        "CLAUDE_CODE_SESSION_ID",
        "METAROUTER_SHELL",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(work)


def invoke(capsys, *args):
    exit_code = cli.main(["--json", *(str(arg) for arg in args)])
    captured = capsys.readouterr()
    assert captured.err == ""
    return exit_code, agent_result(captured.out)


def write_recipe(home, name, **overrides):
    folder = home / "recipes"
    folder.mkdir(parents=True, exist_ok=True)
    recipe = {
        "name": name,
        "summary": f"synthetic {name}",
        "args": [],
        "kind": "shell",
        "body": "printf synthetic",
        "purity": "read",
        "source": "saved",
    }
    recipe.update(overrides)
    (folder / f"{name}.json").write_text(json.dumps(recipe), encoding="utf-8")


def write_calls(home, rows):
    home.mkdir(parents=True, exist_ok=True)
    (home / "calls.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8"
    )


def call_row(recipe, project, exit_code=0, nbytes=0, secs=0):
    return {
        "time": "2026-09-28T12:00:00+10:00",
        "project": project,
        "agent": "synthetic",
        "lane": "run",
        "recipe": recipe,
        "shape": recipe,
        "exit": exit_code,
        "secs": secs,
        "bytes": nbytes,
        "log": "synthetic.log",
    }


def force_check_temp_under(tmp_path, monkeypatch):
    temp_root = tmp_path / "temporary-directories"
    temp_root.mkdir()
    monkeypatch.setattr(cli.tempfile, "tempdir", str(temp_root))


def test_do_unknown_recipe_suggests_close_name(capsys):
    exit_code, result = invoke(capsys, "run", "replce")

    assert exit_code == 2
    assert 'no recipe "replce"' in result["note"]
    assert "Did you mean: metarouter run replace" in result["note"]


def test_saved_shell_placeholders_quote_arguments_safely(capsys):
    body = r"printf '%s\n' {1}; printf '%s\n' {2}"
    save_exit, _ = invoke(capsys, "add", "safe-print", "--", body)
    malicious = "second value; touch injected.txt"

    do_exit, result = invoke(capsys, "run", "safe-print", "first value", malicious)

    assert save_exit == 0
    assert do_exit == 0
    assert result["out"].rstrip("\n") == f"first value\n{malicious}"
    assert not Path("injected.txt").exists()


def test_destructive_recipe_refuses_without_yes_and_runs_with_yes(capsys):
    save_exit, _ = invoke(
        capsys,
        "add",
        "dangerous",
        "--purity",
        "destructive",
        "--",
        "printf ran > destructive.txt",
    )

    refused_exit, refused = invoke(capsys, "run", "dangerous")
    assert save_exit == 0
    assert refused_exit == 2
    assert "destructive" in refused["note"]
    assert not Path("destructive.txt").exists()

    allowed_exit, _ = invoke(capsys, "run", "dangerous", "--yes")
    assert allowed_exit == 0
    assert Path("destructive.txt").read_bytes() == b"ran"


def test_python_recipe_exception_returns_one_without_escaping(
    tmp_path, monkeypatch, capsys
):
    module = tmp_path / "synthetic_crashing_recipe.py"
    module.write_text(
        "def run(args):\n    raise RuntimeError('synthetic boom')\n", encoding="utf-8"
    )
    monkeypatch.syspath_prepend(str(tmp_path))
    home = tmp_path / "metarouter-home"
    write_recipe(
        home,
        "crasher",
        kind="python",
        body="synthetic_crashing_recipe",
    )

    exit_code, result = invoke(capsys, "run", "crasher")

    assert exit_code == 1
    assert result["ok"] is False
    assert "recipe crasher crashed: RuntimeError: synthetic boom" in result["out"]


@pytest.mark.parametrize(
    "bad_name",
    ["Uppercase", "has space", "-leading-dash", "a" * 41],
)
def test_save_rejects_bad_names(bad_name, capsys):
    exit_code, result = invoke(capsys, "add", bad_name, "--", "printf nope")

    assert exit_code == 2
    assert "bad recipe name" in result["note"]


def test_save_archives_each_previous_version(tmp_path, capsys):
    for body in ("printf one", "printf two", "printf three"):
        exit_code, _ = invoke(capsys, "add", "versioned", "--", body)
        assert exit_code == 0

    folder = tmp_path / "metarouter-home" / "recipes"
    first = json.loads((folder / "archive" / "versioned@1.json").read_text(encoding="utf-8"))
    second = json.loads((folder / "archive" / "versioned@2.json").read_text(encoding="utf-8"))
    current = json.loads((folder / "versioned.json").read_text(encoding="utf-8"))
    assert first["body"] == "printf one"
    assert second["body"] == "printf two"
    assert current["body"] == "printf three"


def test_saved_recipe_overrides_seed_with_same_name(capsys):
    save_exit, _ = invoke(capsys, "add", "replace", "--", "printf 'saved override'")

    do_exit, result = invoke(capsys, "run", "replace")

    assert save_exit == 0
    assert do_exit == 0
    assert result["out"] == "saved override"


def test_check_reports_all_five_seed_recipes_pass(tmp_path, monkeypatch, capsys):
    force_check_temp_under(tmp_path, monkeypatch)

    exit_code, result = invoke(capsys, "check")

    assert exit_code == 0
    lines = set(result["out"].splitlines())
    assert {
        "pass  find",
        "pass  img",
        "pass  json",
        "pass  json-set",
        "pass  replace",
    } <= lines


def test_check_reports_failing_saved_example_and_exits_one(
    tmp_path, monkeypatch, capsys
):
    force_check_temp_under(tmp_path, monkeypatch)
    write_recipe(
        tmp_path / "metarouter-home",
        "broken-example",
        body="printf actual",
        example={"setup": {}, "args": [], "expect_exit": 0, "expect_out": "wanted"},
    )

    exit_code, result = invoke(capsys, "check")

    assert exit_code == 1
    assert "FAIL  broken-example" in result["out"]
    assert "output lacks 'wanted'" in result["out"]


def test_check_writes_no_call_log_and_creates_no_cwd_files(
    tmp_path, monkeypatch, capsys
):
    force_check_temp_under(tmp_path, monkeypatch)
    home = tmp_path / "metarouter-home"
    write_recipe(
        home,
        "checked",
        example={"setup": {"fixture.txt": "synthetic"}, "args": [], "expect_exit": 0,
                 "expect_out": "synthetic"},
    )
    work = Path.cwd()
    files_before = {path.relative_to(home) for path in home.rglob("*") if path.is_file()}

    exit_code, _ = invoke(capsys, "check")

    files_after = {path.relative_to(home) for path in home.rglob("*") if path.is_file()}
    assert exit_code == 0
    assert files_after == files_before == {Path("recipes/checked.json")}
    assert not (home / "calls.jsonl").exists()
    assert not (home / "logs").exists()
    assert list(work.iterdir()) == []


def test_how_ranks_using_current_project_calls_before_other_projects(
    tmp_path, monkeypatch, capsys
):
    home = tmp_path / "metarouter-home"
    write_recipe(home, "alpha-tool", summary="projectword synthetic")
    write_recipe(home, "beta-tool", summary="projectword synthetic")
    rows = []
    rows += [call_row("alpha-tool", "current", exit_code=1) for _ in range(5)]
    rows += [call_row("beta-tool", "current", exit_code=0) for _ in range(5)]
    rows += [call_row("alpha-tool", "other", exit_code=0) for _ in range(10)]
    rows += [call_row("beta-tool", "other", exit_code=1) for _ in range(10)]
    write_calls(home, rows)
    monkeypatch.setattr(calls, "project", lambda cwd=None: "current")

    exit_code, result = invoke(capsys, "search", "projectword")

    assert exit_code == 0
    assert result["out"].index("metarouter run beta-tool") < result["out"].index(
        "metarouter run alpha-tool"
    )
    assert result["out"].count("(5 calls here)") == 2


def test_how_recipe_under_five_calls_takes_median_score(
    tmp_path, monkeypatch, capsys
):
    home = tmp_path / "metarouter-home"
    for name in ("high", "middle", "newcomer", "low"):
        write_recipe(home, name, summary="medianword synthetic")
    rows = []
    rows += [call_row("high", "current", 0) for _ in range(5)]
    rows += [call_row("middle", "current", 0) for _ in range(3)]
    rows += [call_row("middle", "current", 1) for _ in range(2)]
    rows += [call_row("newcomer", "current", 0)]
    rows += [call_row("low", "current", 1) for _ in range(5)]
    write_calls(home, rows)
    monkeypatch.setattr(calls, "project", lambda cwd=None: "current")

    exit_code, result = invoke(capsys, "search", "medianword")

    assert exit_code == 0
    positions = {
        name: result["out"].index(f"metarouter run {name}")
        for name in ("high", "middle", "newcomer")
    }
    assert positions["high"] < positions["middle"] < positions["newcomer"]
    assert "metarouter run low" not in result["out"]
    assert result["out"].endswith("+1 more: add words to narrow")


def test_how_word_matching_nothing_exits_one(capsys):
    exit_code, result = invoke(capsys, "search", "definitely-no-such-recipe-word")

    assert exit_code == 1
    assert "no recipe matches" in result["note"]


@pytest.mark.parametrize(
    "verb",
    ["replace", "undo", "json", "json-set", "img", "find", "run", "add", "check", "search"],
)
def test_agent_mode_each_recipe_verb_prints_exactly_one_json_line(
    verb, tmp_path, monkeypatch, capsys
):
    home = tmp_path / "metarouter-home"
    force_check_temp_under(tmp_path, monkeypatch)
    Path("data.json").write_text('{"a": [1, 2]}', encoding="utf-8")
    Path("text.txt").write_text("needle old\n", encoding="utf-8")
    Image.new("RGB", (8, 6), "white").save("tiny.png")
    write_recipe(home, "echoer", body="printf echo")
    argv_by_verb = {
        "replace": ["run", "replace", "text.txt", "old", "new"],
        "undo": ["undo"],
        "json": ["run", "json", "data.json", ".a"],
        "json-set": ["run", "json-set", "data.json", ".a[0]", "9"],
        "img": ["run", "img", "info", "tiny.png"],
        "find": ["run", "find", "needle", "."],
        "run": ["run", "echoer"],
        "add": ["add", "saved-now", "--", "printf saved"],
        "check": ["check"],
        "search": ["search", "json"],
    }
    monkeypatch.setenv("AI_AGENT", "1")

    exit_code = cli.main(argv_by_verb[verb])

    captured = capsys.readouterr()
    assert captured.err == ""
    assert captured.out.count("\n") == 1
    parsed = agent_result(captured.out)
    assert isinstance(parsed, dict)
    assert parsed["exit"] == exit_code


def test_list_prints_each_seed_recipe_name_once(capsys):
    exit_code, result = invoke(capsys, "list")

    assert exit_code == 0
    assert result["ok"] is True
    assert result["exit"] == 0
    names = [entry.split()[0] for entry in result["out"]]
    for name in (
        "codex",
        "codex-review",
        "find",
        "gemini",
        "img",
        "json",
        "json-set",
        "local",
        "page",
        "replace",
        "repo",
        "screenshot",
        "up",
    ):
        assert names.count(name) == 1
    assert len(names) == 13


def test_recipe_saved_with_add_appears_with_source_saved(capsys):
    add_exit, _ = invoke(capsys, "add", "custom-tool", "--", "printf custom")
    assert add_exit == 0

    list_exit, result = invoke(capsys, "list")

    assert list_exit == 0
    assert result["ok"] is True
    assert result["exit"] == 0
    matches = [entry for entry in result["out"] if entry.split()[0] == "custom-tool"]
    assert len(matches) == 1
    assert "(saved)" in matches[0]


def test_exec_echo_hi_with_ai_agent_prints_exact_keys(monkeypatch, capsys):
    monkeypatch.setenv("AI_AGENT", "1")

    exit_code = cli.main(["exec", "--", "echo hi"])

    captured = capsys.readouterr()
    assert captured.err == ""
    assert exit_code == 0
    parsed = agent_result(captured.out)
    assert set(parsed.keys()) == {"ok", "exit", "out"}
