import argparse
import re
from pathlib import Path

from callrouter import snapshot

RECIPE = {
    "name": "replace",
    "summary": "find and replace text in a file, literal or regex",
    "args": ["file", "old", "new", "--regex", "--old-file", "--new-file", "--count"],
    "purity": "write",
    "example": {"setup": {"demo.txt": "the cat sat on the cat mat\n"},
                "args": ["demo.txt", "cat", "dog"], "expect_exit": 0, "expect_out": "2 replacements"},
}


def run(args):
    ap = argparse.ArgumentParser(prog="callrouter run replace")
    ap.add_argument("file")
    ap.add_argument("old", nargs="?")
    ap.add_argument("new", nargs="?")
    ap.add_argument("--regex", action="store_true", help="treat old as a Python regex")
    ap.add_argument("--old-file", help="read old from this file (for backslashes and newlines)")
    ap.add_argument("--new-file", help="read new from this file")
    ap.add_argument("--count", type=int, default=0, help="replace at most this many (0 = all)")
    a = ap.parse_args(args)
    old = Path(a.old_file).read_text(encoding="utf-8") if a.old_file else a.old
    new = Path(a.new_file).read_text(encoding="utf-8") if a.new_file else a.new
    if old is None or new is None:
        return {"exit": 2, "out": "need old and new, as arguments or --old-file/--new-file"}
    path = Path(a.file)
    if not path.is_file():
        return {"exit": 1, "out": f"no such file: {a.file}"}
    with open(path, encoding="utf-8", newline="") as f:
        text = f.read()
    if a.regex:
        result, n = re.subn(old, new, text, count=a.count)
    else:
        n = text.count(old) if not a.count else min(text.count(old), a.count)
        result = text.replace(old, new, a.count or -1)
    if n == 0:
        return {"exit": 1, "out": f"0 replacements in {a.file}: pattern not found, file unchanged"}
    sid = snapshot.take([path])
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(result)
    return {"exit": 0, "out": f"{n} replacements in {a.file} (undo: callrouter undo {sid})"}
