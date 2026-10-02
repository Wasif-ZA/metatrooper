import datetime
import hashlib
import json
import os
import re
import shlex
import subprocess
import time
from pathlib import Path

from toolrouter.log import home

LOCK_WAIT = 5.0
LOCK_STALE = 10.0
QUOTED = re.compile(r"'[^']*'|\"(?:\\.|[^\"\\])*\"")
NUMBER = re.compile(r"\b\d+(?:\.\d+)?\b")
PATHLIKE = re.compile(r"[/\\]|^\w[\w-]*\.\w{1,5}$|^[A-Za-z]:")


def shape(cmd):
    """Command with quoted strings, numbers and paths replaced by placeholders."""
    s = QUOTED.sub("S", cmd)
    try:
        toks = shlex.split(s, posix=False)
    except ValueError:
        toks = s.split()
    out = []
    for i, t in enumerate(toks):
        if i == 0 or out[-1] in ("|", "&&", "||", ";"):
            t = re.split(r"[/\\]", t)[-1]
        elif PATHLIKE.search(t):
            t = "P"
        out.append(NUMBER.sub("N", t))
    return " ".join(out)


def project(cwd=None):
    cwd = cwd or os.getcwd()
    try:
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=cwd, capture_output=True,
                             text=True, timeout=5)
        if top.returncode == 0 and top.stdout.strip():
            return top.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return "cwd-" + hashlib.sha1(str(Path(cwd).resolve()).encode()).hexdigest()[:12]


def agent():
    sid = os.environ.get("CLAUDE_CODE_SESSION_ID")
    if sid:
        return sid
    return "agent" if os.environ.get("AI_AGENT") or os.environ.get("CLAUDECODE") else "human"


def _lock(path):
    start = time.monotonic()
    while True:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            token = os.urandom(8).hex().encode()
            os.write(fd, token)
            return fd, token
        except (FileExistsError, PermissionError):  # Windows: PermissionError while a delete is pending
            try:
                if time.time() - path.stat().st_mtime > LOCK_STALE:
                    path.unlink(missing_ok=True)
                    continue
            except (FileNotFoundError, PermissionError):
                pass
            if time.monotonic() - start > LOCK_WAIT:
                raise TimeoutError(f"call log lock held: {path}")
            time.sleep(0.01)


def append(record):
    base = home()
    base.mkdir(parents=True, exist_ok=True)
    lock = base / "calls.jsonl.lock"
    line = (json.dumps(record, ensure_ascii=False) + "\n").encode("utf-8")
    fd, token = _lock(lock)
    try:
        with open(base / "calls.jsonl", "ab") as f:
            f.write(line)
    finally:
        os.close(fd)
        try:
            if lock.read_bytes() == token:
                lock.unlink(missing_ok=True)
        except OSError:
            pass


def record(lane, cmd, exit_code, secs, nbytes, log_path, recipe=None):
    return {
        "time": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "project": project(),
        "agent": agent(),
        "lane": lane,
        "recipe": recipe,
        "shape": shape(cmd),
        "exit": exit_code,
        "secs": secs,
        "bytes": nbytes,
        "log": Path(log_path).as_posix(),
    }


def read():
    path = home() / "calls.jsonl"
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
    return rows
