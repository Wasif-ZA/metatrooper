import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class Result:
    ok: bool
    lane: str
    exit: int = 0
    secs: float = 0.0
    out: str | dict | list | None = None
    errors: list = field(default_factory=list)
    more_errors: int = 0
    tail: list = field(default_factory=list)
    lines: int = 0
    bytes: int = 0
    log: str | None = None
    cmd: str | None = None
    recipe: str | None = None
    hint: str | None = None
    breaker: str | None = None
    fallback: str | None = None
    marker: dict | None = None
    note: str | None = None
    whole: bool = False
    rec: dict | None = None

    def __post_init__(self):
        if self.fallback and not (self.marker and {"requested", "ran", "why"} <= set(self.marker)):
            raise ValueError("a fallback result needs a marker with requested, ran and why")


def mode(argv):
    """Return (mode, argv without --json/--human). Flags after a bare -- belong to the command."""
    cut = argv.index("--") if "--" in argv else len(argv)
    head, rest = argv[:cut], argv[cut:]
    chosen = None
    for flag in ("--json", "--human"):
        if flag in head:
            chosen = flag[2:]
            head = [a for a in head if a != flag]
    if chosen:
        return chosen, head + rest
    env = os.environ.get("METAROUTER_OUTPUT", "").lower()
    if env in ("json", "human"):
        return env, head + rest
    if os.environ.get("AI_AGENT") or os.environ.get("CLAUDECODE"):
        return "json", head + rest
    return "human", head + rest


def short_home(p):
    if not p:
        return p
    home = Path.home().as_posix()
    return "~" + p[len(home):] if p.startswith(home) else p


def human_out(out):
    if isinstance(out, str):
        return out.rstrip("\n")
    if not out:
        return json.dumps(out)
    if isinstance(out, list) and all(isinstance(x, str) for x in out):
        return "\n".join("  " + x for x in out)
    if isinstance(out, dict) and all(isinstance(v, list) and all(isinstance(x, str) for x in v) for v in out.values()):
        return "\n".join(f"  {k}:\n" + "\n".join("    " + x for x in v) for k, v in out.items())
    return json.dumps(out, indent=1, ensure_ascii=False)


def render(r, how):
    if how == "json":
        if r.ok and r.whole and isinstance(r.out, str) and not (r.hint or r.breaker or r.note or r.marker):
            return r.out[:-1] if r.out.endswith("\n") else r.out
        d = {"ok": r.ok, "out": r.out} if r.ok and not r.exit else {"ok": r.ok, "exit": r.exit, "out": r.out}
        shrunk = bool(r.errors or r.tail) or (r.out is None and r.log)
        extra = ("errors", "more_errors", "tail", "lines") if shrunk else ()
        keys = (*extra, "hint", "breaker", "note", "fallback", "marker") if r.whole else \
            (*extra, "log", "hint", "breaker", "note", "fallback", "marker")
        for k in keys:
            v = getattr(r, k)
            if v not in (None, [], 0, ""):
                d[k] = v
        return json.dumps(d, ensure_ascii=False, separators=(",", ":"))
    if r.lane == "menu":
        return r.out or r.note or ""
    status = "ok" if r.ok else "FAIL"
    head = f"{status}  {r.lane}"
    if r.recipe and not (r.cmd or "").startswith(r.recipe):
        head += f"  {r.recipe}"
    if r.cmd:
        head += f"  {r.cmd}"
    if r.log:
        head += f"   (exit {r.exit}, {r.secs}s, {r.lines} lines)"
    parts = [head]
    if r.marker:
        parts.append(f"  ran {r.marker['ran']} instead of {r.marker['requested']}: {r.marker['why']}")
    if r.out or r.out in ({}, []):
        parts.append(human_out(r.out))
    if r.errors:
        parts.append("  errors:")
        parts += [f"    {e}" for e in r.errors]
        if r.more_errors:
            parts.append(f"    ...and {r.more_errors} more in the log")
    if r.tail:
        parts.append("  last lines:")
        parts += [f"    {t}" for t in r.tail]
    for label, v in (("hint", r.hint), ("breaker", r.breaker), ("note", r.note)):
        if v:
            parts.append(f"  {label}: {v}")
    if r.log:
        parts.append(f"  full output: {short_home(r.log)}")
    return "\n".join(parts)
