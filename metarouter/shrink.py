import json
import re

SHORT = 2000
CLIP = 300
TAIL = 3
HEAD = 40
OK_TAIL = 10
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


def head_tail(lines):
    kept = [clip(ln) for ln in lines[:HEAD]]
    hidden = len(lines) - HEAD - OK_TAIL
    return "\n".join(kept + [f"... {hidden} lines not shown, full output in the log ..."] +
                     [clip(ln) for ln in lines[-OK_TAIL:]])


def shrink(text, failed=True):
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
    if not failed and len(lines) > HEAD + OK_TAIL:
        return {"out": head_tail(lines), "errors": [], "more_errors": 0, "tail": []}
    if not failed:
        return {"out": "\n".join(clip(ln) for ln in lines), "errors": [], "more_errors": 0, "tail": []}
    errs, more = errors(lines)
    tail = [clip(ln) for ln in lines if ln.strip()][-TAIL:]
    return {"out": None, "errors": errs, "more_errors": more, "tail": tail}


def is_heading(line):
    if not line.strip():
        return False
    if line.startswith("#"):
        return True
    stripped = line.rstrip()
    if stripped.endswith(":") and len(stripped) < 60:
        return True
    s = line.strip()
    return bool(s) and set(s) <= {"=", "-", "*"}


def chunks_of(text):
    lines = clean(text).splitlines()
    chunks = []
    cur_lines = []
    cur_start = None
    for i, line in enumerate(lines, 1):
        if not line.strip():
            if cur_lines:
                chunks.append({"start": cur_start, "end": i - 1, "lines": cur_lines})
                cur_lines = []
                cur_start = None
        else:
            if is_heading(line) and cur_lines:
                chunks.append({"start": cur_start, "end": i - 1, "lines": cur_lines})
                cur_lines = []
                cur_start = None
            if not cur_lines:
                cur_start = i
            cur_lines.append(line)
            if len(cur_lines) == 40:
                chunks.append({"start": cur_start, "end": i, "lines": cur_lines})
                cur_lines = []
                cur_start = None
    if cur_lines:
        chunks.append({"start": cur_start, "end": cur_start + len(cur_lines) - 1, "lines": cur_lines})
    return chunks


def want(text, words):
    want_words = words.lower().split()
    if not want_words:
        return None
    chunks = chunks_of(text)
    if not chunks:
        return None
    chunk_texts = ["\n".join(c["lines"]).lower() for c in chunks]
    scores = [0.0] * len(chunks)
    for w in want_words:
        counts = [ct.count(w) for ct in chunk_texts]
        chunks_with_w = sum(1 for cnt in counts if cnt > 0)
        if chunks_with_w > 0:
            for idx, cnt in enumerate(counts):
                if cnt > 0:
                    scores[idx] += cnt / chunks_with_w
    scored = [(scores[i], i, chunks[i]) for i in range(len(chunks)) if scores[i] > 0]
    if not scored:
        return None
    scored.sort(key=lambda x: -x[0])
    top = sorted(scored[:3], key=lambda x: x[1])
    out_lines = []
    for _, _, c in top:
        out_lines.append(f"lines {c['start']}-{c['end']}:")
        out_lines.extend(clip(ln) for ln in c["lines"])
    return "\n".join(out_lines)
