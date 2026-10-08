import json
from pathlib import Path

from metarouter import recipes as store
from metarouter.log import home
from metarouter.result import Result

PACKS = Path(__file__).with_name("packs")
USAGE = "usage: metarouter pack list | add <name> | remove <name>"


def available():
    out = {}
    for f in sorted(PACKS.glob("*.json")):
        p = json.loads(f.read_text(encoding="utf-8"))
        if p.get("tier", "free") == "free":
            out[p["pack"]] = p
    return out


def hints_path():
    return home() / "hints.json"


def read_hints():
    try:
        h = json.loads(hints_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return h if isinstance(h, list) else []


def user_recipes():
    folder = store.user_dir()
    for f in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        try:
            r = json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if isinstance(r, dict):
            yield f, r


def installed(name):
    tag = f"pack:{name}"
    return any(r.get("source") == tag for _, r in user_recipes()) or any(h.get("source") == tag for h in read_hints())


def add(name, pack):
    tag = f"pack:{name}"
    folder = store.user_dir()
    folder.mkdir(parents=True, exist_ok=True)
    added, kept = [], []
    for r in pack.get("recipes", []):
        if not store.NAME.match(r.get("name", "")):
            continue
        path = folder / f"{r['name']}.json"
        if path.exists() and json.loads(path.read_text(encoding="utf-8")).get("source") != tag:
            kept.append(r["name"])
            continue
        path.write_text(json.dumps({"kind": "shell", "purity": "read", **r, "source": tag}, indent=1,
                                   ensure_ascii=False), encoding="utf-8")
        added.append(r["name"])
    current = read_hints()
    ids = {h.get("id") for h in current if h.get("source") != tag}
    current = [h for h in current if h.get("source") != tag]
    new = [{**h, "source": tag} for h in pack.get("hints", []) if h.get("id") not in ids]
    if new:
        hints_path().write_text(json.dumps(current + new, indent=1, ensure_ascii=False), encoding="utf-8")
    return {"recipes": added, "hints": len(new), "kept yours": kept}


def remove(name):
    tag = f"pack:{name}"
    gone = []
    for f, r in list(user_recipes()):
        if r.get("source") == tag:
            f.unlink()
            gone.append(r.get("name"))
    folder = store.user_dir()
    if folder.is_dir() and not any(folder.iterdir()):
        folder.rmdir()
    current = read_hints()
    left = [h for h in current if h.get("source") != tag]
    if len(left) != len(current):
        if left:
            hints_path().write_text(json.dumps(left, indent=1, ensure_ascii=False), encoding="utf-8")
        else:
            hints_path().unlink()
    return {"recipes": gone, "hints": len(current) - len(left)}


def lane(args):
    verb = args[0] if args else "list"
    packs = available()
    if verb == "list":
        return Result(ok=True, lane="pack", out=[
            f"{n}  {p.get('version', '')}  {len(p.get('recipes', []))} recipes, {len(p.get('hints', []))} hints"
            f"{'  (added)' if installed(n) else ''}" for n, p in packs.items()])
    if verb not in ("add", "remove") or len(args) < 2:
        return Result(ok=False, lane="pack", exit=2, note=USAGE)
    name = args[1]
    if verb == "remove":
        out = remove(name)
        if not out["recipes"] and not out["hints"]:
            return Result(ok=False, lane="pack", exit=1, note=f'pack "{name}" is not added')
        return Result(ok=True, lane="pack", out=out)
    if name not in packs:
        return Result(ok=False, lane="pack", exit=2, note=f'no pack "{name}". Packs: {", ".join(packs)}')
    out = add(name, packs[name])
    return Result(ok=True, lane="pack", out={k: v for k, v in out.items() if v},
                  note=f"check them here: metarouter check. Undo: metarouter pack remove {name}")
