import re

from metarouter.log import config

KEEP = 4
SECRET = re.compile(
    r"sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{30,}"
    r"|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}"
    r"|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
    re.S)
ASSIGNED = re.compile(r"((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)(\S{6,})", re.I)


def on():
    return config().get("shield", True) is not False


def hide(value):
    return value[:KEEP] + "****"


def mask(text):
    """Return (text with secret values masked, how many were masked)."""
    text, n = SECRET.subn(lambda m: hide(m.group(0)), text)
    seen = []

    def assigned(m):
        if m.group(2).endswith("****"):
            return m.group(0)
        seen.append(1)
        return m.group(1) + hide(m.group(2))
    return ASSIGNED.sub(assigned, text), n + len(seen)


def walk(v):
    """Return (v with every string masked, count)."""
    if isinstance(v, str):
        return mask(v)
    if isinstance(v, list):
        pairs = [walk(x) for x in v]
        return [x for x, _ in pairs], sum(n for _, n in pairs)
    if isinstance(v, dict):
        pairs = {k: walk(x) for k, x in v.items()}
        return {k: x for k, (x, _) in pairs.items()}, sum(n for _, n in pairs.values())
    return v, 0


def guard(r):
    """Mask the Result fields an agent sees. The log on disk keeps the raw text."""
    if not on():
        return r
    total = 0
    for k in ("out", "errors", "tail", "note"):
        v, n = walk(getattr(r, k))
        setattr(r, k, v)
        total += n
    if total:
        said = f"masked {total} secret{'s' if total != 1 else ''}; the log has the raw text"
        r.note = f"{r.note}; {said}" if r.note else said
    return r


def leaks(recipe):
    """True when a recipe's body or example holds something that looks like a secret."""
    return on() and walk([recipe.get("body"), recipe.get("example")])[1] > 0
