import datetime
import json
import os
import re
from pathlib import Path


def home():
    return Path(os.environ.get("METAROUTER_HOME") or Path.home() / ".metarouter")


def config():
    """The user's ~/.metarouter/config.json as a dict; {} when missing or unreadable."""
    try:
        cfg = json.loads((home() / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return cfg if isinstance(cfg, dict) else {}


def private(text):
    """True when text matches one of the config's "private" regexes."""
    for pat in config().get("private") or []:
        try:
            if re.search(pat, text or "", re.I):
                return True
        except re.error:
            continue
    return False


NO_PRIVATE = ("WARNING: no private patterns set, so every transcript is read. To skip folders or words, add "
              "\"private\": [\"<regex>\"] to ~/.metarouter/config.json")


def no_private_warning():
    return None if config().get("private") else NO_PRIVATE


def child_env():
    """Environment for a detached `python -m metarouter...` child, able to import this copy of the package."""
    pkg = str(Path(__file__).resolve().parents[1])
    return {**os.environ, "PYTHONPATH": os.pathsep.join(filter(None, [pkg, os.environ.get("PYTHONPATH")]))}


def write(label, raw):
    """Write raw output bytes to a fresh log file and return its path."""
    now = datetime.datetime.now()
    folder = home() / "logs" / now.date().isoformat()
    folder.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^A-Za-z0-9]+", "-", label)[:12].strip("-") or "cmd"
    path = folder / f"{now:%H%M%S%f}-{os.getpid()}-{slug}.log"
    path.write_bytes(raw)
    return path
