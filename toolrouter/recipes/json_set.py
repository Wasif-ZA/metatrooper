import argparse
import json
import re
from pathlib import Path

from toolrouter import snapshot
from toolrouter.recipes.json_get import parse_path, walk

RECIPE = {
    "name": "json-set",
    "summary": "set a value in a JSON file by path, keeping key order",
    "args": ["file", "path", "value", "--string"],
    "purity": "write",
    "example": {"setup": {"demo.json": '{"a": {"b": 1}, "z": 0}'},
                "args": ["demo.json", ".a.b", "2"], "expect_exit": 0, "expect_out": "set .a.b"},
}


def indent_of(text):
    m = re.search(r"\n([ \t]+)\S", text)
    return m.group(1) if m else None


def run(args):
    ap = argparse.ArgumentParser(prog="toolrouter run json-set")
    ap.add_argument("file")
    ap.add_argument("path")
    ap.add_argument("value", help="parsed as JSON when valid, else stored as a string")
    ap.add_argument("--string", action="store_true", help="always store the value as a string")
    a = ap.parse_args(args)
    path = Path(a.file)
    try:
        text = path.read_text(encoding="utf-8")
        data = json.loads(text)
        steps = parse_path(a.path)
        if not steps:
            return {"exit": 2, "out": "path must name a key or index, not the root"}
        parent = walk(data, steps[:-1])
        value = a.value
        if not a.string:
            try:
                value = json.loads(a.value)
            except ValueError:
                pass
        last = steps[-1]
        if isinstance(parent, list):
            if not isinstance(last, int) or not -len(parent) <= last < len(parent):
                return {"exit": 1, "out": f"index {last} is outside a list of {len(parent)}"}
        elif isinstance(last, int):
            return {"exit": 1, "out": f"index [{last}] needs a list, found an object"}
        elif not isinstance(parent, dict):
            return {"exit": 1, "out": f"cannot set {last!r} on a {type(parent).__name__}"}
        parent[last] = value
    except (OSError, ValueError, LookupError) as e:
        return {"exit": 1, "out": str(e)}
    sid = snapshot.take([path])
    ind = indent_of(text)
    out = json.dumps(data, ensure_ascii=False, indent=ind if ind is not None else None)
    path.write_text(out + ("\n" if text.endswith("\n") else ""), encoding="utf-8")
    return {"exit": 0, "out": f"set {a.path} in {a.file} (undo: toolrouter undo {sid})"}
