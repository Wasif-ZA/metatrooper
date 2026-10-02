import json
import re

import pytest

from toolrouter import cli, mcp, registry
from toolrouter import recipes as store
from toolrouter.result import human_out


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("TOOLROUTER_HOME", str(tmp_path / "home"))
    monkeypatch.delenv("TOOLROUTER_MODE", raising=False)


def test_catalogue_only_loads_in_auto_mode():
    assert "git-status" not in store.load()
    assert mcp.catalog() == {}
    store.set_mode("auto")
    assert store.load()["git-status"]["source"] == "catalog"
    assert "filesystem" in mcp.catalog()
    assert store.load()["find"]["source"] == "seed"


def test_bad_mode_is_refused():
    with pytest.raises(ValueError):
        store.set_mode("everything")


def test_catalogue_entries_are_well_formed():
    recipes = json.loads(store.CATALOG.read_text(encoding="utf-8"))
    names = [r["name"] for r in recipes]
    assert len(names) == len(set(names))
    for r in recipes:
        assert store.NAME.match(r["name"]) and r["purity"] in store.PURITY and r["needs"]
        assert "{0}" not in r["body"] and "&gt;" not in r["body"]
    for s in json.loads(mcp.CATALOG.read_text(encoding="utf-8")):
        assert s["command"] and isinstance(s["args"], list)
        assert all(re.match(r"^[A-Z][A-Z0-9_]*$", e) for e in s["env"])


def test_registry_launch_npm_pypi_and_oci():
    npm = {"packages": [{"registryType": "npm", "identifier": "pkg", "version": "1.2.0",
                         "transport": {"type": "stdio"},
                         "environmentVariables": [{"name": "KEY", "isRequired": True}, {"name": "OPT"}]}]}
    assert registry.launch(npm) == {"command": "npx", "args": ["-y", "pkg@1.2.0"], "env": ["KEY"]}
    pypi = {"packages": [{"registryType": "pypi", "identifier": "srv", "version": "0.1",
                          "transport": {"type": "stdio"}, "packageArguments": [{"type": "positional", "value": "serve"}]}]}
    assert registry.launch(pypi)["args"] == ["srv==0.1", "serve"]
    oci = {"packages": [{"registryType": "oci", "identifier": "ghcr.io/x:1", "transport": {"type": "stdio"},
                         "runtimeArguments": [{"type": "named", "name": "-e", "value": "A=1"},
                                              {"type": "named", "name": "-e", "value": "TOKEN={token}"}]}]}
    assert registry.launch(oci) == {"command": "docker", "args": ["run", "-i", "--rm", "-e", "A=1", "ghcr.io/x:1"],
                                    "env": []}
    assert registry.launch({"packages": [{"registryType": "npm", "identifier": "r",
                                          "transport": {"type": "streamable-http"}}]}) is None


def test_catalogue_server_missing_key_names_the_variable(monkeypatch):
    store.set_mode("auto")
    monkeypatch.delenv("BRAVE_API_KEY", raising=False)
    with pytest.raises(KeyError, match="BRAVE_API_KEY"):
        mcp.open_session("brave-search")


def test_learn_mode_hides_catalogue_servers():
    with pytest.raises(KeyError, match="mcp search"):
        mcp.open_session("filesystem")


def test_human_out_lists_and_empties():
    assert human_out(["a", "b"]) == "  a\n  b"
    assert human_out({"cli": ["x"]}) == "  cli:\n    x"
    assert human_out([]) == "[]" and human_out({}) == "{}"


def fake_transcripts(root, commands, times=6):
    root.mkdir()
    lines = []
    for i, cmd in enumerate(commands * times):
        lines.append(json.dumps({"message": {"content": [{"type": "tool_use", "id": f"t{i}", "name": "Bash",
                                                          "input": {"command": cmd}}]}}))
        lines.append(json.dumps({"message": {"content": [{"type": "tool_result", "tool_use_id": f"t{i}",
                                                          "content": "ok"}]}}))
    (root / "s.jsonl").write_text("\n".join(lines), encoding="utf-8")


def test_learn_adds_bypassed_commands_only_in_auto_mode(tmp_path):
    from toolrouter import learn
    root = tmp_path / "transcripts"
    fake_transcripts(root, ["docker compose up -d web", "rclone sync acu-reports remote:"])
    assert learn.learn(root)["added"] == []
    store.set_mode("auto")
    out = learn.learn(root)
    assert out["added"] == ["docker-compose-up"]
    assert store.load()["docker-compose-up"]["source"] == "learned"
    assert out["recipe_candidates"] == 1


def test_mode_verb(capsys):
    assert cli.main(["--json", "mode", "auto"]) == 0
    assert '"auto:' in capsys.readouterr().out
    assert store.mode() == "auto"
