import argparse
import json
import re
import sys

RECIPE = {
    "name": "json",
    "summary": "read a value out of a JSON file by path, like jq",
    "args": ["file", "path", "--keys"],
    "purity": "read",
    "example": {"setup": {"demo.json": '{"a": {"b": [10, 20]}}'},
                "args": ["demo.json", ".a.b[1]"], "expect_exit": 0, "expect_out": "20"},
}

STEP = re.compile(r'\.([^.\[\]"]+)|\[(-?\d+)\]|\["([^"]*)"\]')


def parse_path(path):
    """'.a.b[0]["x.y"]' -> ['a', 'b', 0, 'x.y']. '.' or '' is the root."""
    if path in ("", "."):
        return []
    steps, pos = [], 0
    for m in STEP.finditer(path):
        if m.start() != pos:
            raise ValueError(f"cannot read path at: {path[pos:]}")
        key, idx, quoted = m.groups()
        steps.append(int(idx) if idx is not None else (quoted if quoted is not None else key))
        pos = m.end()
    if pos != len(path):
        raise ValueError(f"cannot read path at: {path[pos:]}")
    return steps


def walk(data, steps):
    here = ""
    for s in steps:
        try:
            data = data[s]
        except (KeyError, IndexError, TypeError):
            kind = type(data).__name__
            raise LookupError(f"no {s!r} at {here or '.'} (it is a {kind})") from None
        here += f"[{s}]" if isinstance(s, int) else f".{s}"
    return data


def load(file):
    if file == "-":
        return json.load(sys.stdin)
    with open(file, encoding="utf-8") as f:
        return json.load(f)


def run(args):
    ap = argparse.ArgumentParser(prog="toolrouter run json")
    ap.add_argument("file", help="JSON file, or - for stdin")
    ap.add_argument("path", nargs="?", default=".")
    ap.add_argument("--keys", action="store_true", help="print only the keys or the list length")
    a = ap.parse_args(args)
    try:
        value = walk(load(a.file), parse_path(a.path))
    except (OSError, ValueError, LookupError) as e:
        return {"exit": 1, "out": str(e)}
    if a.keys:
        value = list(value) if isinstance(value, dict) else {"len": len(value)} if isinstance(value, list) else value
    if isinstance(value, (dict, list)):
        return {"exit": 0, "out": value}
    return {"exit": 0, "out": value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)}
