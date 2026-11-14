import json
from pathlib import Path

import pytest

from conftest import agent_result
from metarouter import cli, log, setup


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    fake_home = tmp_path / "user"
    fake_home.mkdir()
    work = tmp_path / "work"
    (work / ".git").mkdir(parents=True)
    monkeypatch.setenv("METAROUTER_HOME", str(tmp_path / "mr-home"))
    monkeypatch.setattr(Path, "home", lambda: fake_home)
    monkeypatch.setattr(setup.shutil, "which", lambda name: None)
    for name in ("CLAUDECODE", "AI_AGENT", "CLAUDE_CODE_SESSION_ID", "METAROUTER_OUTPUT"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(work)
    return fake_home


def invoke(capsys, *args):
    code = cli.main(["--json", *(str(a) for a in args)])
    return code, agent_result(capsys.readouterr().out)


def configure(**values):
    p = log.home() / "config.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(values), encoding="utf-8")


def test_init_twice_gives_one_block_and_undo_restores_bytes(capsys, isolated):
    f = isolated / ".claude" / "CLAUDE.md"
    f.parent.mkdir()
    before = b"# mine\r\nno trailing newline"
    f.write_bytes(before)
    assert invoke(capsys, "init", "claude")[0] == 0
    assert invoke(capsys, "init", "claude")[0] == 0
    assert f.read_bytes().count(setup.START.encode()) == 1
    assert f.read_bytes().startswith(before)
    assert invoke(capsys, "init", "--undo", "claude")[0] == 0
    assert f.read_bytes() == before


def test_init_project_creates_file_and_uninstall_deletes_it(capsys, isolated):
    assert invoke(capsys, "init", "cursor")[0] == 0
    f = Path.cwd() / ".cursor" / "rules" / "metarouter.mdc"
    assert setup.END in f.read_text(encoding="utf-8")
    code, r = invoke(capsys, "uninstall")
    assert code == 0 and not f.exists()
    assert "To delete them" in r["note"]
    assert log.home().exists()


def test_init_project_flag_uses_repo_file(capsys, isolated):
    invoke(capsys, "init", "codex", "--project")
    assert (Path.cwd() / "AGENTS.md").is_file()
    assert not (isolated / ".codex" / "AGENTS.md").exists()


def test_init_without_agent_lists_detected_and_writes_nothing(capsys, isolated):
    (isolated / ".gemini").mkdir()
    code, r = invoke(capsys, "init")
    assert code == 0
    assert r["out"] == ["gemini: metarouter init gemini"]
    assert not list(isolated.rglob("*.md")) and not (log.home() / "installed.json").exists()


def test_doctor_on_empty_home_names_the_fixes(capsys):
    code, r = invoke(capsys, "doctor")
    assert code == 0
    assert "no private patterns" in r["out"]
    assert "no agent set up: run metarouter init" in r["out"]


def test_doctor_sees_init_block(capsys):
    configure(private=["x"])
    invoke(capsys, "init", "claude", "--project")
    _, r = invoke(capsys, "doctor")
    assert "init block in: claude" in r["out"]
    assert "1 private patterns" in r["out"]


def test_doctor_counts_hand_written_instructions(capsys, isolated):
    configure(private=["x"])
    (isolated / ".claude").mkdir()
    (isolated / ".claude" / "CLAUDE.md").write_text('Run commands with `metarouter exec -- "<cmd>"`.\n')
    _, r = invoke(capsys, "doctor")
    assert "instructions mention metarouter: claude" in r["out"]
    assert "no agent set up" not in r["out"]


def test_undo_skips_a_tampered_path_that_is_not_an_instruction_file(capsys, isolated, tmp_path):
    victim = tmp_path / "notes.txt"
    victim.write_text("")
    setup.save_installed([{"agent": "claude", "path": victim.as_posix(), "created": True}])
    _, r = invoke(capsys, "uninstall")
    assert victim.exists()
