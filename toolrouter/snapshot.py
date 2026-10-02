import datetime
import json
import os
import shutil
from pathlib import Path

from toolrouter.log import home


def root():
    return home() / "snapshots"


def take(paths):
    """Copy each existing file into a new snapshot folder. Return the snapshot id."""
    sid = f"{datetime.datetime.now():%Y%m%dT%H%M%S%f}-{os.getpid()}"
    folder = root() / sid
    folder.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for i, p in enumerate(paths):
        p = Path(p).resolve()
        if p.is_file():
            shutil.copy2(p, folder / f"{i}{p.suffix}")
            manifest[str(p)] = f"{i}{p.suffix}"
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return sid


def latest():
    if not root().is_dir():
        return None
    ids = sorted(d.name for d in root().iterdir() if (d / "manifest.json").is_file())
    return ids[-1] if ids else None


def restore(sid=None):
    """Copy a snapshot's files back to where they came from. Return the restored paths."""
    sid = sid or latest()
    if not sid:
        raise FileNotFoundError("no snapshots yet")
    folder = root() / sid
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    for original, stored in manifest.items():
        shutil.copy2(folder / stored, original)
    return list(manifest)
