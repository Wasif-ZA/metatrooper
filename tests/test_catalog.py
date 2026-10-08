from conftest import agent_result
import json
import re

import pytest

from metarouter import calls, cli, log, mcp, registry
from metarouter import recipes as store
from metarouter.result import human_out


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("METAROUTER_HOME", str(tmp_path / "home"))
    monkeypatch.delenv("METAROUTER_MODE", raising=False)
    monkeypatch.setenv("METAROUTER_MCP_KEEP", "0")


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
    from metarouter import learn
    root = tmp_path / "transcripts"
    fake_transcripts(root, ["git --version", "rclone sync private-reports remote:",
                            "Get-CimInstance Win32_Process", "node build.js 2>&1",
                            "node /x/codex-companion.mjs task --write fix"])
    assert learn.learn(root)["added"] == []
    store.set_mode("auto")
    out = learn.learn(root)
    assert out["added"] == ["git-version"]
    assert calls.shape("npm run check 2>&1 | tail -5") == "npm run check 2>&1 | tail -N"
    assert store.load()["git-version"]["source"] == "learned"
    assert out["recipe_candidates"] == 1


def test_learned_names_say_what_the_command_does():
    from metarouter import learn
    assert learn.name_of("curl -s --max-time {1} {2} | head -c {3}") == "curl-max-time-head"
    assert learn.name_of("npm --prefix website run build 2>&1 | tail -{1}") == "npm-website-run-build"


def test_successful_long_output_keeps_head_and_tail_not_error_words():
    from metarouter import shrink
    lines = [f"line {i} test_failed_case passed" for i in range(200)]
    out = shrink.shrink("\n".join(lines), failed=False)
    assert out["errors"] == [] and out["out"].startswith("line 0 ")
    assert "line 199 " in out["out"] and "more like these" in out["out"]
    assert shrink.shrink("\n".join(lines), failed=True)["out"] is None


def test_json_reads_into_json_text_and_paths_without_a_dot(tmp_path, capsys):
    f = tmp_path / "r.json"
    f.write_text(json.dumps({"result": json.dumps({"usage": {"n": 7}})}), encoding="utf-8")
    assert cli.main(["--json", "run", "json", str(f), "result.usage.n"]) == 0
    assert agent_result(capsys.readouterr().out)["out"] == "7"


def test_whole_recipe_output_is_not_shrunk(tmp_path, monkeypatch, capsys):
    store.set_mode("auto")
    monkeypatch.chdir(tmp_path)
    (tmp_path / "big.txt").write_text("\n".join(f"row {i} failed" for i in range(300)), encoding="utf-8")
    assert cli.main(["--json", "run", "lines", "big.txt", "1", "300"]) == 0
    out = agent_result(capsys.readouterr().out)
    assert "errors" not in out and "row 299 failed" in out["out"]


def test_mode_verb(capsys):
    assert cli.main(["--json", "mode", "auto"]) == 0
    assert '"auto:' in capsys.readouterr().out
    assert store.mode() == "auto"


def test_hints_gh_search_recipe_and_json_field():
    from metarouter import hints
    assert hints.match("gh search repos mcp --limit 5") == "Shorter: metarouter run gh-search-repos <query> (auto mode)"
    assert (
        hints.match("x", 'Unknown JSON field: "licenseInfo"', failed=True)
        == "gh lists the valid --json fields in this error, under 'Available fields'. Pick from that list"
    )


def test_page_github_readme(monkeypatch):
    import subprocess
    import types
    import urllib.error
    from metarouter.recipes import web

    calls = []

    def fake_run(*args, **kwargs):
        calls.append((args, kwargs))
        return subprocess.CompletedProcess(args=args[0] if args else [], returncode=0, stdout=b"# Title\nreadme body")

    monkeypatch.setattr("metarouter.recipes.web.subprocess.run", fake_run)
    res = web.page(types.SimpleNamespace(url="github.com/a/b"))
    assert res["exit"] == 0
    assert "readme body" in res["out"]
    assert len(calls) == 1

    calls.clear()

    def fake_urlopen(*args, **kwargs):
        raise urllib.error.URLError("offline")

    monkeypatch.setattr("metarouter.recipes.web.urllib.request.urlopen", fake_urlopen)
    res_issues = web.page(types.SimpleNamespace(url="github.com/a/b/issues/3"))
    assert res_issues["exit"] == 1
    assert len(calls) == 0


def test_replace_undoes_edit_that_breaks_python(tmp_path):
    from metarouter.recipes import replace

    path = tmp_path / "example.py"
    original = "value = 1\n"
    path.write_text(original, encoding="utf-8")

    result = replace.run([str(path), "1", "("])

    assert result["exit"] == 1
    assert "undone" in result["out"]
    assert path.read_text(encoding="utf-8") == original


def test_replace_allows_valid_python_edit(tmp_path):
    from metarouter.recipes import replace

    path = tmp_path / "example.py"
    path.write_text("value = 1\n", encoding="utf-8")

    result = replace.run([str(path), "1", "2"])

    assert result["exit"] == 0
    assert path.read_text(encoding="utf-8") == "value = 2\n"


def test_replace_does_not_block_already_invalid_json(tmp_path):
    from metarouter.recipes import replace

    path = tmp_path / "example.json"
    path.write_text('{"value": }\n', encoding="utf-8")

    result = replace.run([str(path), "value", "renamed"])

    assert result["exit"] == 0
    assert path.read_text(encoding="utf-8") == '{"renamed": }\n'


def test_replace_does_not_parse_text_files(tmp_path):
    from metarouter.recipes import replace

    path = tmp_path / "example.txt"
    path.write_text("value = 1\n", encoding="utf-8")

    result = replace.run([str(path), "1", "("])

    assert result["exit"] == 0
    assert path.read_text(encoding="utf-8") == "value = (\n"


def test_exec_want_finds_matching_chunk(monkeypatch, capsys):
    lines = [f"row {i} ok" for i in range(1, 1001)]
    for i in range(20, 1001, 20):
        lines[i - 1] = ""
    lines[899] = "error: connection refused"
    raw = ("\n".join(lines) + "\n").encode()
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (0, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--want", "connection refused", "--", "x"])

    assert exit_code == 0
    result = agent_result(capsys.readouterr().out)
    assert "connection refused" in result["out"]
    assert "lines " in result["out"]


def test_exec_want_no_match_returns_message(monkeypatch, capsys):
    lines = [f"row {i} ok" for i in range(1, 1001)]
    for i in range(20, 1001, 20):
        lines[i - 1] = ""
    raw = ("\n".join(lines) + "\n").encode()
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (0, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--want", "something absent", "--", "x"])

    assert exit_code == 0
    result = agent_result(capsys.readouterr().out)
    assert result["out"] == "no part of the output matched: something absent (1000 lines; full output in the log)"


def test_shrink_want_unit_test():
    from metarouter import shrink

    text = "section:\nline 1\nline 2\n\nother:\nline 3\nline 4\n"
    res = shrink.want(text, "line 1")
    assert res is not None
    assert "lines 1-3:" in res
    assert "line 1" in res
    assert "lines 5-7:" in res
    assert shrink.want(text, "nothing matches this") is None


def test_exec_no_trunc_wins_over_want(monkeypatch, capsys):
    lines = [f"row {i} ok" for i in range(1, 50)]
    raw = ("\n".join(lines) + "\n").encode()
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (0, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--no-trunc", "--want", "row 10", "--", "x"])

    assert exit_code == 0
    result = agent_result(capsys.readouterr().out)
    assert "lines " not in result["out"]
    assert result["out"].rstrip("\n") == "\n".join(lines)


def test_exec_want_failed_command_fills_errors_and_tail(monkeypatch, capsys):
    lines = ["error: syntax error"] + [f"row {i} ok" for i in range(1, 300)]
    raw = ("\n".join(lines) + "\n").encode()
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (1, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--want", "syntax", "--", "x"])

    assert exit_code == 1
    result = agent_result(capsys.readouterr().out)
    assert "lines 1-40:" in result["out"]
    assert "error: syntax error" in result["out"]
    assert len(result["tail"]) > 0


def test_filtered_exec_shows_filtered_text_and_note(monkeypatch, capsys):
    raw = b"Requirement already satisfied: pkg\n" * 70 + (
        b"Collecting requests\n"
        b"  Downloading requests-2.31.0-py3-none-any.whl (62 kB)\n"
        b"WARNING: Target directory already exists\n"
        b"Successfully installed requests-2.31.0\n"
    )
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (0, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--", "pip install requests"])

    assert exit_code == 0
    result = agent_result(capsys.readouterr().out)
    assert result["out"] == "WARNING: Target directory already exists\nSuccessfully installed requests-2.31.0"
    assert result["note"] == "filtered by pip-install; full output in the log"


def test_failing_command_with_matching_filter_is_not_filtered(monkeypatch, capsys):
    lines = ["error: Command failed"] + [f"row {i} ok" for i in range(1, 300)]
    raw = ("\n".join(lines) + "\n").encode()
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (1, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--", "pip install broken"])

    assert exit_code == 1
    result = agent_result(capsys.readouterr().out)
    assert "filtered by" not in (result.get("note") or "")
    assert len(result.get("errors", [])) > 0
    assert len(result.get("tail", [])) > 0


def test_unmatched_command_is_unchanged(monkeypatch, capsys):
    raw = b"unmatched tool output\nhello world\n"
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (0, raw, 0.0))

    exit_code = cli.main(["--json", "exec", "--", "echo hello world"])

    assert exit_code == 0
    result = agent_result(capsys.readouterr().out)
    assert result["out"].rstrip("\n") == "unmatched tool output\nhello world"
    assert "filtered by" not in (result.get("note") or "")


def test_check_reports_every_filter_test_as_pass():
    from metarouter import filters

    all_filters = filters.load()
    assert len(all_filters) == 7

    res = cli.check([])
    assert res.ok is True
    assert res.exit == 0

    for flt in all_filters:
        name = flt["name"]
        tests = flt.get("tests", [])
        assert len(tests) >= 2
        assert f"pass  filter:{name}" in res.out

    assert "FAIL  filter:" not in res.out


def test_filtered_shell_recipe_shows_filtered_text_and_note(monkeypatch, capsys):
    store.set_mode("auto")
    raw = b"tests/test_cli.py ....                                                   [ 50%]\n" * 40 + (
        b"tests/test_cli.py ....                                                   [ 80%]\n"
        b"tests/test_cli.py .                                                      [100%]\n"
        b"============================== warnings summary ===============================\n"
        b"tests/test_cli.py:10: UserWarning: deprecated setting\n"
        b"  warnings.warn(\"deprecated setting\")\n"
        b"=========================== 5 passed, 1 warning in 0.10s ===========================\n"
    )
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (0, raw, 0.0))

    exit_code = cli.main(["--json", "run", "pytest-quick"])

    assert exit_code == 0
    result = agent_result(capsys.readouterr().out)
    assert "warnings summary" in result["out"]
    assert "5 passed" in result["out"]
    assert result["note"] == "filtered by pytest; full output in the log"


def test_tldr_page_cache_examples_and_summary(monkeypatch):
    import io
    import urllib.error
    from metarouter import log, tldr

    fake_page = (
        "# git\n"
        "> Distributed version control system.\n"
        "- Show the commit history:\n"
        "`git log`\n"
        "- Clone a repository:\n"
        "`git clone {{url}}`\n"
    )

    urlopen_calls = 0

    def fake_urlopen(req, timeout=10):
        nonlocal urlopen_calls
        urlopen_calls += 1
        url = req.full_url if hasattr(req, "full_url") else str(req)
        if "common/git.md" in url:
            return io.BytesIO(fake_page.encode("utf-8"))
        raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)

    monkeypatch.setattr("metarouter.tldr.urllib.request.urlopen", fake_urlopen)

    text = tldr.page("git")
    assert text is not None
    assert "Source: tldr-pages (https://github.com/tldr-pages/tldr), CC-BY 4.0" in text
    cache_path = log.home() / "tldr" / "git.md"
    assert cache_path.is_file()
    assert "Source: tldr-pages (https://github.com/tldr-pages/tldr), CC-BY 4.0" in cache_path.read_text(encoding="utf-8")
    assert cache_path.read_text(encoding="utf-8") == text
    assert urlopen_calls == 1

    calls_before = urlopen_calls
    text2 = tldr.page("git")
    assert text2 == text
    assert urlopen_calls == calls_before

    assert tldr.page("nope") is None
    assert not (log.home() / "tldr" / "nope.md").exists()

    calls_before = urlopen_calls
    assert tldr.page("../x") is None
    assert urlopen_calls == calls_before

    sample = (
        "- Show commit history:\n"
        "`git log`\n"
        "- Check out file:\n"
        "`git checkout {{path/to/file}}`\n"
    )
    exs = tldr.examples(sample)
    assert len(exs) == 2
    assert exs[0] == ("Show commit history", "git log")
    assert exs[1] == ("Check out file", "git checkout {}")

    assert tldr.summary_for("git log -n {1}") == "Show the commit history"


def test_tools_lane_uses_tldr_page_in_auto_mode(monkeypatch):
    import shutil
    from metarouter import tldr
    store.set_mode("auto")
    monkeypatch.setattr(shutil, "which", lambda name: f"/bin/{name}" if name == "git" else None)
    monkeypatch.setattr(tldr, "page", lambda name: "# git tldr page" if name == "git" else None)
    res = cli.tools_lane(["git"])
    assert res.ok is True
    assert res.lane == "tools"
    assert res.out == "# git tldr page"


def test_learn_auto_save_with_tldr_summary(tmp_path, monkeypatch):
    from metarouter import learn, tldr
    store.set_mode("auto")
    root = tmp_path / "transcripts"
    fake_transcripts(root, ["git --version"])
    monkeypatch.setattr(tldr, "summary_for", lambda body: "Show git version" if "git" in body else None)
    res = learn.learn(root)
    assert "git-version" in res["added"]
    assert store.load()["git-version"]["summary"] == "Show git version"


def make_fake_mcp_server(tmp_path):
    import sys
    script = tmp_path / "fake_mcp.py"
    script.write_text(
        "import os, sys, json\n"
        "while True:\n"
        "    line = sys.stdin.readline()\n"
        "    if not line:\n"
        "        break\n"
        "    line = line.strip()\n"
        "    if not line:\n"
        "        continue\n"
        "    try:\n"
        "        msg = json.loads(line)\n"
        "    except Exception:\n"
        "        continue\n"
        "    mid = msg.get('id')\n"
        "    method = msg.get('method')\n"
        "    if mid is None:\n"
        "        continue\n"
        "    if method == 'initialize':\n"
        "        res = {'protocolVersion': '2025-06-18', 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'fake', 'version': '0.1'}}\n"
        "    elif method == 'tools/list':\n"
        "        res = {'tools': [{'name': 'echo', 'description': 'Echo the input back. More text.', 'inputSchema': {'type': 'object', 'properties': {'text': {'type': 'string'}, 'n': {'type': 'integer'}}}}]}\n"
        "    elif method == 'tools/call':\n"
        "        args = msg.get('params', {}).get('arguments', {})\n"
        "        if args.get('pid'):\n"
        "            args['pid'] = os.getpid()\n"
        "        res = {'content': [{'type': 'text', 'text': json.dumps(args)}]}\n"
        "    else:\n"
        "        res = {}\n"
        "    sys.stdout.write(json.dumps({'jsonrpc': '2.0', 'id': mid, 'result': res}) + '\\n')\n"
        "    sys.stdout.flush()\n",
        encoding="utf-8"
    )
    home_dir = tmp_path / "home"
    home_dir.mkdir(parents=True, exist_ok=True)
    servers_file = home_dir / "servers.json"
    servers_data = {
        "mcpServers": {
            "fake": {
                "command": sys.executable,
                "args": [str(script)]
            }
        }
    }
    servers_file.write_text(json.dumps(servers_data), encoding="utf-8")
    return script


def test_mcp_fake_list_and_search_tool(tmp_path):
    make_fake_mcp_server(tmp_path)
    res = cli.mcp_lane(["fake"])
    assert res.ok is True
    assert any("echo" in line for line in res.out)

    cache = mcp.cached_tools()
    assert "fake" in cache
    assert cache["fake"]["tools"][0]["name"] == "echo"

    store.set_mode("auto")
    search_res = cli.search_lane(["echo"])
    assert search_res.ok is True
    assert "metarouter mcp fake echo" in search_res.out


def test_mcp_fake_call_args(tmp_path):
    make_fake_mcp_server(tmp_path)
    res = cli.mcp_lane(["fake", "echo", 'text="a b"', "n=3", "flag=true"])
    assert res.ok is True
    assert res.exit == 0
    assert res.out == {"text": "a b", "n": 3, "flag": True}

    res_bare = cli.mcp_lane(["fake", "echo", "baretoken"])
    assert res_bare.ok is False
    assert res_bare.exit == 2
    assert res_bare.note == "arguments are key=value or one JSON object"

    res_json = cli.mcp_lane(["fake", "echo", json.dumps({"text": "hello", "n": 1})])
    assert res_json.ok is True
    assert res_json.out == {"text": "hello", "n": 1}


def test_mcp_import(tmp_path, monkeypatch):
    from pathlib import Path
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))

    claude_data = {
        "mcpServers": {
            "claude-stdio": {
                "command": "node",
                "args": ["server.js"],
                "env": {"TOKEN": "secret"}
            },
            "claude-remote": {
                "url": "https://example.com/mcp"
            }
        }
    }
    (tmp_path / ".claude.json").write_text(json.dumps(claude_data), encoding="utf-8")

    codex_dir = tmp_path / ".codex"
    codex_dir.mkdir(parents=True, exist_ok=True)
    codex_toml = (
        "[mcp_servers.codex-stdio]\n"
        "command = \"python\"\n"
        "args = [\"-m\", \"codex_server\"]\n"
    )
    (codex_dir / "config.toml").write_text(codex_toml, encoding="utf-8")

    res = cli.mcp_lane(["import"])
    assert res.ok is True
    assert len(res.out["added"]) == 2
    assert "claude-stdio" in res.out["added"]
    assert "codex-stdio" in res.out["added"]
    assert any("claude-remote" in s for s in res.out["skipped"])

    servers_file = mcp.home() / "servers.json"
    assert servers_file.is_file()
    content = servers_file.read_text(encoding="utf-8")
    assert "TOKEN" in content
    assert "secret" not in content

    res2 = cli.mcp_lane(["import"])
    assert res2.ok is True
    assert len(res2.out["added"]) == 0
    assert any("claude-stdio" in s and "already present" in s for s in res2.out["skipped"])
    assert any("codex-stdio" in s and "already present" in s for s in res2.out["skipped"])

    monkeypatch.delenv("TOKEN", raising=False)
    with pytest.raises(KeyError, match="TOKEN"):
        mcp.open_session("claude-stdio")


def test_recipe_choices(capsys):
    store.set_mode("auto")
    rdir = log.home() / "recipes"
    rdir.mkdir(parents=True, exist_ok=True)
    pick_json = {
        "name": "pick",
        "summary": "x",
        "args": ["arg1"],
        "kind": "shell",
        "body": "echo {1}",
        "purity": "read",
        "source": "saved",
        "choices": {"1": "printf 'a\\nb\\n'"}
    }
    (rdir / "pick.json").write_text(json.dumps(pick_json), encoding="utf-8")

    assert cli.main(["--json", "run", "pick"]) == 2
    res_pick = agent_result(capsys.readouterr().out)
    assert res_pick["out"] == {"choices for {1}": ["a", "b"]}

    pickfail_json = {
        "name": "pickfail",
        "summary": "x",
        "args": ["arg1"],
        "kind": "shell",
        "body": "exit 3 # {1}",
        "purity": "read",
        "source": "saved",
        "choices": {"1": "printf 'a\\nb\\n'"}
    }
    (rdir / "pickfail.json").write_text(json.dumps(pickfail_json), encoding="utf-8")

    assert cli.main(["--json", "run", "pickfail", "zzz"]) == 3
    res_fail = agent_result(capsys.readouterr().out)
    assert "valid values for {1}: a, b" in res_fail["note"]

    assert cli.main(["--json", "run", "pick", "argval"]) == 0
    res_ok = agent_result(capsys.readouterr().out)
    assert res_ok["ok"] is True
    assert "argval" in res_ok["out"]


def test_catalogue_recipes_have_choices():
    cat = json.loads(store.CATALOG.read_text(encoding="utf-8"))
    by_name = {r["name"]: r for r in cat}
    assert by_name["gh-pr"]["choices"] == {
        "1": 'gh pr list --limit 20 --json number,title --jq \'.[] | "\\(.number)  \\(.title)"\''
    }
    assert by_name["git-show"]["choices"] == {
        "1": "git log -n 10 --format='%h  %s'"
    }


def test_recipe_choices_command_fails_or_empty(capsys):
    store.set_mode("auto")
    rdir = log.home() / "recipes"
    rdir.mkdir(parents=True, exist_ok=True)
    pick_empty = {
        "name": "pickempty",
        "summary": "x",
        "args": ["arg1"],
        "kind": "shell",
        "body": "echo {1}",
        "purity": "read",
        "source": "saved",
        "choices": {"1": "printf ''"}
    }
    (rdir / "pickempty.json").write_text(json.dumps(pick_empty), encoding="utf-8")
    assert cli.main(["--json", "run", "pickempty"]) == 2
    res = agent_result(capsys.readouterr().out)
    assert res.get("out") is None
    assert "this recipe needs 1 arguments" in res.get("note", "")

    pick_failcmd = {
        "name": "pickfailcmd",
        "summary": "x",
        "args": ["arg1"],
        "kind": "shell",
        "body": "echo {1}",
        "purity": "read",
        "source": "saved",
        "choices": {"1": "exit 1"}
    }
    (rdir / "pickfailcmd.json").write_text(json.dumps(pick_failcmd), encoding="utf-8")
    assert cli.main(["--json", "run", "pickfailcmd"]) == 2
    res = agent_result(capsys.readouterr().out)
    assert res.get("out") is None
    assert "this recipe needs 1 arguments" in res.get("note", "")


def test_learn_check_gated_auto_save(tmp_path):
    from metarouter import learn
    log.home().mkdir(parents=True, exist_ok=True)
    (log.home() / "config.json").write_text(json.dumps({"mode": "auto", "private": ["private"]}), encoding="utf-8")
    root = tmp_path / "transcripts"
    fake_transcripts(root, [
        "git --version",
        "git -C . status --short",
        "rm -rf build",
        'git log --grep "private"',
    ])
    res = learn.learn(root)
    assert "git-version" in res["added"]
    assert "git-status-short" not in res["added"]
    assert "rm-rf-build" not in res["added"]
    assert "git-log-grep" not in res["added"]
    assert res["queued_unsafe"] == 1
    recipes = store.load()
    assert "git-version" in recipes
    assert recipes["git-version"]["purity"] == "read"
    assert recipes["git-version"]["example"] == {"args": [], "expect_exit": 0, "expect_out": ""}
    assert "git-status-short" not in recipes
    assert "rm-rf-build" not in recipes
    assert "git-log-grep" not in recipes


def test_learn_flow_candidates(tmp_path):
    from metarouter import learn
    root = tmp_path / "transcripts"
    log.home().mkdir(parents=True, exist_ok=True)
    (log.home() / "config.json").write_text(json.dumps({"engines": {"gemini": "/x/gemini-run.sh"}}), encoding="utf-8")
    fake_transcripts(root, ["git status --short", "git diff --stat", "bash /x/gemini-run.sh"])
    res = learn.learn(root)
    assert res["flow_candidates"] == 1
    candidates = json.loads((log.home() / "candidates" / "candidates.json").read_text(encoding="utf-8"))
    flows = [c for c in candidates if c["type"] == "flow"]
    assert len(flows) == 1
    assert flows[0]["steps"] == ["git status --short", "git diff --stat"]
    assert flows[0]["uses"] == 6


def test_mcp_http_transport(tmp_path):
    import http.server
    import threading

    received_requests = []

    class McpHttpHandler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8")
            data = json.loads(body) if body else {}
            session_id = self.headers.get("Mcp-Session-Id")
            received_requests.append({
                "method": data.get("method"),
                "session_id": session_id,
                "id": data.get("id"),
            })
            method = data.get("method")
            if method == "initialize":
                resp_data = {
                    "jsonrpc": "2.0",
                    "id": data.get("id"),
                    "result": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "test-http", "version": "0.1"}
                    }
                }
                raw = json.dumps(resp_data).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Mcp-Session-Id", "sess-12345")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            elif method == "notifications/initialized":
                self.send_response(202)
                self.send_header("Content-Length", "0")
                self.end_headers()
            elif method == "tools/list":
                resp_data = {
                    "jsonrpc": "2.0",
                    "id": data.get("id"),
                    "result": {
                        "tools": [
                            {"name": "fetch_doc", "description": "Fetches documentation",
                             "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}}}
                        ]
                    }
                }
                raw = json.dumps(resp_data).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            elif method == "tools/call":
                resp_data = {
                    "jsonrpc": "2.0",
                    "id": data.get("id"),
                    "result": {
                        "content": [{"type": "text", "text": "tool call success"}]
                    }
                }
                sse = f"event: message\ndata: {json.dumps(resp_data)}\n\n".encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(sse)))
                self.end_headers()
                self.wfile.write(sse)

        def do_DELETE(self):
            session_id = self.headers.get("Mcp-Session-Id")
            received_requests.append({
                "method": "DELETE",
                "session_id": session_id,
            })
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()

    httpd = http.server.HTTPServer(("127.0.0.1", 0), McpHttpHandler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    try:
        home_dir = tmp_path / "home"
        home_dir.mkdir(parents=True, exist_ok=True)
        servers_file = home_dir / "servers.json"
        servers_data = {
            "mcpServers": {
                "remote_http": {
                    "url": f"http://127.0.0.1:{port}/mcp"
                }
            }
        }
        servers_file.write_text(json.dumps(servers_data), encoding="utf-8")

        tools = mcp.list_tools("remote_http")
        assert len(tools) == 1
        assert tools[0]["name"] == "fetch_doc"

        call_res = mcp.call_tool("remote_http", "fetch_doc", {"id": "1"})
        assert call_res["content"][0]["text"] == "tool call success"

        inits = [r for r in received_requests if r.get("method") == "initialize"]
        assert len(inits) >= 1
        assert all(r["session_id"] is None for r in inits)

        after_inits = [r for r in received_requests if r.get("method") != "initialize"]
        assert len(after_inits) > 0
        assert all(r["session_id"] == "sess-12345" for r in after_inits)
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_registry_launch_remotes_streamable_http():
    server = {
        "name": "remote-pkg",
        "remotes": [
            {
                "type": "streamable-http",
                "url": "https://api.example.com/mcp",
                "headers": [
                    {"name": "Authorization", "value": "Bearer {token}", "isRequired": True,
                     "variables": {"token": {"isSecret": True}}},
                    {"name": "X-Static", "value": "static-value"},
                    {"name": "X-Opt", "value": "optional {optional_var}",
                     "variables": {"optional_var": {}}}
                ]
            }
        ]
    }
    spec = registry.launch(server)
    assert spec == {
        "url": "https://api.example.com/mcp",
        "headers": {
            "Authorization": "Bearer ${token}",
            "X-Static": "static-value"
        },
        "env": ["token"]
    }

    server_both = {
        "name": "both-pkg",
        "packages": [
            {"registryType": "npm", "identifier": "pkg", "version": "1.0",
             "transport": {"type": "stdio"}}
        ],
        "remotes": [
            {"type": "streamable-http", "url": "https://api.example.com/mcp"}
        ]
    }
    spec_both = registry.launch(server_both)
    assert spec_both["command"] == "npx"
    assert "url" not in spec_both


def test_mcp_daemon_keep_alive(tmp_path, monkeypatch):
    make_fake_mcp_server(tmp_path)
    monkeypatch.setenv("METAROUTER_MCP_KEEP", "1")
    try:
        res1 = mcp.call_tool("fake", "echo", {"pid": True})
        res2 = mcp.call_tool("fake", "echo", {"pid": True})
        pid1 = json.loads(res1["content"][0]["text"])["pid"]
        pid2 = json.loads(res2["content"][0]["text"])["pid"]
        assert pid1 == pid2

        stop_res = cli.mcp_lane(["stop"])
        assert stop_res.ok is True
        assert stop_res.out == "stopped"

        stop_res2 = cli.mcp_lane(["stop"])
        assert stop_res2.ok is True
        assert stop_res2.out == "not running"
    finally:
        cli.mcp_lane(["stop"])

