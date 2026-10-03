import datetime
import os
import re
from pathlib import Path


def home():
    return Path(os.environ.get("METAROUTER_HOME") or Path.home() / ".metarouter")


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
