import json
import os
from pathlib import Path

import pytest

from conftest import agent_result
from metarouter import cli, shield
from metarouter import recipes as store

TOKEN = "ghp_" + "A1b2C3d4" * 5


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.setenv("METAROUTER_HOME", str(home))
    for name in ("AI_AGENT", "CLAUDECODE", "METAROUTER_OUTPUT", "CLAUDE_CODE_SESSION_ID",
                 "METAROUTER_CODEX_COMPANION", "METAROUTER_SHELL", "METAROUTER_MODE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(work)
    return home


def invoke(capsys, *args):
    code = cli.main(["--json", *(str(a) for a in args)])
    return code, agent_result(capsys.readouterr().out)


def set_config(home, **cfg):
    (home / "config.json").write_text(json.dumps(cfg), encoding="utf-8")


def test_mask_keeps_four_characters_and_counts():
    text, n = shield.mask(f"a {TOKEN} b password=hunter22 c AKIA" + "ABCDEFGHIJKLMNOP")
    assert text == "a ghp_**** b password=hunt**** c AKIA****"
    assert n == 3
    assert shield.mask("nothing secret here") == ("nothing secret here", 0)


def test_exec_masks_a_token_and_the_log_keeps_it(capsys):
    code, r = invoke(capsys, "exec", "--", f"echo {TOKEN}")
    assert code == 0
    assert TOKEN not in json.dumps(r)
    assert "ghp_****" in r["out"]
    assert "masked 1 secret" in r["note"]
    log = max((Path(os.environ["METAROUTER_HOME"]) / "logs").rglob("*.log"), key=os.path.getmtime)
    assert TOKEN in log.read_text(encoding="utf-8")


def test_shield_false_turns_masking_off(capsys, isolated):
    set_config(isolated, shield=False)
    _, r = invoke(capsys, "exec", "--", f"echo {TOKEN}")
    assert TOKEN in r["out"]


def test_export_refuses_a_recipe_holding_a_secret(capsys, tmp_path):
    store.save("leaky", f"curl -H 'Authorization: {TOKEN}' {{1}}")
    store.save("clean", "echo {1}")
    out = tmp_path / "export.json"
    code, r = invoke(capsys, "export", out)
    assert code == 2
    assert "leaky" in r["note"] and "clean" not in r["note"]
    assert not out.exists()


def write_engines(tmp_path, home, codex_js, fallback=("gemini",), *, monkeypatch):
    companion = tmp_path / "companion.mjs"
    companion.write_text(codex_js, encoding="utf-8")
    gemini = tmp_path / "gemini.sh"
    gemini.write_text("printf '%s\\n' 'synthetic gemini answer'\n", encoding="utf-8")
    set_config(home, engines={"gemini": str(gemini)}, fallback=list(fallback))
    monkeypatch.setenv("METAROUTER_CODEX_COMPANION", str(companion))


LIMITED = "console.log('usage limit reached, try later'); process.exit(1);\n"


def test_codex_usage_limit_falls_back_to_gemini(capsys, tmp_path, isolated, monkeypatch):
    write_engines(tmp_path, isolated, LIMITED, monkeypatch=monkeypatch)
    code, r = invoke(capsys, "run", "codex", "--model", "x", "synthetic task")
    assert code == 0
    assert r["out"] == "synthetic gemini answer"
    assert r["fallback"] == "gemini"
    assert r["marker"] == {"requested": "codex", "ran": "gemini", "why": "usage limit"}


def test_no_fallback_on_other_failures_or_without_config(capsys, tmp_path, isolated, monkeypatch):
    write_engines(tmp_path, isolated, "console.log('syntax error'); process.exit(1);\n", monkeypatch=monkeypatch)
    code, r = invoke(capsys, "run", "codex", "synthetic task")
    assert code == 1 and "marker" not in r
    write_engines(tmp_path, isolated, LIMITED, fallback=(), monkeypatch=monkeypatch)
    code, r = invoke(capsys, "run", "codex", "synthetic task")
    assert code == 1 and "marker" not in r


def test_codex_review_never_falls_back(capsys, tmp_path, isolated, monkeypatch):
    write_engines(tmp_path, isolated, LIMITED, monkeypatch=monkeypatch)
    code, r = invoke(capsys, "run", "codex-review")
    assert code == 1 and "marker" not in r


def write_policy(folder, **rules):
    (folder / ".metarouter").mkdir(parents=True, exist_ok=True)
    (folder / ".metarouter" / "policy.json").write_text(json.dumps(rules), encoding="utf-8")


def test_repo_policy_refuses_force_push_and_allows_push(capsys, tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    (repo / "sub").mkdir()
    write_policy(repo, refuse=[r"git push (-f|--force)"], warn=["echo"])
    monkeypatch.chdir(repo / "sub")
    code, r = invoke(capsys, "exec", "--", "git push --force")
    assert code == 3
    assert r["note"].startswith("refused by ") and "policy.json" in r["note"]
    code, r = invoke(capsys, "exec", "--", "git push")
    assert code != 3 and "refused" not in (r.get("note") or "")
    code, r = invoke(capsys, "exec", "--", "echo hi")
    assert code == 0 and "warned by" in r["note"]
    _, r = invoke(capsys, "policy")
    assert any("refuse" in ln for ln in r["out"]) and any("warn" in ln for ln in r["out"])


def test_user_policy_refuses_a_filled_shell_recipe(capsys, isolated):
    (isolated / "policy.json").write_text(json.dumps({"refuse": ["rm -rf"]}), encoding="utf-8")
    store.save("wipe", "rm -rf {1}", purity="read")
    code, r = invoke(capsys, "run", "wipe", "nothing-here")
    assert code == 3 and "refused by" in r["note"]


def test_no_policy_file_changes_nothing(capsys):
    _, r = invoke(capsys, "policy")
    assert "no rules" in r["out"]
    code, _ = invoke(capsys, "exec", "--", "echo hi")
    assert code == 0


def fake_tool(folder, name, version):
    if os.name == "nt":
        (folder / f"{name}.cmd").write_text(f"@echo {name} {version}\r\n", encoding="utf-8")
    else:
        p = folder / name
        p.write_text(f"#!/bin/sh\necho '{name} {version}'\n", encoding="utf-8")
        p.chmod(0o755)


def test_check_changed_selects_only_recipes_whose_tool_moved(capsys, tmp_path, monkeypatch, isolated):
    bins = tmp_path / "bins"
    bins.mkdir()
    fake_tool(bins, "movingtool", "1.0")
    fake_tool(bins, "steadytool", "3.0")
    monkeypatch.setenv("PATH", str(bins) + os.pathsep + os.environ["PATH"])
    ex = {"args": [], "expect_exit": 0}
    store.save("moving", "movingtool run && false", example=ex)
    store.save("steady", "steadytool run && false", example=ex)
    invoke(capsys, "check")
    versions = json.loads((isolated / "versions.json").read_text(encoding="utf-8"))
    assert versions["movingtool"] == "movingtool 1.0"
    fake_tool(bins, "movingtool", "2.0")
    code, r = invoke(capsys, "check", "--changed")
    assert code == 1
    assert "moving:" in r["out"] and "steady" not in r["out"]
    assert "movingtool 1.0 -> movingtool 2.0" in r["out"]
    code, r = invoke(capsys, "check", "--changed")
    assert code == 0 and "no recipe" in r["out"]
