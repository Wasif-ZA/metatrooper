import json

import pytest

from metarouter import cli
from metarouter import recipes as store
from metarouter.result import render
from test_fixups2 import checker_body, isolated_environment, write_recipe


def test_no_trunc_dict_summary_returns_raw_output(tmp_path, monkeypatch):
    raw = b'first raw line\nsecond raw line\n'
    recipe = {"name": "dict-summary", "kind": "python", "body": "fixture", "args": []}
    monkeypatch.setattr(store, "load", lambda: {"dict-summary": recipe})
    monkeypatch.setattr(cli, "run_python", lambda *_: (0, {"count": 2}, raw, 0.0, False))

    short = cli.run_lane(["dict-summary"])
    assert short.out == {"count": 2}
    result = cli.run_lane(["dict-summary", "--no-trunc"])
    assert result.ok is True
    assert result.out == "first raw line\nsecond raw line\n"
    assert result.whole is False
    assert result.log
    assert json.loads(render(result, "json", False))["log"] == result.log


@pytest.mark.parametrize("operator", [";", "&&", "||", "|", "\n"])
@pytest.mark.parametrize("spacing", [" ", "  ", "\t"])
def test_compound_commands_never_inherit_finding_exemption(tmp_path, monkeypatch, operator, spacing):
    body = checker_body(tmp_path)
    folder = tmp_path / "metarouter-home" / "recipes"
    write_recipe(folder, "checker", body)
    monkeypatch.setattr(cli, "run_shell", lambda *_: (1, b'synthetic finding\n', 0.0))
    result = cli.exec_lane(["--", body + spacing + operator + spacing + "echo extra"])
    assert result.ok is False
    assert not result.rec.get("findings")


def test_explicitly_trusted_repo_recipe_retains_finding_exemption(tmp_path):
    (tmp_path / ".git").mkdir()
    body = checker_body(tmp_path)
    write_recipe(tmp_path / ".metarouter" / "recipes", "repo-check", body, source="project")
    recipe = store.load()["repo-check"]
    assert store.needs_trust(recipe) is True
    refused = cli.run_lane(["repo-check"])
    assert refused.exit == 2
    approved = cli.run_lane(["repo-check", "--yes"])
    assert approved.ok is True
    assert approved.exit == 1
    assert approved.rec["findings"] is True
    assert store.needs_trust(store.load()["repo-check"]) is False
    result = cli.exec_lane(["--", body])
    assert result.ok is True
    assert result.exit == 1
    assert result.rec["findings"] is True
