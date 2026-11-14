import argparse
import json
import re
import shutil
import subprocess
import urllib.error
import urllib.request
from urllib.parse import urlparse

from metarouter.log import home

RECIPES = [
    {"name": "page", "summary": "read a public web page as plain text (markdown) through r.jina.ai",
     "args": ["url"], "purity": "external",
     "example": {"args": ["3000"], "expect_exit": 2, "expect_out": "cannot reach"}},
    {"name": "repo", "summary": "GitHub repo facts for the dependency gate: stars, licence, last push",
     "args": ["owner/name"], "purity": "read",
     "example": {"args": ["not-a-repo"], "expect_exit": 2, "expect_out": "want owner/name"}},
]
UA = {"User-Agent": "metarouter"}
JINA_NOISE = re.compile(r"^(Warning|Published Time|Markdown Content):")
LOCAL = re.compile(r"^(localhost|127\.|0\.0\.0\.0|\[::1\])")


def url_of(s):
    if s.isdigit():
        return f"http://127.0.0.1:{s}/"
    return s if "://" in s else f"http://{s}" if LOCAL.match(s) else f"https://{s}"


def blocked(url):
    """True when the url's host is on ~/.metarouter/blocked-hosts.txt, or a subdomain of one."""
    path = home() / "blocked-hosts.txt"
    if not path.is_file():
        return False
    hosts = [ln.strip().lower() for ln in path.read_text(encoding="utf-8").splitlines()
             if ln.strip() and not ln.strip().startswith("#")]
    host = (urlparse(url if "://" in url else "//" + url).hostname or "").rstrip(".").lower()
    return bool(host) and any(host == b or host.endswith("." + b) for b in hosts)


def page(a):
    url = url_of(a.url)
    if LOCAL.match(url.split("://", 1)[1]):
        return {"exit": 2, "out": f"r.jina.ai cannot reach {url}. Open it in a local browser instead"}
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


def run(args, name):
    ap = argparse.ArgumentParser(prog=f"metarouter run {name}")
    ap.add_argument("url")
    a = ap.parse_args(args)
    if name == "page" and blocked(url_of(a.url)):
        return {"exit": 2, "out": f"{a.url} is on the blocked-hosts list"}
    return {"page": page, "repo": repo}[name](a)
