from conftest import agent_result
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from metarouter import cli, hints, shrink
from metarouter.recipes import web
from metarouter.result import render


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


def test_agent_log_is_named_only_when_output_is_not_whole(tmp_path):
    whole_raw = b"complete output\n"
    shrunk_raw = ("ordinary line\n" * 900).encode()

    whole = cli.finish("exec", "whole", whole_raw, 0, 0)
    shrunk = cli.finish("exec", "shrunk", shrunk_raw, 0, 0)

    whole_rendered = render(whole, "json")
    try:
        whole_json = json.loads(whole_rendered)
    except json.JSONDecodeError:
        whole_json = agent_result(whole_rendered)
    shrunk_json = json.loads(render(shrunk, "json"))
    logs = list((tmp_path / "metarouter-home").rglob("*.log"))
    assert whole_rendered == "complete output"
    assert whole_json["out"] == whole_raw.decode().rstrip("\n")
    assert "log" in shrunk_json
    assert Path(shrunk_json["log"]).read_bytes() == shrunk_raw
    assert len(logs) == 2
    assert {path.read_bytes() for path in logs} == {whole_raw, shrunk_raw}


def test_clean_strips_ansi_and_keeps_last_carriage_return_redraw():
    raw = "\x1b[31mstarting\x1b[0m\r25%\r\x1b[32m100%\x1b[0m\r\nnext\x1b]0;title\x07"

    assert shrink.clean(raw) == "100%\nnext"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("3000", "http://127.0.0.1:3000/"),
        ("localhost:3000", "http://localhost:3000"),
        ("example.com", "https://example.com"),
    ],
)
def test_url_of_normalizes_ports_localhost_and_bare_domains(value, expected):
    assert web.url_of(value) == expected


def test_page_refuses_localhost_without_opening_it(monkeypatch):
    def unexpected_request(*args, **kwargs):
        pytest.fail("page attempted a request to localhost")

    monkeypatch.setattr(web.urllib.request, "urlopen", unexpected_request)

    result = web.page(SimpleNamespace(url="localhost:3000"))

    assert result["exit"] == 2
    assert "r.jina.ai cannot reach http://localhost:3000" in result["out"]


def test_page_drops_jina_warning_metadata_lines(monkeypatch):
    raw = (
        "Warning: target returned 403\n"
        "Published Time: 2026-09-28\n"
        "Markdown Content:\n"
        "# Useful title\n\n\nBody\n"
    ).encode()
    seen = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            pass

        def read(self):
            return raw

    def fake_urlopen(request, timeout):
        seen["url"] = request.full_url
        seen["format"] = request.headers["X-return-format"]
        seen["timeout"] = timeout
        return Response()

    monkeypatch.setattr(web.urllib.request, "urlopen", fake_urlopen)

    result = web.page(SimpleNamespace(url="example.com"))

    assert result == {
        "exit": 0,
        "full": raw.decode(),
        "out": "# Useful title\n\nBody",
    }
    assert seen == {
        "url": "https://r.jina.ai/https://example.com",
        "format": "markdown",
        "timeout": 60,
    }


def test_repo_accepts_github_url_returns_compact_fields_and_logs_full_json(
    tmp_path, monkeypatch, capsys
):
    payload = {
        "full_name": "octo/widgets",
        "stargazers_count": 321,
        "license": {"spdx_id": "MIT"},
        "pushed_at": "2026-09-27T23:59:58Z",
        "archived": False,
        "fork": True,
        "open_issues_count": 7,
        "description": "Synthetic repository",
        "extra": {"must": "remain in the full log"},
    }
    raw = json.dumps(payload).encode()
    seen = {}

    class FakeSubprocess:
        @staticmethod
        def run(argv, capture_output):
            seen["argv"] = argv
            seen["capture_output"] = capture_output
            return SimpleNamespace(returncode=0, stdout=raw, stderr=b"")

    monkeypatch.setattr(web.shutil, "which", lambda name: "C:/tools/gh.exe" if name == "gh" else None)
    monkeypatch.setattr(web, "subprocess", FakeSubprocess)

    exit_code = cli.main(
        ["--json", "run", "repo", "https://github.com/octo/widgets.git"]
    )

    result = agent_result(capsys.readouterr().out)
    assert exit_code == 0
    assert result["out"] == {
        "repo": "octo/widgets",
        "stars": 321,
        "license": "MIT",
        "pushed": "2026-09-27",
        "archived": False,
        "fork": True,
        "open_issues": 7,
        "about": "Synthetic repository",
    }
    assert seen == {
        "argv": ["C:/tools/gh.exe", "api", "repos/octo/widgets"],
        "capture_output": True,
    }
    assert Path(result["log"]).read_bytes() == raw
    assert Path(result["log"]).is_relative_to(tmp_path / "metarouter-home")


@pytest.mark.parametrize("recipe", ["page"])
def test_web_recipes_refuse_blocked_hosts(recipe, tmp_path, monkeypatch):
    home = tmp_path / "metarouter-home"
    home.mkdir(parents=True, exist_ok=True)
    (home / "blocked-hosts.txt").write_text("example.com\n", encoding="utf-8")

    def unexpected_call(_args):
        pytest.fail(f"{recipe} ran despite a blocked host")

    monkeypatch.setattr(web, recipe, unexpected_call)

    result = web.run(["https://sub.example.com/path"], recipe)

    assert result == {
        "exit": 2,
        "out": "https://sub.example.com/path is on the blocked-hosts list",
    }


@pytest.mark.parametrize(
    ("command", "expected"),
    [
        ("curl https://r.jina.ai/https://example.com", "metarouter run page <url>"),
        ("gh api repos/octo/widgets", "metarouter run repo <owner/name>"),
    ],
)
def test_web_before_run_hints_fire(command, expected):
    assert expected in hints.match(command)


def test_missing_playwright_browser_failure_hint_fires():
    output = "Error: Executable doesn't exist at C:/cache/ms-playwright/chromium/chrome.exe"

    assert "playwright install chromium" in hints.match(
        "playwright screenshot https://example.com out.png", output, failed=True
    )


def test_blocked_matches_hosts_subdomains_and_schemeless_urls_but_not_lookalikes(tmp_path):
    home = tmp_path / "metarouter-home"
    home.mkdir(parents=True, exist_ok=True)
    (home / "blocked-hosts.txt").write_text("# comment\nblocked.example\n", encoding="utf-8")
    assert web.blocked("https://blocked.example/x")
    assert web.blocked("sub.blocked.example")
    assert not web.blocked("https://blocked.example.evil.test/x")
    assert not web.blocked("evilblocked.example")


def test_run_page_with_no_trunc_returns_the_whole_page(monkeypatch, capsys):
    body = "\n".join(f"line {i} of the page" for i in range(2000))
    monkeypatch.setattr(web, "page", lambda _a: {"exit": 0, "full": body, "out": body})

    exit_code = cli.main(["--json", "run", "page", "example.com", "--no-trunc"])

    out = agent_result(capsys.readouterr().out)
    assert exit_code == 0
    assert out["out"] == body


def test_run_saved_shell_recipe_with_no_trunc_returns_everything(monkeypatch, capsys):
    from metarouter import recipes as store
    body = "\n".join(f"row {i}" for i in range(3000))
    store.save("rows", "printf rows")
    monkeypatch.setattr(cli, "run_shell", lambda _cmd: (0, body.encode(), 0.0))

    assert cli.main(["--json", "run", "rows", "--no-trunc"]) == 0
    assert agent_result(capsys.readouterr().out)["out"] == body
