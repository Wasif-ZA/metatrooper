import json
import shutil

import pytest

from conftest import agent_result
from metarouter import cli


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("METAROUTER_HOME", str(tmp_path / "home"))
    for name in ("AI_AGENT", "CLAUDECODE", "METAROUTER_OUTPUT", "CLAUDE_CODE_SESSION_ID", "METAROUTER_SHELL",
                 "METAROUTER_MODE"):
        monkeypatch.delenv(name, raising=False)
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.chdir(work)
    monkeypatch.setattr(cli.tempfile, "tempdir", str(tmp_path))


def invoke(capsys, *args):
    code = cli.main(["--json", *map(str, args)])
    return code, agent_result(capsys.readouterr().out)


def repo(tmp_path, name):
    root = tmp_path / name
    (root / ".git").mkdir(parents=True)
    (root / "sub" / "deeper").mkdir(parents=True)
    return root


def test_project_recipe_found_from_subfolder_and_not_from_other_repo(tmp_path, monkeypatch, capsys):
    a, b = repo(tmp_path, "a"), repo(tmp_path, "b")
    monkeypatch.chdir(a / "sub")
    code, _ = invoke(capsys, "add", "--project", "say-hi", "--", "echo hi-from-a")
    assert code == 0
    assert (a / ".metarouter" / "recipes" / "say-hi.json").is_file()
    assert not (tmp_path / "home" / "recipes" / "say-hi.json").exists()

    monkeypatch.chdir(a / "sub" / "deeper")
    code, res = invoke(capsys, "list")
    assert any("say-hi" in ln and "(project)" in ln for ln in res["out"])
    code, res = invoke(capsys, "run", "say-hi")
    assert code == 0 and "hi-from-a" in res["out"]

    monkeypatch.chdir(b / "sub")
    code, res = invoke(capsys, "run", "say-hi")
    assert code == 2 and 'no recipe "say-hi"' in res["note"]


def test_add_project_outside_repo_refuses(capsys):
    code, res = invoke(capsys, "add", "--project", "x", "--", "echo x")
    assert code == 2 and "git repo" in res["note"]


def write_project_recipe(root, name, body, purity):
    folder = root / ".metarouter" / "recipes"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{name}.json").write_text(json.dumps(
        {"name": name, "kind": "shell", "body": body, "purity": purity, "args": []}), encoding="utf-8")


def test_external_project_recipe_asks_for_yes_once(tmp_path, monkeypatch, capsys):
    a = repo(tmp_path, "a")
    write_project_recipe(a, "fetch", "echo fetched", "external")
    monkeypatch.chdir(a)

    code, res = invoke(capsys, "run", "fetch")
    assert code == 2 and "--yes" in res["note"]
    code, res = invoke(capsys, "run", "fetch", "--yes")
    assert code == 0 and "fetched" in res["out"]
    code, res = invoke(capsys, "run", "fetch")
    assert code == 0 and "fetched" in res["out"]

    write_project_recipe(a, "fetch", "echo changed", "external")
    code, res = invoke(capsys, "run", "fetch")
    assert code == 2 and "--yes" in res["note"]


def test_check_project_runs_only_project_recipes_and_fails(tmp_path, monkeypatch, capsys):
    a = repo(tmp_path, "a")
    folder = a / ".metarouter" / "recipes"
    folder.mkdir(parents=True)
    for name, out in (("good", "yes"), ("bad", "nope")):
        (folder / f"{name}.json").write_text(json.dumps(
            {"name": name, "kind": "shell", "body": "echo yes", "purity": "read", "args": [],
             "example": {"setup": {}, "args": [], "expect_exit": 0, "expect_out": out}}), encoding="utf-8")
    monkeypatch.chdir(a)
    code, res = invoke(capsys, "check", "--project")
    lines = res["out"].splitlines()
    assert code == 1
    assert "pass  good" in lines and any(ln.startswith("FAIL  bad") for ln in lines)
    assert not any("replace" in ln or "filter:" in ln for ln in lines)


@pytest.mark.skipif(not shutil.which("git"), reason="git not installed")
def test_check_example_can_ask_for_a_git_repo(tmp_path, capsys):
    folder = tmp_path / "home" / "recipes"
    folder.mkdir(parents=True)
    (folder / "branch.json").write_text(json.dumps(
        {"name": "branch", "kind": "shell", "body": "git rev-parse --abbrev-ref HEAD", "purity": "read", "args": [],
         "example": {"setup": {}, "args": [], "expect_exit": 0, "expect_out": "main", "repo": True}}),
        encoding="utf-8")
    code, res = invoke(capsys, "check")
    assert "pass  branch" in res["out"].splitlines()


def test_cloned_repo_recipe_needs_yes_even_when_labelled_read(tmp_path, monkeypatch, capsys):
    a = repo(tmp_path, "a")
    write_project_recipe(a, "looks-safe", "echo ran-it", "read")
    monkeypatch.chdir(a)
    code, res = invoke(capsys, "run", "looks-safe")
    assert code == 2 and "--yes" in res["note"]
    code, res = invoke(capsys, "run", "looks-safe", "--yes")
    assert code == 0 and "ran-it" in res["out"]
    code, res = invoke(capsys, "run", "looks-safe")
    assert code == 0


def test_repo_recipe_cannot_shadow_a_seed_or_be_python(tmp_path, monkeypatch, capsys):
    a = repo(tmp_path, "a")
    write_project_recipe(a, "find", "echo shadowed", "read")
    d = a / ".metarouter" / "recipes"
    (d / "sneaky.json").write_text('{"name": "sneaky", "kind": "python", "body": "os", "purity": "read"}')
    monkeypatch.chdir(a)
    from metarouter import recipes as store
    loaded = store.load()
    assert loaded["find"]["source"] == "seed"
    assert "sneaky" not in loaded
