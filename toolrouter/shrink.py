import json
import re

SHORT = 2000
CLIP = 300
TAIL = 3
MAX_ERRORS = 40
JSON_KEYS = 30
JSON_ITEMS = 3
JSON_DEPTH = 2
JSON_STR = 80

ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]")

ERROR_LINE = re.compile(
    r"(?i)(traceback|command not found|no such file|(?:^|\s)fatal:|(?:^|\s)error[: ]|"
    r"exception|failed|exit code [1-9])")


def clean(text):
    """Drop colour codes and keep only the last redraw of each progress-bar line."""
    text = ANSI.sub("", text).replace("\r\n", "\n")
    return "\n".join(ln.rstrip("\r").rsplit("\r", 1)[-1] for ln in text.split("\n"))


def clip(line):
    return line if len(line) <= CLIP else line[:CLIP] + "..."


def errors(lines):
    counts = {}
    for ln in lines:
        if ERROR_LINE.search(ln):
            key = clip(ln.rstrip())
            counts[key] = counts.get(key, 0) + 1
    out = [k if n == 1 else f"{k} (x{n})" for k, n in counts.items()]
    return out[:MAX_ERRORS], max(0, len(out) - MAX_ERRORS)


def json_shape(v, depth=0):
    if isinstance(v, dict):
        if depth >= JSON_DEPTH:
            names = list(v)[:12]
            return "{" + ",".join(map(str, names)) + (f",+{len(v) - 12}" if len(v) > 12 else "") + "}"
        items = list(v.items())
        shaped = {k: json_shape(x, depth + 1) for k, x in items[:JSON_KEYS]}
        if len(items) > JSON_KEYS:
            shaped["..."] = f"{len(items) - JSON_KEYS} more keys"
        return shaped
    if isinstance(v, list):
        if depth >= JSON_DEPTH:
            return f"[{len(v)} items]"
        return {"len": len(v), "first": [json_shape(x, depth + 1) for x in v[:JSON_ITEMS]]}
    if isinstance(v, str) and len(v) > JSON_STR:
        return v[:JSON_STR] + "..."
    return v


def shrink(text):
    """Return the fields a result carries for this output: out, errors, more_errors, tail."""
    lines = text.splitlines()
    if len(text) <= SHORT:
        return {"out": text, "errors": [], "more_errors": 0, "tail": []}
    stripped = text.strip()
    if stripped[:1] in "[{":
        try:
            shaped = json_shape(json.loads(stripped))
            return {"out": json.dumps(shaped, ensure_ascii=False), "errors": [], "more_errors": 0,
                    "tail": []}
        except ValueError:
            pass
    errs, more = errors(lines)
    tail = [clip(ln) for ln in lines if ln.strip()][-TAIL:]
    return {"out": None, "errors": errs, "more_errors": more, "tail": tail}
