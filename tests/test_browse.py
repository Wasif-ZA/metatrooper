import json
import os
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from callrouter import cli
from callrouter.browse import daemon
from callrouter.browse.page import Page, host_blocked


CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path, monkeypatch):
    home = tmp_path / "callrouter-home"
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.setenv("CALLROUTER_HOME", str(home))
    for name in (
        "AI_AGENT",
        "CLAUDECODE",
        "CALLROUTER_OUTPUT",
        "CLAUDE_CODE_SESSION_ID",
        "CALLROUTER_CHROME",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(work)


def invoke(capsys, *args):
    exit_code = cli.main(["--json", *(str(arg) for arg in args)])
    captured = capsys.readouterr()
    assert captured.err == ""
    return exit_code, json.loads(captured.out)


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://blocked.example/path", True),
        ("https://deep.sub.blocked.example/path", True),
        ("https://BLOCKED.EXAMPLE/path", True),
        ("https://notblocked.example/path", False),
        ("https://blocked.example.evil.test/path", False),
        ("https://evilblocked.example/path", False),
    ],
)
def test_host_blocked_matches_hosts_and_subdomains_but_not_lookalikes(url, expected):
    assert host_blocked(url, ["blocked.example"]) is expected


def test_browse_refuses_blocked_host_before_starting_chrome(
    monkeypatch, capsys
):
    home = Path(os.environ["CALLROUTER_HOME"])
    home.mkdir(parents=True)
    (home / "blocked-hosts.txt").write_text("blocked.example\n", encoding="utf-8")

    def chrome_must_not_start(_show=False):
        raise AssertionError("Chrome was started for a blocked host")

    monkeypatch.setattr(daemon, "ensure", chrome_must_not_start)

    exit_code, result = invoke(
        capsys, "browse", "open", "https://sub.blocked.example/secret"
    )

    assert exit_code == 2
    assert result["ok"] is False
    assert "blocked-hosts list" in result["note"]


class FakeChrome:
    def __init__(self, nodes):
        self.nodes = nodes

    def send(self, method, params=None, session=None, timeout=30):
        if method == "Target.createTarget":
            return {"targetId": "target-1"}
        if method == "Target.attachToTarget":
            return {"sessionId": "session-1"}
        if method.endswith(".enable"):
            return {}
        if method == "Accessibility.getFullAXTree":
            return {"nodes": self.nodes}
        if method == "Runtime.evaluate":
            expression = (params or {}).get("expression")
            values = {
                "location.href": "https://synthetic.example/page",
                "document.title": "Synthetic title",
            }
            return {"result": {"value": values[expression]}}
        raise AssertionError(f"unexpected CDP method {method}")


def ax_node(role, name, backend=None, ignored=False):
    node = {
        "role": {"value": role},
        "name": {"value": name},
        "ignored": ignored,
    }
    if backend is not None:
        node["backendDOMNodeId"] = backend
    return node


def test_page_numbers_interactive_elements_from_synthetic_ax_tree():
    chrome = FakeChrome(
        [
            ax_node("heading", "Synthetic heading"),
            ax_node("button", "Save changes", 101),
            ax_node("link", "Documentation", 102),
            ax_node("textbox", "Ignored field", 103, ignored=True),
            ax_node("paragraph", "ordinary text", 104),
        ]
    )
    page = Page(chrome)

    snapshot = page.snapshot()

    assert snapshot == {
        "url": "https://synthetic.example/page",
        "title": "Synthetic title",
        "headings": ["Synthetic heading"],
        "elements": ["@1 button Save changes", "@2 link Documentation"],
    }
    assert page.refs == {"@1": 101, "@2": 102}


def make_page_with_snapshots(before, after):
    page = Page.__new__(Page)
    page.last = before
    page.snapshot = lambda: after
    return page


def test_changed_ignores_reference_renumbering_when_elements_are_the_same():
    before = {
        "url": "https://synthetic.example/page",
        "title": "Same",
        "headings": ["Heading"],
        "elements": ["@1 button Save", "@2 link Docs"],
    }
    after = {
        "url": "https://synthetic.example/page",
        "title": "Same",
        "headings": ["Heading"],
        "elements": ["@1 link Docs", "@2 button Save"],
    }

    changed = make_page_with_snapshots(before, after).changed()

    assert changed == {
        "navigated": False,
        "url": "https://synthetic.example/page",
        "added": [],
        "removed": [],
        "note": "nothing on the page changed",
    }


def test_changed_reports_title_elements_and_new_headings():
    before = {
        "url": "https://synthetic.example/page",
        "title": "Before",
        "headings": ["Existing"],
        "elements": ["@1 button Remove me", "@2 link Keep me"],
    }
    after = {
        "url": "https://synthetic.example/page",
        "title": "After",
        "headings": ["Existing", "New section"],
        "elements": ["@1 link Keep me", "@2 button Added action"],
    }

    changed = make_page_with_snapshots(before, after).changed()

    assert changed == {
        "navigated": False,
        "url": "https://synthetic.example/page",
        "title": "After",
        "added": ["@2 button Added action"],
        "removed": ["button Remove me"],
        "new_headings": ["New section"],
    }


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *args):
        pass


@pytest.mark.skipif(not CHROME.exists(), reason="exact Chrome path is not installed")
def test_local_page_open_click_diff_read_and_close(tmp_path, capsys):
    site = tmp_path / "site"
    site.mkdir()
    (site / "index.html").write_text(
        """<!doctype html>
<html><head><title>Before click</title></head>
<body>
  <h1>Synthetic page</h1>
  <button onclick="document.title='After click';
    document.getElementById('status').textContent='changed locally';
    const a=document.createElement('a');a.href='#done';a.textContent='Done link';
    document.body.appendChild(a)">Change page</button>
  <p id="status">before</p>
</body></html>
""",
        encoding="utf-8",
    )
    handler = partial(QuietHandler, directory=str(site))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_address[1]}/index.html"

    try:
        open_exit, opened = invoke(capsys, "browse", "open", url)
        click_exit, diff = invoke(capsys, "browse", "click", "@1")
        read_exit, read = invoke(capsys, "browse", "read")

        assert open_exit == click_exit == read_exit == 0
        assert opened["out"]["title"] == "Before click"
        assert "@1 button Change page" in opened["out"]["elements"]
        assert diff["out"]["navigated"] is False
        assert diff["out"]["title"] == "After click"
        assert any("link Done link" in item for item in diff["out"]["added"])
        assert "changed locally" in read["out"]["text"]
    finally:
        try:
            close_exit, closed = invoke(capsys, "browse", "close")
            assert close_exit == 0
            assert closed["out"]["closed"] is True
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
