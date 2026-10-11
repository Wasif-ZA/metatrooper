import json
import re

SHORT = 2000
CLIP = 300
TAIL = 3
HEAD_CHARS = 1200
TAIL_CHARS = 400
MAX_ERRORS = 40
FRAMES = 5
WANT_CHARS = 1600
SHAPE_LITERAL = 12
JSON_KEYS = 30
JSON_ITEMS = 3
JSON_DEPTH = 2
JSON_STR = 80

ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]")

SHAPE = re.compile(r"'[^']*'|\"[^\"]*\"|\S*[/\\]\S*|\d+")

DIGITS = re.compile(r"\d+")

ERROR_LINE = re.compile(
    r"(?i)(traceback|command not found|no such file|(?:^|\s)fatal:|(?:^|\s)error[: ]|"
    r"exception|failed|exit code [1-9])")


def clean(text):
    """Drop colour codes and keep only the last redraw of each progress-bar line."""
    text = ANSI.sub("", text).replace("\r\n", "\n")
    return "\n".join(ln.rstrip("\r").rsplit("\r", 1)[-1] for ln in text.split("\n"))


def clip(line):
    return line if len(line) <= CLIP else line[:CLIP] + "..."


def shape(line):
    s = SHAPE.sub("_", line.strip())
    return s if len(s.replace("_", "")) >= SHAPE_LITERAL else None


def collapse(lines):
    """Shorten each run of lines that differ only in paths, quotes or numbers to its first line, a count and its last line."""
    out, run = [], []

    def flush():
        if len(run) > 3:
            out.extend([run[0], f"  ... {len(run) - 2} more like these", run[-1]])
        else:
            out.extend(run)

    for ln in lines:
        if run and shape(ln) and shape(ln) == shape(run[0]):
            run.append(ln)
            continue
        flush()
        run = [ln]
    flush()
    return out


def errors(lines):
    counts, first = {}, {}
    frames = []
    in_trace = False
    for ln in lines:
        if ln.startswith("Traceback"):
            in_trace, frames = True, []
        elif in_trace and ln.lstrip().startswith('File "'):
            frames.append(clip(ln.rstrip()))
            continue
        elif in_trace and ln[:1] not in (" ", "\t"):
            in_trace = False
            for f in frames[-FRAMES:]:
                first.setdefault(f, f)
                counts[f] = counts.get(f, 0) + 1
        if ERROR_LINE.search(ln):
            key = DIGITS.sub("_", ln.strip())
            first.setdefault(key, clip(ln.rstrip()))
            counts[key] = counts.get(key, 0) + 1
    out = [first[k] if n == 1 else f"{first[k]} (x{n})" for k, n in counts.items()]
    return out[:MAX_ERRORS], max(0, len(out) - MAX_ERRORS)


def budget(text, head=HEAD_CHARS, tail=TAIL_CHARS):
    """Keep about `head` chars from the start and `tail` chars from the end, cut on line boundaries."""
    if len(text) <= head + tail:
        return text
    lines = text.splitlines()
    if len(lines) == 1:
        return f"{text[:head]}\n... cut, full output in the log ...\n{text[-tail:]}"
    h, used = [], 0
    for ln in lines:
        c = clip(ln)
        if used + len(c) > head:
            break
        h.append(c)
        used += len(c) + 1
    t, used = [], 0
    for ln in reversed(lines[len(h):]):
        c = clip(ln)
        if used + len(c) > tail:
            break
        t.insert(0, c)
        used += len(c) + 1
    hidden = len(lines) - len(h) - len(t)
    return "\n".join(h + ([f"... {hidden} lines not shown, full output in the log ..."] if hidden else []) + t)


def json_shape(v, depth=0):
    if isinstance(v, dict):
        if depth >= JSON_DEPTH:
            names = list(v)[:12]
            return "{" + ",".join(map(str, names)) + (f",+{len(v) - 12}" if len(v) > 12 else "") + "}"
        items = list(v.items())
        shaped = {clip_key(k): json_shape(x, depth + 1) for k, x in items[:JSON_KEYS]}
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


def clip_key(k):
    k = str(k)
    return k if len(k) <= JSON_STR else k[:JSON_STR] + "..."


def head_tail(lines):
    return budget("\n".join(collapse(lines)))


def shrink(text, failed=True):
    """Return the fields a result carries for this output: out, errors, more_errors, tail."""
    lines = text.splitlines()
    if len(text) <= SHORT:
        return {"out": text, "errors": [], "more_errors": 0, "tail": []}
    stripped = text.strip()
    if stripped[:1] in "[{":
        try:
            shaped = json_shape(json.loads(stripped))
            return {"out": shaped, "errors": [], "more_errors": 0, "tail": []}
        except ValueError:
            pass
    if not failed:
        return {"out": head_tail(lines), "errors": [], "more_errors": 0, "tail": []}
    errs, more = errors(lines)
    shown = set(errs)
    tail = [c for c in (clip(ln) for ln in lines if ln.strip()) if c not in shown][-TAIL:]
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
    picked, used = [], 0
    for s, i, c in scored[:3]:
        size = sum(len(clip(ln)) + 1 for ln in c["lines"])
        if picked and used + size > WANT_CHARS:
            break
        picked.append((i, c))
        used += size
    out_lines = []
    for _, c in sorted(picked, key=lambda x: x[0]):
        out_lines.append(f"lines {c['start']}-{c['end']}:")
        out_lines.extend(clip(ln) for ln in c["lines"])
    return budget("\n".join(out_lines), WANT_CHARS - TAIL_CHARS, TAIL_CHARS)
