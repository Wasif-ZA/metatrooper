import json
import re
from pathlib import Path

from metarouter.log import home


def files():
    """Policy files in force: the repo's .metarouter/policy.json (walking up to the git top), then the user's."""
    found = []
    for d in [Path.cwd(), *Path.cwd().parents]:
        if (d / ".metarouter" / "policy.json").is_file():
            found.append(d / ".metarouter" / "policy.json")
            break
        if (d / ".git").exists():
            break
    found.append(home() / "policy.json")
    out = []
    for f in found:
        if f.is_file() and f.resolve() not in [x.resolve() for x in out]:
            out.append(f)
    return out


def rules():
    """Every rule as {"kind", "pattern", "file", "bad"}; bad is the regex error or None."""
    out = []
    for f in files():
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            out.append({"kind": "refuse", "pattern": "", "file": f.as_posix(), "bad": f"unreadable: {e}"})
            continue
        for kind in ("refuse", "warn"):
            for pat in (data.get(kind) or []) if isinstance(data, dict) else []:
                try:
                    re.compile(pat)
                    bad = None
                except (re.error, TypeError) as e:
                    bad = str(e)
                out.append({"kind": kind, "pattern": pat, "file": f.as_posix(), "bad": bad})
    return out


def verdict(cmd):
    """Return (refusal note or None, [warn notes]) for a command about to run."""
    warns = []
    for r in rules():
        if r["bad"] or not re.search(r["pattern"], cmd):
            continue
        note = f"{'refused' if r['kind'] == 'refuse' else 'warned'} by {r['file']}: {r['pattern']}"
        if r["kind"] == "refuse":
            return note, warns
        warns.append(note)
    return None, warns
