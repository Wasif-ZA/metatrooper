import json
import shlex
import shutil
import subprocess

from metarouter.log import home

TIMEOUT = 10


def path():
    return home() / "versions.json"


def binary(recipe):
    """The CLI a recipe depends on: its "needs", else the first word of a shell body."""
    if recipe.get("needs"):
        return recipe["needs"]
    if recipe.get("kind") != "shell" or not isinstance(recipe.get("body"), str):
        return None
    try:
        words = shlex.split(recipe["body"])
    except ValueError:
        return None
    return words[0] if words and "{" not in words[0] else None


def current(tool):
    """First line of `<tool> --version`, or None when it cannot be read."""
    exe = shutil.which(tool)
    if not exe:
        return None
    try:
        p = subprocess.run([exe, "--version"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           stdin=subprocess.DEVNULL, timeout=TIMEOUT)
    except (OSError, subprocess.TimeoutExpired):
        return None
    lines = p.stdout.decode("utf-8", errors="replace").strip().splitlines()
    return lines[0].strip() if lines else None


def recorded():
    try:
        data = json.loads(path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def record(found):
    p = path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({**recorded(), **found}, indent=1, sort_keys=True), encoding="utf-8")
