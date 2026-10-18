import argparse
import fnmatch
import os
import re
from pathlib import Path

RECIPE = {
    "name": "find",
    "summary": "regex search across folders or named files (grep stand-in), grouped by file with counts",
    "args": ["pattern", "path...", "--glob", "-i", "--lines"],
    "purity": "read",
    "example": {"setup": {"a.py": "x = 1\nneedle()\n", "b.txt": "no match\n"},
                "args": ["needle", "."], "expect_exit": 0, "expect_out": "a.py"},
}

SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", "dist", "build"}
MAX_FILE = 5_000_000
MAX_FILES_SHOWN = 30
CLIP = 200


def files(folder, glob):
    if folder.is_file():
        yield folder
        return
    for dirpath, dirnames, names in os.walk(folder):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for n in names:
            if glob and not fnmatch.fnmatch(n, glob):
                continue
            yield Path(dirpath) / n


def read_text(path):
    try:
        if path.stat().st_size > MAX_FILE:
            return None
        raw = path.read_bytes()
    except OSError:
        return None
    if b"\0" in raw[:8192]:
        return None
    return raw.decode("utf-8", errors="replace")


def run(args):
    ap = argparse.ArgumentParser(prog="metarouter run find")
    ap.add_argument("pattern", help="Python regex")
    ap.add_argument("paths", nargs="*", default=["."], help="folders or files")
    ap.add_argument("--glob", help="only file names matching this, e.g. '*.py'")
    ap.add_argument("-i", action="store_true", help="ignore case")
    ap.add_argument("--lines", type=int, help="matching lines shown per file; default 1, or 20 when only files are named")
    a = ap.parse_args(args)
    try:
        rx = re.compile(a.pattern, re.I if a.i else 0)
    except re.error as e:
        return {"exit": 2, "out": f"bad regex: {e}"}
    roots = [Path(x) for x in a.paths]
    missing = [str(r) for r in roots if not r.exists()]
    if missing:
        return {"exit": 1, "out": f"no such path: {', '.join(missing)}"}
    if a.lines is None:
        a.lines = 20 if all(r.is_file() for r in roots) else 1
    results, full, clipped = [], [], False
    for root, p in ((r, p) for r in roots for p in files(r, a.glob)):
        text = read_text(p)
        if text is None:
            continue
        hits = [(i, ln) for i, ln in enumerate(text.splitlines(), 1) if rx.search(ln)]
        if not hits:
            continue
        rel = p.as_posix() if root.is_file() else p.relative_to(root).as_posix()
        if len(roots) > 1 and not root.is_file():
            rel = (root / rel).as_posix()
        shown = [f"{i}: {ln.strip()[:CLIP]}" for i, ln in hits[:a.lines]]
        clipped = clipped or any(len(ln.strip()) > CLIP for _, ln in hits[:a.lines])
        if len(hits) > a.lines:
            shown.append(f"+{len(hits) - a.lines} more")
        results.append((rel, len(hits), shown))
        full += [f"{rel}:{i}: {ln}" for i, ln in hits]
    results.sort(key=lambda r: (-r[1], r[0]))
    out = {"matches": sum(r[1] for r in results), "files": {rel: shown for rel, _, shown in results[:MAX_FILES_SHOWN]}}
    if len(results) > MAX_FILES_SHOWN:
        out["more_files"] = len(results) - MAX_FILES_SHOWN
    whole = len(results) <= MAX_FILES_SHOWN and not clipped and all(n <= a.lines for _, n, _ in results)
    return {"exit": 0 if results else 1, "out": out, "full": "\n".join(full), "whole": whole}
