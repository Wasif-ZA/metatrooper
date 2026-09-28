import datetime
import os
import re
from pathlib import Path


def home():
    return Path(os.environ.get("CALLROUTER_HOME") or Path.home() / ".callrouter")


def write(label, raw):
    """Write raw output bytes to a fresh log file and return its path."""
    now = datetime.datetime.now()
    folder = home() / "logs" / now.date().isoformat()
    folder.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^A-Za-z0-9]+", "-", label)[:40].strip("-") or "cmd"
    path = folder / f"{now:%H%M%S}-{os.getpid()}-{slug}.log"
    path.write_bytes(raw)
    return path
