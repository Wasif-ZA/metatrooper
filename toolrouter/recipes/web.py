import argparse
import datetime
import json
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from toolrouter.log import home

RECIPES = [
    {"name": "page", "summary": "read a public web page as plain text (markdown) through r.jina.ai",
     "args": ["url"], "purity": "external",
     "example": {"args": ["3000"], "expect_exit": 2, "expect_out": "cannot reach"}},
    {"name": "up", "summary": "is a local dev server or URL up: status, ms, title; --wait polls until it is",
     "args": ["url|port", "--wait"], "purity": "read",
     "example": {"args": ["1"], "expect_exit": 1, "expect_out": "down"}},
    {"name": "repo", "summary": "GitHub repo facts for the dependency gate: stars, licence, last push",
     "args": ["owner/name"], "purity": "read",
     "example": {"args": ["not-a-repo"], "expect_exit": 2, "expect_out": "want owner/name"}},
    {"name": "screenshot", "summary": "screenshot a page with the Playwright CLI, shrunk for reading",
     "args": ["url", "file", "--width", "--height", "--full", "--dark", "--device", "--wait-for"],
     "purity": "read"},
]
UA = {"User-Agent": "toolrouter"}
TITLE = re.compile(rb"<title[^>]*>(.*?)</title>", re.I | re.S)
JINA_NOISE = re.compile(r"^(Warning|Published Time|Markdown Content):")
LOCAL = re.compile(r"^(localhost|127\.|0\.0\.0\.0|\[::1\])")


def url_of(s):
    if s.isdigit():
        return f"http://127.0.0.1:{s}/"
    return s if "://" in s else f"http://{s}" if LOCAL.match(s) else f"https://{s}"


def blocked(url):
    from toolrouter.browse.daemon import blocked_hosts
    from toolrouter.browse.page import host_blocked
    return host_blocked(url, blocked_hosts())


def page(a):
    url = url_of(a.url)
    if LOCAL.match(url.split("://", 1)[1]):
        return {"exit": 2, "out": f"r.jina.ai cannot reach {url}. Use: toolrouter browse open {url}"}
    m = re.match(r"^https://github\.com/([^/]+)/([^/]+)/?$", url)
    if m:
        owner, repo = m.group(1), m.group(2)
        gh = shutil.which("gh") or "gh"
        try:
            p = subprocess.run([gh, "api", f"repos/{owner}/{repo}/readme", "-H", "Accept: application/vnd.github.raw"],
                               capture_output=True, timeout=60)
            if p.returncode == 0:
                text = (p.stdout or b"").decode("utf-8", errors="replace")
                return {"exit": 0, "full": text, "out": text.strip()}
        except (OSError, subprocess.TimeoutExpired):
            pass
    req = urllib.request.Request("https://r.jina.ai/" + url, headers={**UA, "X-Return-Format": "markdown"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError) as e:
        return {"exit": 1, "out": f"could not read {url}: {e}"}
    keep = [ln for ln in text.splitlines() if not JINA_NOISE.match(ln)]
    return {"exit": 0, "full": text, "out": re.sub(r"\n{3,}", "\n\n", "\n".join(keep)).strip()}


class RefuseBlocked(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if blocked(newurl):
            raise urllib.error.URLError(f"redirected to {newurl}, which is on the blocked-hosts list")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def probe(url):
    start = time.monotonic()
    try:
        opener = urllib.request.build_opener(RefuseBlocked)
        with opener.open(urllib.request.Request(url, headers=UA), timeout=5) as resp:
            status, body = resp.status, resp.read(65536)
    except urllib.error.HTTPError as e:
        status, body = e.code, b""
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        return {"up": False, "url": url, "why": "down: " + str(getattr(e, "reason", e))}
    m = TITLE.search(body)
    out = {"up": status < 400, "url": url, "status": status, "ms": round((time.monotonic() - start) * 1000)}
    if m:
        out["title"] = " ".join(m.group(1).decode("utf-8", errors="replace").split())[:120]
    return out


def up(a):
    url = url_of(a.url)
    deadline = time.monotonic() + a.wait
    while True:
        res = probe(url)
        if res["up"] or time.monotonic() >= deadline:
            return {"exit": 0 if res["up"] else 1, "out": res}
        time.sleep(0.5)


def repo(a):
    name = re.sub(r"^(https?://)?(www\.)?github\.com/", "", a.url).strip("/").removesuffix(".git")
    if name.count("/") != 1:
        return {"exit": 2, "out": f"want owner/name, got {a.url}"}
    gh = shutil.which("gh")
    if not gh:
        return {"exit": 127, "out": "gh is not installed or not on PATH"}
    p = subprocess.run([gh, "api", f"repos/{name}"], capture_output=True)
    if p.returncode:
        return {"exit": p.returncode, "out": p.stderr.decode("utf-8", errors="replace").strip()}
    d = json.loads(p.stdout)
    return {"exit": 0, "full": p.stdout.decode("utf-8", errors="replace"), "out": {
        "repo": d["full_name"], "stars": d["stargazers_count"], "license": (d.get("license") or {}).get("spdx_id"),
        "pushed": (d.get("pushed_at") or "")[:10], "archived": d["archived"], "fork": d["fork"],
        "open_issues": d["open_issues_count"], "about": (d.get("description") or "").strip()[:160]}}


def screenshot(a):
    pw = shutil.which("playwright")
    if not pw:
        return {"exit": 127, "out": "playwright CLI not on PATH. It ships with: pip install playwright"}
    url = url_of(a.url)
    if a.file:
        out = Path(a.file)
    else:
        out = home() / "shots" / f"{datetime.datetime.now():%Y%m%d-%H%M%S%f}.png"
        out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [pw, "screenshot", f"--viewport-size={a.width},{a.height}"]
    cmd += ["--full-page"] * a.full + ["--color-scheme=dark"] * a.dark
    cmd += [f"--device={a.device}"] * bool(a.device) + [f"--wait-for-selector={a.wait_for}"] * bool(a.wait_for)
    p = subprocess.run([*cmd, url, str(out)], capture_output=True, timeout=120)
    log = (p.stdout + p.stderr).decode("utf-8", errors="replace")
    if p.returncode or not out.is_file():
        err = [ln for ln in log.splitlines() if ln.strip()][-5:]
        return {"exit": p.returncode or 1, "full": log, "out": "\n".join(err) or "no screenshot written"}
    res = {"file": out.as_posix()}
    try:
        from toolrouter.hook import shrink_image
        small = shrink_image(out, cache=home() / "img")
        if small:
            res["read"] = Path(small).as_posix()
    except ImportError:
        pass
    return {"exit": 0, "full": log, "out": res}


def run(args, name):
    ap = argparse.ArgumentParser(prog=f"toolrouter run {name}")
    ap.add_argument("url")
    if name == "up":
        ap.add_argument("--wait", type=float, default=0, help="seconds to keep trying")
    if name == "screenshot":
        ap.add_argument("file", nargs="?")
        ap.add_argument("--width", type=int, default=1280)
        ap.add_argument("--height", type=int, default=800)
        ap.add_argument("--full", action="store_true")
        ap.add_argument("--dark", action="store_true")
        ap.add_argument("--device")
        ap.add_argument("--wait-for", dest="wait_for")
    a = ap.parse_args(args)
    if name in ("page", "up", "screenshot") and blocked(url_of(a.url)):
        return {"exit": 2, "out": f"{a.url} is on the blocked-hosts list"}
    return {"page": page, "up": up, "repo": repo, "screenshot": screenshot}[name](a)
