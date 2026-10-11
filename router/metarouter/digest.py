import datetime
import json
from collections import Counter

from metarouter import calls
from metarouter.log import home, private
from metarouter.result import Result

TOP = 3


def build(rows, days, now=None):
    now = now or datetime.datetime.now().astimezone()
    cutoff = (now - datetime.timedelta(days=days)).isoformat()
    rows = [r for r in rows if r.get("time", "") >= cutoff and not private(str(r.get("project") or ""))
            and not private(r.get("recipe") or "") and not private(r.get("shape") or "")]
    failed = [r for r in rows if r.get("exit") != 0]
    top = Counter(r.get("recipe") or r.get("shape") or "?" for r in failed).most_common(TOP)
    last = {}
    for r in rows:
        if r.get("recipe"):
            last.setdefault(r["recipe"], []).append(r.get("exit") == 0)
    broke = sorted(n for n, oks in last.items() if not oks[-1] and any(oks[:-1]))
    try:
        cands = json.loads((home() / "candidates" / "candidates.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cands = []
    waiting = Counter(c.get("type", "?") for c in cands if isinstance(c, dict))
    return {
        "days": days,
        "calls": len(rows),
        "failed": len(failed),
        "top_failures": [f"{n}  ({c} times)" for n, c in top],
        "waiting_review": {f"{t}s": n for t, n in sorted(waiting.items())} or "none",
        "recipes_broke": broke or "none: no recipe went from working to failing",
    }


def lane(args):
    days = args[args.index("--days") + 1] if "--days" in args[:-1] else "7"
    if not days.isdigit():
        return Result(ok=False, lane="digest", exit=2, note="--days needs a number")
    out = build(calls.read(), int(days))
    note = "review waiting candidates: metarouter learn --review" if out["waiting_review"] != "none" else None
    return Result(ok=True, lane="digest", out=out, note=note)
