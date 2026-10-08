import json
import re
import shutil
from pathlib import Path

import pytest

from conftest import agent_result
from metarouter import cli, digest, hints, packs


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


def snapshot(home):
    return {p.relative_to(home).as_posix(): p.read_bytes() for p in home.rglob("*") if p.is_file()}


def test_pack_add_then_remove_leaves_user_store_as_before(tmp_path, capsys):
    home = tmp_path / "home"
    (home / "recipes").mkdir(parents=True)
    (home / "recipes" / "wt-list.json").write_text(json.dumps(
        {"name": "wt-list", "kind": "shell", "body": "echo mine", "source": "saved"}, indent=1), encoding="utf-8")
    (home / "hints.json").write_text(json.dumps(
        [{"id": "mine", "when": "before", "match": "zzz", "hint": "my own"}], indent=1), encoding="utf-8")
    before = snapshot(home)

    code, res = invoke(capsys, "pack", "add", "git-worktrees")
    assert code == 0
    assert res["out"]["kept yours"] == ["wt-list"]
    assert (home / "recipes" / "wt-add.json").is_file()
    added = json.loads((home / "recipes" / "wt-add.json").read_text(encoding="utf-8"))
    assert added["source"] == "pack:git-worktrees"
    assert any(h.get("source") == "pack:git-worktrees" for h in hints.load())

    code, res = invoke(capsys, "pack", "list")
    assert any(ln.startswith("git-worktrees") and "(added)" in ln for ln in res["out"])

    code, _ = invoke(capsys, "pack", "remove", "git-worktrees")
    assert code == 0
    assert snapshot(home) == before


def test_pack_add_remove_on_empty_home_leaves_nothing(tmp_path, capsys):
    invoke(capsys, "pack", "add", "docker")
    invoke(capsys, "pack", "remove", "docker")
    home = tmp_path / "home"
    assert not (home / "hints.json").exists()
    assert not (home / "recipes").exists()


def test_pack_hint_fires_after_add(capsys):
    assert hints.match("cmd /c dir") is None
    invoke(capsys, "pack", "add", "windows-shell")
    assert "cmd //c" in hints.match("cmd /c dir")


def test_unknown_pack_is_refused(capsys):
    code, res = invoke(capsys, "pack", "add", "nope")
    assert code == 2 and "git-worktrees" in res["note"]


@pytest.mark.parametrize("name", ["git-worktrees", "windows-shell", "python-pytest", "node-npm", "docker"])
def test_free_pack_shape(name):
    p = packs.available()[name]
    assert p["tier"] == "free" and p["version"]
    assert 5 <= len(p["recipes"]) <= 10
    assert 3 <= len(p["hints"]) <= 8
    text = json.dumps(p)
    assert not re.search(r"[A-Za-z]:[\\/]+Users|/home/|/Users/", text)
    for r in p["recipes"]:
        assert r["example"] and r["needs"] and cli.store.NAME.match(r["name"])
        cli.fill(r["body"], r["example"]["args"])
    for h in p["hints"]:
        re.compile(h["match"])
        assert h["when"] in ("before", "fail")


def row(time, exit_code, recipe=None, shape="x"):
    return {"time": time, "project": "p", "agent": "a", "lane": "run" if recipe else "exec", "recipe": recipe,
            "shape": shape, "exit": exit_code, "secs": 0, "bytes": 1, "log": "l"}


def test_digest_top_failure_broken_recipe_and_waiting(tmp_path, capsys):
    rows = [row("2026-10-05T10:00:00+11:00", 1, shape="npm run build"),
            row("2026-10-05T10:01:00+11:00", 1, shape="npm run build"),
            row("2026-10-05T10:02:00+11:00", 1, shape="pytest -q"),
            row("2026-10-05T10:03:00+11:00", 0, recipe="deploy"),
            row("2026-10-06T10:03:00+11:00", 2, recipe="deploy"),
            row("2026-09-01T10:00:00+10:00", 1, shape="old failure"),
            row("2026-09-01T10:00:00+10:00", 1, shape="old failure"),
            row("2026-09-01T10:00:00+10:00", 1, shape="old failure")]
    home = tmp_path / "home"
    (home / "candidates").mkdir(parents=True)
    (home / "candidates" / "candidates.json").write_text(json.dumps([{"type": "recipe"}, {"type": "hint"}]),
                                                         encoding="utf-8")
    import datetime
    now = datetime.datetime.fromisoformat("2026-10-08T12:00:00+11:00")
    out = digest.build(rows, 7, now=now)
    assert out["calls"] == 5 and out["failed"] == 4
    assert out["top_failures"][0] == "npm run build  (2 times)"
    assert out["recipes_broke"] == ["deploy"]
    assert out["waiting_review"] == {"hints": 1, "recipes": 1}

    (home / "calls.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    code, res = invoke(capsys, "digest", "--days", "3650")
    assert code == 0 and "old failure" in res["out"]["top_failures"][0]
