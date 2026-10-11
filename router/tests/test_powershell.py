import json
import shutil

import pytest

from metarouter import cli

REAL_WHICH = shutil.which
HAS_POWERSHELL = bool(REAL_WHICH("pwsh") or REAL_WHICH("powershell"))


@pytest.fixture(autouse=True)
def no_bash(tmp_path, monkeypatch):
    monkeypatch.setenv("METAROUTER_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("METAROUTER_OUTPUT", "json")
    monkeypatch.delenv("METAROUTER_SHELL", raising=False)
    monkeypatch.setattr(cli.shutil, "which", lambda name: None if name in ("bash", "sh") else REAL_WHICH(name))
    monkeypatch.setattr(cli, "GIT_BASH", tmp_path / "no-bash.exe")


def run(argv, capsys):
    code = cli.main(argv)
    return code, json.loads(capsys.readouterr().out.strip().splitlines()[-1])


@pytest.mark.skipif(not HAS_POWERSHELL, reason="no PowerShell on this machine")
def test_exec_falls_back_to_powershell_when_bash_is_hidden(capsys):
    assert cli.is_powershell(cli.shell())
    assert cli.main(["exec", "--", "echo hi"]) == 0
    assert capsys.readouterr().out.strip() == "hi"


def test_bash_recipe_on_powershell_machine_gives_a_clear_note(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(cli, "shell", lambda force=None: "powershell.exe")
    folder = tmp_path / "home" / "recipes"
    folder.mkdir(parents=True)
    recipe = {"name": "hot", "kind": "shell", "shell": "bash", "body": "f(){ echo $1; }; f", "purity": "read"}
    (folder / "hot.json").write_text(json.dumps(recipe), encoding="utf-8")
    code, res = run(["run", "hot"], capsys)
    assert code != 0
    assert "bash syntax" in res["note"]


def test_config_and_flag_pick_powershell(tmp_path, monkeypatch):
    monkeypatch.setattr(cli.shutil, "which", lambda name: f"/bin/{name}")
    assert not cli.is_powershell(cli.shell())
    assert cli.is_powershell(cli.shell("powershell"))
    (tmp_path / "home").mkdir()
    (tmp_path / "home" / "config.json").write_text('{"shell": "powershell"}', encoding="utf-8")
    assert cli.is_powershell(cli.shell())


def test_exec_rejects_unknown_shell(capsys):
    code, res = run(["exec", "--shell", "fish", "--", "echo hi"], capsys)
    assert code == 2
    assert "bash or powershell" in res["note"]
