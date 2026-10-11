import json
from pathlib import Path
import re

FILTERS_DIR = Path(__file__).parent / "filters"


def load(directory=None):
    folder = Path(directory) if directory else FILTERS_DIR
    if not folder.is_dir():
        return []
    items = []
    for path in sorted(folder.glob("*.json")):
        try:
            items.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    return items


def match(cmd, filters=None):
    if not cmd or not isinstance(cmd, str):
        return None
    candidates = load() if filters is None else filters
    for flt in candidates:
        pattern = flt.get("match_command")
        if pattern and re.search(pattern, cmd):
            return flt
    return None


def apply(flt, text):
    for rule in flt.get("match_output") or []:
        pattern = rule.get("pattern")
        if pattern and re.search(pattern, text):
            return rule.get("replace", "")

    lines = text.splitlines()
    strip_patterns = [p for p in (flt.get("strip_lines_matching") or []) if p]
    if strip_patterns:
        lines = [ln for ln in lines if not any(re.search(p, ln) for p in strip_patterns)]

    keep_patterns = [p for p in (flt.get("keep_lines_matching") or []) if p]
    if keep_patterns:
        lines = [ln for ln in lines if any(re.search(p, ln) for p in keep_patterns)]

    max_lines = flt.get("max_lines")
    tail_lines = flt.get("tail_lines")
    if max_lines is not None:
        tail = tail_lines or 0
        if len(lines) > max_lines + tail:
            filtered_count = len(lines) - max_lines - tail
            marker = f"... {filtered_count} lines filtered ..."
            lines = lines[:max_lines] + [marker] + (lines[-tail:] if tail else [])

    out = "\n".join(lines)
    if not out.strip() and flt.get("on_empty"):
        return flt["on_empty"]
    return out
