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
    out: str | None = None
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
    env = os.environ.get("CALLROUTER_OUTPUT", "").lower()
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


def render(r, how):
    if how == "json":
        return json.dumps({k: v for k, v in asdict(r).items() if v not in (None, [], 0) or k in
                           ("ok", "exit", "out")}, ensure_ascii=False)
    if r.lane == "menu":
        return r.out or r.note or ""
    status = "ok" if r.ok else "FAIL"
    head = f"{status}  {r.lane}"
    if r.recipe:
        head += f"  {r.recipe}"
    if r.cmd:
        head += f"  {r.cmd}"
    if r.log:
        head += f"   (exit {r.exit}, {r.secs}s, {r.lines} lines)"
    parts = [head]
    if r.marker:
        parts.append(f"  ran {r.marker['ran']} instead of {r.marker['requested']}: {r.marker['why']}")
    if r.out:
        parts.append(r.out.rstrip("\n"))
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
