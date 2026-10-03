import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
from types import SimpleNamespace
import urllib.error
import urllib.request

import pytest

import metarouter.browse.cdp as cdp
from metarouter.browse import daemon
import metarouter.browse.page as page_mod
from metarouter.browse.page import host_blocked
import metarouter.calls
from metarouter import calls, cli, ingest, jobs, log, snapshot
import metarouter.log
from metarouter.recipes import find, web
import metarouter.snapshot
from metarouter.result import Result, render


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


def test_page_host_blocked_schemeless_urls():
    blocked = ["blocked.example"]
    assert host_blocked("blocked.example/x", blocked) is True
    assert host_blocked("sub.blocked.example", blocked) is True
    assert host_blocked("allowed.example/x", blocked) is False


def test_log_write_same_second_different_microseconds(monkeypatch):
    times = [
        datetime.datetime(2026, 1, 1, 12, 0, 0, 100000),
        datetime.datetime(2026, 1, 1, 12, 0, 0, 200000),
    ]

    class MockDatetime(datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            return times.pop(0)

    monkeypatch.setattr(metarouter.log.datetime, "datetime", MockDatetime)

    p1 = log.write("audit", b"first")
    p2 = log.write("audit", b"second")

    assert p1 != p2
    assert p1.is_file() and p2.is_file()
    assert p1.read_bytes() == b"first"
    assert p2.read_bytes() == b"second"
    assert len(p1.stem.split("-")[0]) == 12
    assert len(p2.stem.split("-")[0]) == 12


def test_find_line_length_whole_flag(tmp_path):
    root = tmp_path / "find_root"
    root.mkdir()

    d198 = root / "d198"
    d198.mkdir()
    (d198 / "match.txt").write_text("needle " + ("x" * 191) + "\n", encoding="utf-8")

    d200 = root / "d200"
    d200.mkdir()
    (d200 / "match.txt").write_text("needle " + ("x" * 193) + "\n", encoding="utf-8")

    d201 = root / "d201"
    d201.mkdir()
    (d201 / "match.txt").write_text("needle " + ("x" * 194) + "\n", encoding="utf-8")

    res198 = find.run(["needle", str(d198)])
    assert res198["whole"] is True

    res200 = find.run(["needle", str(d200)])
    assert res200["whole"] is True

    res201 = find.run(["needle", str(d201)])
    assert res201["whole"] is False


def test_web_repo_null_pushed_at(monkeypatch):
    monkeypatch.setattr(shutil, "which", lambda _name: "/bin/gh")
    gh_payload = {
        "full_name": "owner/repo",
        "stargazers_count": 10,
        "license": None,
        "pushed_at": None,
        "archived": False,
        "fork": False,
        "open_issues_count": 0,
        "description": "demo",
    }
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **k: SimpleNamespace(
            returncode=0,
            stdout=json.dumps(gh_payload).encode("utf-8"),
            stderr=b"",
        ),
    )

    res = web.repo(SimpleNamespace(url="owner/repo"))
    assert res["exit"] == 0
    assert res["out"]["pushed"] == ""


def test_snapshot_take_twice_same_second(monkeypatch, tmp_path):
    target = tmp_path / "snap_target.txt"
    target.write_bytes(b"initial")

    times = [
        datetime.datetime(2026, 1, 1, 12, 0, 0, 100000),
        datetime.datetime(2026, 1, 1, 12, 0, 0, 200000),
    ]

    class MockDatetime(datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            return times.pop(0)

    monkeypatch.setattr(metarouter.snapshot.datetime, "datetime", MockDatetime)

    target.write_bytes(b"version 1")
    sid1 = snapshot.take([target])

    target.write_bytes(b"version 2")
    sid2 = snapshot.take([target])

    assert sid1 != sid2

    target.write_bytes(b"corrupted")
    snapshot.restore(sid1)
    assert target.read_bytes() == b"version 1"

    snapshot.restore(sid2)
    assert target.read_bytes() == b"version 2"


def test_refuse_blocked_redirect_raises_urlerror():
    home = Path(os.environ["METAROUTER_HOME"])
    home.mkdir(parents=True, exist_ok=True)
    (home / "blocked-hosts.txt").write_text("blocked.example\n", encoding="utf-8")

    handler = web.RefuseBlocked()
    req = urllib.request.Request("http://original.example/page")
    with pytest.raises(urllib.error.URLError, match="blocked-hosts list"):
        handler.redirect_request(req, None, 302, "Found", {}, "http://blocked.example/target")


def test_browse_daemon_type_rechecks_blocked_guard(monkeypatch):
    home = Path(os.environ["METAROUTER_HOME"])
    home.mkdir(parents=True, exist_ok=True)
    (home / "blocked-hosts.txt").write_text("blocked.example\n", encoding="utf-8")

    class FakeChrome:
        def __init__(self, profile, show=False):
            pass

        def close(self):
            pass

    class FakePage:
        def __init__(self, chrome):
            self._url = "http://allowed.example"

        def type(self, ref, text):
            self._url = "http://blocked.example/target"

        def url(self):
            return self._url

        def navigate(self, url):
            self._url = url

        def changed(self):
            return {"changed": True}

    monkeypatch.setattr(cdp, "Chrome", FakeChrome)
    monkeypatch.setattr(page_mod, "Page", FakePage)

    server_thread = threading.Thread(target=daemon.serve, kwargs={"show": False}, daemon=True)
    server_thread.start()

    deadline = time.monotonic() + 5
    while not daemon.state_path().is_file():
        if time.monotonic() > deadline:
            raise TimeoutError("daemon did not write browser.json in time")
        time.sleep(0.01)

    try:
        reply = daemon.call("type", ["@1", "submitting-text"])
        assert reply["ok"] is False
        assert "PermissionError" in reply.get("error", "")
        assert "blocked.example" in reply.get("error", "")
    finally:
        try:
            daemon.call("close", [])
        except Exception:
            pass
        server_thread.join(timeout=2)


def test_jobs_start_id_ends_in_12_hex_chars(monkeypatch):
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: SimpleNamespace(pid=12345))

    jid = jobs.start(["list"], "test-job")
    suffix = jid.split("-")[-1]
    assert len(suffix) == 12
    assert re.fullmatch(r"[0-9a-f]{12}", suffix) is not None


def test_run_lane_call_log_shape_does_not_contain_argument_content():
    notes = Path("notes.txt")
    notes.write_text("participant Alice\n", encoding="utf-8")

    exit_code = cli.main(["--json", "run", "replace", "notes.txt", "participant Alice", "redacted"])

    assert exit_code == 0
    calls_file = Path(os.environ["METAROUTER_HOME"]) / "calls.jsonl"
    assert calls_file.is_file()
    lines = [json.loads(line) for line in calls_file.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(lines) == 1
    assert "Alice" not in lines[0]["shape"]


def test_calls_append_does_not_unlink_replaced_lock(monkeypatch):
    orig_close = metarouter.calls.os.close

    def fake_close(fd):
        orig_close(fd)
        lock_file = metarouter.calls.home() / "calls.jsonl.lock"
        lock_file.write_bytes(b"another-token")

    monkeypatch.setattr(metarouter.calls.os, "close", fake_close)
    calls.append({"lane": "test", "time": "2026-09-30T00:00:00"})

    lock_file = metarouter.calls.home() / "calls.jsonl.lock"
    assert lock_file.is_file()
    assert lock_file.read_bytes() == b"another-token"


def test_check_escaped_setup_key_and_destructive_recipe():
    home = Path(os.environ["METAROUTER_HOME"])
    recipes_dir = home / "recipes"
    recipes_dir.mkdir(parents=True, exist_ok=True)

    evil_recipe = {
        "name": "evil",
        "summary": "evil recipe",
        "kind": "shell",
        "purity": "read",
        "body": "echo ok",
        "example": {
            "setup": {"../outside.txt": "escaped data"},
            "args": [],
            "expect_exit": 0,
            "expect_out": "ok",
        },
    }
    (recipes_dir / "evil.json").write_text(json.dumps(evil_recipe), encoding="utf-8")

    destructive_recipe = {
        "name": "destroy",
        "summary": "destructive recipe",
        "kind": "shell",
        "purity": "destructive",
        "body": "echo destroyed",
        "example": {
            "setup": {"safe.txt": "data"},
            "args": [],
            "expect_exit": 0,
            "expect_out": "destroyed",
        },
    }
    (recipes_dir / "destroy.json").write_text(json.dumps(destructive_recipe), encoding="utf-8")

    res = cli.check([])

    assert res.ok is False
    assert res.exit == 1
    assert "FAIL  evil:" in res.out
    assert "outside the example folder" in res.out
    assert "skip  destroy: destructive, not run by check" in res.out
    assert not Path("outside.txt").exists()
    assert not (home.parent / "outside.txt").exists()


def test_ingest_json_output_keys(tmp_path, capsys):
    empty_root = tmp_path / "empty_transcripts"
    empty_root.mkdir()

    ingest.main(["ingest", "--root", str(empty_root), "--no-save"], how="json")

    captured = capsys.readouterr()
    assert captured.err == ""
    assert captured.out.count("\n") == 1
    data = json.loads(captured.out)
    assert data["ok"] is True
    assert data["exit"] == 0
    assert isinstance(data["out"], dict)
    assert "lane" not in data
    assert set(data.keys()) == {"ok", "exit", "out", "shell_read_tokens", "saved_tokens"}


def test_learn_review_in_json_mode_returns_exit_2(monkeypatch, capsys):
    monkeypatch.delenv("AI_AGENT", raising=False)
    monkeypatch.delenv("CLAUDECODE", raising=False)
    monkeypatch.delenv("CLAUDE_CODE_SESSION_ID", raising=False)

    exit_code = cli.main(["--json", "learn", "--review"])

    captured = capsys.readouterr()
    assert exit_code == 2
    assert captured.err == ""
    assert captured.out.count("\n") == 1
    data = json.loads(captured.out)
    assert data["ok"] is False
    assert data["exit"] == 2
    assert "learn --review is for a person" in data.get("note", "")


def test_malformed_servers_json_prints_json_without_traceback(capsys):
    home = Path(os.environ["METAROUTER_HOME"])
    home.mkdir(parents=True, exist_ok=True)
    (home / "servers.json").write_text("{not valid json", encoding="utf-8")

    cli.main(["--json", "mcp", "x", "y"])

    captured = capsys.readouterr()
    assert captured.err == ""
    assert captured.out.count("\n") == 1
    assert "Traceback" not in captured.out
    assert "Traceback" not in captured.err
    data = json.loads(captured.out)
    assert data["ok"] is False


def test_crashing_lane_prints_json_without_traceback(monkeypatch, capsys):
    def crash(_args):
        raise RuntimeError("simulated lane crash")

    monkeypatch.setitem(cli.LANES, "list", crash)

    exit_code = cli.main(["--json", "list"])

    captured = capsys.readouterr()
    assert captured.err == ""
    assert captured.out.count("\n") == 1
    assert "Traceback" not in captured.out
    assert "Traceback" not in captured.err
    data = json.loads(captured.out)
    assert data["ok"] is False
    assert data["exit"] == 1
    assert "simulated lane crash" in data.get("note", "")


def test_run_python_empty_full_returns_empty_raw_bytes(monkeypatch):
    fake_mod = SimpleNamespace(
        run=lambda _args: {"exit": 1, "out": {"matches": 0}, "full": ""}
    )
    monkeypatch.setattr(cli.store, "module", lambda _r: fake_mod)

    code, text, raw, secs, whole = cli.run_python({"name": "synthetic", "body": "fake"}, [])

    assert code == 1
    assert text == {"matches": 0}
    assert raw == b""
    assert raw != b'{"matches": 0}'


def test_replace_negative_count_exits_2_and_leaves_file_unchanged(capsys):
    target = Path("sample.txt")
    original = "hello world\n"
    target.write_text(original, encoding="utf-8")

    exit_code = cli.main(["--json", "run", "replace", str(target), "hello", "hi", "--count", "-1"])

    captured = capsys.readouterr()
    data = json.loads(captured.out)
    assert exit_code == 2
    assert data["exit"] == 2
    assert target.read_text(encoding="utf-8") == original
    assert "--count must be 0 (all) or more" in data.get("out", "")


def test_json_set_numeric_index_on_dict_exits_1_and_leaves_file_unchanged(capsys):
    target = Path("data.json")
    original = '{"obj": {}}\n'
    target.write_text(original, encoding="utf-8")

    exit_code = cli.main(["--json", "run", "json-set", str(target), ".obj[0]", "val"])

    captured = capsys.readouterr()
    data = json.loads(captured.out)
    assert exit_code == 1
    assert data["exit"] == 1
    assert target.read_text(encoding="utf-8") == original
    assert "needs a list, found an object" in data.get("out", "")


def test_human_render_of_empty_dict_and_list():
    res_dict = Result(ok=True, lane="run", out={})
    rendered_dict = render(res_dict, "human")
    assert "{}" in rendered_dict.splitlines()

    res_list = Result(ok=True, lane="run", out=[])
    rendered_list = render(res_list, "human")
    assert "[]" in rendered_list.splitlines()


def test_zero_placeholder_is_refused(capsys):
    exit_code = cli.main(["--json", "add", "bad", "--", "printf %s {0}"])

    captured = capsys.readouterr()
    data = json.loads(captured.out)
    assert exit_code == 2
    assert data["ok"] is False
    assert "{1}" in data.get("note", "")

    with pytest.raises(ValueError, match=r"\{1\}"):
        cli.fill("x {0}", ["a"])
