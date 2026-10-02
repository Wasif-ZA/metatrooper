import importlib
import json
import math
import os
import re
from pathlib import Path

from toolrouter import calls
from toolrouter.log import home

CATALOG = Path(__file__).with_name("catalog.json")
SEEDS = ["replace", "json_get", "json_set", "img", "find", "engines", "web"]
NAME = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
MIN_CALLS = 5
PURITY = {"read", "write", "external", "destructive"}
MODES = ("learn", "auto")


def user_dir():
    return home() / "recipes"


def mode():
    """learn: seeds and approved recipes only. auto: also the catalogue, PATH CLIs and the MCP registry."""
    env = os.environ.get("TOOLROUTER_MODE")
    if env in MODES:
        return env
    try:
        return json.loads((home() / "config.json").read_text(encoding="utf-8")).get("mode", "learn")
    except (OSError, ValueError):
        return "learn"


def set_mode(m):
    if m not in MODES:
        raise ValueError(f"mode is learn or auto, not {m!r}")
    path = home() / "config.json"
    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cfg = {}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({**cfg, "mode": m}, indent=1), encoding="utf-8")


def seed_recipes():
    out = {}
    if mode() == "auto" and CATALOG.is_file():
        for r in json.loads(CATALOG.read_text(encoding="utf-8")):
            out[r["name"]] = {**r, "kind": "shell", "source": "catalog"}
    for mod in SEEDS:
        m = importlib.import_module(f"toolrouter.recipes.{mod}")
        for r in getattr(m, "RECIPES", None) or [m.RECIPE]:
            kind = "engine" if "engine" in r else "python"
            out[r["name"]] = {**r, "kind": kind, "body": m.__name__, "source": "seed"}
    return out


def load():
    """All recipes by name: built-in seeds, then user files, which win on a name clash."""
    recipes = seed_recipes()
    folder = user_dir()
    if folder.is_dir():
        for f in sorted(folder.glob("*.json")):
            try:
                r = json.loads(f.read_text(encoding="utf-8"))
            except ValueError:
                continue
            if isinstance(r, dict) and r.get("name"):
                recipes[r["name"]] = r
    return recipes


def save(name, body, summary=None, kind="shell", purity="read", source="saved", example=None):
    if not NAME.match(name):
        raise ValueError(f'bad recipe name "{name}": use lowercase letters, digits and dashes')
    if purity not in PURITY:
        raise ValueError(f"purity must be one of {sorted(PURITY)}")
    folder = user_dir()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{name}.json"
    if path.exists():
        arch = folder / "archive"
        arch.mkdir(exist_ok=True)
        n = 1
        while (arch / f"{name}@{n}.json").exists():
            n += 1
        path.replace(arch / f"{name}@{n}.json")
    text = "\n".join(body) if isinstance(body, list) else body
    placeholders = sorted(set(re.findall(r"\{(\d)\}", text)))
    if "0" in placeholders:
        raise ValueError("placeholders start at {1}; {0} is not allowed")
    recipe = {"name": name, "summary": summary or calls.shape(text), "args": [f"arg{p}" for p in placeholders],
              "kind": kind, "body": body, "purity": purity, "source": source}
    if example:
        recipe["example"] = example
    path.write_text(json.dumps(recipe, indent=1, ensure_ascii=False), encoding="utf-8")
    return recipe


def usage(recipe_name, rows, project=None):
    mine = [r for r in rows if r.get("recipe") == recipe_name]
    if project:
        local = [r for r in mine if r.get("project") == project]
        mine = local or mine
    if not mine:
        return None
    ok = sum(1 for r in mine if r.get("exit") == 0) / len(mine)
    toks = sum(r.get("bytes", 0) for r in mine) / len(mine) / 4
    ms = sum(r.get("secs", 0) for r in mine) / len(mine) * 1000
    return {"calls": len(mine), "success_rate": ok, "avg_tokens": toks, "avg_ms": ms}


def score(u):
    return 100 * u["success_rate"] - 10 * math.log10(1 + u["avg_tokens"]) - 5 * math.log10(1 + u["avg_ms"])


def rank(recipes, rows, project=None):
    """Return [(name, score, calls)] best first. Under MIN_CALLS calls a recipe takes the median score."""
    scored = {n: usage(n, rows, project) for n in recipes}
    real = sorted(score(u) for u in scored.values() if u and u["calls"] >= MIN_CALLS)
    median = real[len(real) // 2] if real else 0.0
    out = []
    for n, u in scored.items():
        calls_n = u["calls"] if u else 0
        out.append((n, score(u) if u and calls_n >= MIN_CALLS else median, calls_n))
    return sorted(out, key=lambda x: (-x[1], -x[2], x[0]))


def signature(r):
    return " ".join([r["name"], *(a if a.startswith("-") else f"<{a}>" for a in r.get("args", []))])


def module(r):
    return importlib.import_module(r["body"])
