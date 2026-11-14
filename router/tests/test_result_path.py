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


def test_exec_masks_a_token_in_the_output_and_the_log(capsys):
    code, r = invoke(capsys, "exec", "--", f"printf '{TOKEN}\\n\\377'")
    assert code == 0
    assert TOKEN not in json.dumps(r)
    assert "ghp_****" in r["out"]
    assert "masked 1 secret" in r["note"]
    log = max((Path(os.environ["METAROUTER_HOME"]) / "logs").rglob("*.log"), key=os.path.getmtime)
    assert log.read_bytes() == b"ghp_****\n\xff"


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


def test_log_lane_output_is_masked(tmp_path, monkeypatch, capsys):
    import json as _json
    from metarouter import cli
    monkeypatch.setenv("METAROUTER_HOME", str(tmp_path / "home"))
    tok = "ghp_" + "a" * 36
    cli.main(["--json", "exec", "--", f"echo {tok}"])
    capsys.readouterr()
    cli.main(["--json", "log", "--grep", "ghp_"])
    out = capsys.readouterr().out
    assert tok not in out and "ghp_****" in out


def test_call_row_shape_masks_an_unquoted_token(capsys, isolated):
    invoke(capsys, "exec", "--", f"echo {TOKEN}")
    row = (isolated / "calls.jsonl").read_text(encoding="utf-8")
    assert TOKEN not in row
    assert "ghp_****" in row


def test_every_string_field_of_a_call_row_is_masked(isolated):
    from metarouter import calls
    calls.append({"project": f"/work/{TOKEN}", "agent": "password=hunter22", "exit": 0})
    row = (isolated / "calls.jsonl").read_text(encoding="utf-8")
    assert TOKEN not in row and "hunter22" not in row


@pytest.mark.parametrize("text", ['{"password": "hunter22"}', '{"api_key":"hunter22"}', "{'token': 'hunter22'}",
                                  '"db_password" = "hunter22"'])
def test_quoted_credential_values_are_masked_in_output_and_log(text, tmp_path, capsys, isolated):
    src = tmp_path / "creds.json"
    src.write_text(text, encoding="utf-8")
    code, r = invoke(capsys, "exec", "--", f"cat {src.as_posix()}")
    assert code == 0 and "hunter22" not in json.dumps(r)
    log = max((isolated / "logs").rglob("*.log"), key=os.path.getmtime)
    assert b"hunter22" not in log.read_bytes() and b"hunt****" in log.read_bytes()
