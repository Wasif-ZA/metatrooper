import datetime
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from metarouter.log import child_env, home

IDLE_SECONDS = 30 * 60
START_TIMEOUT = 20


def state_path():
    return home() / "browser.json"


def blocked_hosts():
    path = home() / "blocked-hosts.txt"
    if not path.is_file():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    return [ln.strip().lower() for ln in lines if ln.strip() and not ln.strip().startswith("#")]


def serve(show=False):
    from metarouter.browse.cdp import Chrome
    from metarouter.browse.page import Page, host_blocked

    profile = home() / "chrome-profile"
    profile.mkdir(parents=True, exist_ok=True)
    chrome = Chrome(profile, show=show)
    page = Page(chrome)
    token = secrets.token_hex(16)
    last = [time.monotonic()]
    stop = [False]

    def guard(url):
        if host_blocked(url, blocked_hosts()):
            page.navigate("about:blank")
            raise PermissionError(f"{url} is on the blocked-hosts list; the page was closed")

    def act(verb, args):
        if verb == "open":
            guard(args[0])
            page.navigate(args[0])
            guard(page.url())
            return page.look()
        if verb in ("look", "read", "shot", "type"):
            guard(page.url())
        if verb == "look":
            return page.look()
        if verb == "click":
            page.click(args[0])
            guard(page.url())
            return page.changed()
        if verb == "type":
            page.type(args[0], args[1])
            guard(page.url())
            return page.changed()
        if verb == "read":
            return {"url": page.url(), "text": page.read()}
        if verb == "shot":
            png = page.shot(full=bool(args and args[0] == "--full"))
            folder = home() / "logs" / datetime.date.today().isoformat()
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / f"{datetime.datetime.now():%H%M%S%f}-shot.png"
            path.write_bytes(png)
            return {"shot": path.as_posix()}
        if verb == "back":
            page.back()
            guard(page.url())
            return page.changed()
        if verb == "tabs":
            targets = chrome.send("Target.getTargets").get("targetInfos", [])
            return [{"url": t["url"], "title": t["title"]} for t in targets if t["type"] == "page"]
        if verb == "close":
            stop[0] = True
            return {"closed": True}
        raise ValueError(f"unknown browse verb {verb}")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            if body.get("token") != token:
                self.send_response(403)
                self.end_headers()
                return
            last[0] = time.monotonic()
            try:
                reply = {"ok": True, "result": act(body.get("verb"), body.get("args") or [])}
            except Exception as e:
                reply = {"ok": False, "error": f"{type(e).__name__}: {e}"}
            data = json.dumps(reply, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = HTTPServer(("127.0.0.1", 0), Handler)
    server.timeout = 5
    state_path().write_text(json.dumps({"port": server.server_address[1], "token": token, "pid": os.getpid(),
                                        "show": show}), encoding="utf-8")
    try:
        while not stop[0] and time.monotonic() - last[0] < IDLE_SECONDS:
            server.handle_request()
    finally:
        chrome.close()
        state_path().unlink(missing_ok=True)


def call(verb, args, state=None):
    state = state or json.loads(state_path().read_text(encoding="utf-8"))
    req = urllib.request.Request(f"http://127.0.0.1:{state['port']}/",
                                 data=json.dumps({"token": state["token"], "verb": verb, "args": args}).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def ensure(show=False):
    """Return the running daemon's state, starting one if needed."""
    if state_path().is_file():
        try:
            state = json.loads(state_path().read_text(encoding="utf-8"))
            if not call("tabs", [], state).get("ok"):
                raise ConnectionError("chrome is not answering")
            if not show or state.get("show"):
                return state
            call("close", [], state)
            time.sleep(1)
        except (OSError, ValueError, urllib.error.URLError):
            pass
        state_path().unlink(missing_ok=True)
    kw = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
          "env": child_env()}
    if os.name == "nt":
        kw["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    subprocess.Popen([sys.executable, "-m", "metarouter.browse.daemon", *(["--show"] if show else [])], **kw)
    start = time.monotonic()
    while time.monotonic() - start < START_TIMEOUT:
        if state_path().is_file():
            try:
                return json.loads(state_path().read_text(encoding="utf-8"))
            except ValueError:
                pass
        time.sleep(0.2)
    raise TimeoutError("the browser did not start in time")


if __name__ == "__main__":
    serve(show="--show" in sys.argv)
