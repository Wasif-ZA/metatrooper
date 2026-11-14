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
    """True when text, as written or with backslashes as slashes, matches one of the config's "private" regexes."""
    texts = {text or "", (text or "").replace("\\", "/")}
    for pat in config().get("private") or []:
        try:
            if any(re.search(pat, t, re.I) for t in texts):
                return True
        except re.error:
            continue
    return False


def write(label, raw):
    """Write raw output bytes to a fresh log file and return its path."""
    now = datetime.datetime.now()
    folder = home() / "logs" / now.date().isoformat()
    folder.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^A-Za-z0-9]+", "-", label)[:12].strip("-") or "cmd"
    path = folder / f"{now:%H%M%S%f}-{os.getpid()}-{slug}.log"
    path.write_bytes(raw)
    return path
