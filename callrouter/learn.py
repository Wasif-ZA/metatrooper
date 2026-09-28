import hashlib
import json
import os
import re
from collections import Counter, defaultdict
from pathlib import Path

from callrouter import calls
from callrouter.log import home

TRANSCRIPTS = Path.home() / ".claude" / "projects"
MIN_USES = 5
MIN_SUCCESS = 0.8
MIN_RUN_USES = 3
FIX_WINDOW = 3
MAX_PLACEHOLDERS = 9
PLUMBING = {"ls", "cat", "echo", "cd", "grep", "sed", "head", "tail", "wc", "pwd", "mkdir", "rm", "cp",
            "mv", "touch", "printf", "true", "false", "test", "[", "sleep", "find", "awk", "sort", "uniq",
            "tr", "cut", "xargs", "tee", "which", "export", "set", "for", "while", "if", "callrouter"}
INLINE_PY = re.compile(r"python\S*\s+(-c\b|-\s*<<|<<)")
PY_GROUPS = [
    ("image", r"Image\.open|\.thumbnail\(|\.resize\(|\.crop\(|ImageChops|ImageDraw|getpixel", "img"),
    ("json read and write", r"json\.(dump|dumps)\(.*json\.loads?\(|json\.loads?\(.*json\.(dump|dumps)\(", "json-set"),
    ("json read", r"json\.loads?\(", "json"),
    ("file edit", r"(re\.sub\(|\.replace\().*\.write_text\(|\.write_text\(.*(re\.sub\(|\.replace\()", "replace"),
    ("regex search", r"re\.(findall|search|finditer|match)\(", "find"),
]
ERROR_KIND = re.compile(r"([A-Z]\w+(Error|Exception)\b|command not found|No such file or directory|"
                        r"Permission denied|not recognized as|fatal: [a-z ]{3,40}|error: [a-z ]{3,40})")


def blocks(line):
    try:
        entry = json.loads(line)
    except ValueError:
        return []
    content = (entry.get("message") or {}).get("content") if isinstance(entry, dict) else None
    return content if isinstance(content, list) else []


def result_text(content):
    if isinstance(content, str):
        return content
    return "\n".join(b.get("text", "") for b in content or [] if isinstance(b, dict) and b.get("type") == "text")


def sessions(root):
    """Yield, per transcript, the shell calls in order: (command, failed, output)."""
    for f in sorted(Path(root).rglob("*.jsonl")):
        uses, order, results = {}, [], {}
        with f.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                for b in blocks(line):
                    if b.get("type") == "tool_use" and b.get("name") in ("Bash", "PowerShell"):
                        cmd = (b.get("input") or {}).get("command")
                        if isinstance(cmd, str):
                            uses[b.get("id")] = cmd
                            order.append(b.get("id"))
                    elif b.get("type") == "tool_result" and b.get("tool_use_id") in uses:
                        results[b["tool_use_id"]] = (bool(b.get("is_error")), result_text(b.get("content")))
        yield [(uses[i], *results.get(i, (False, ""))) for i in order]


def py_group(cmd):
    for name, rx, _ in PY_GROUPS:
        if re.search(rx, cmd, re.S):
            return name
    return "no known group"


def template(shape):
    """Turn a shape's S, N and P placeholders into {1}..{9}. None when there are too many."""
    n = 0
    out = []
    for tok in shape.split(" "):
        def bump(_m):
            nonlocal n
            n += 1
            return "{%d}" % n
        if tok in ("S", "P"):
            tok = bump(None)
        else:
            tok = re.sub(r"\bN\b", bump, tok)
        out.append(tok)
    return " ".join(out) if n <= MAX_PLACEHOLDERS else None


def binary(shape):
    return shape.split(" ")[0] if shape else ""


def cid(kind, body):
    return kind[0] + hashlib.sha1(body.encode()).hexdigest()[:10]


def error_kind(output):
    m = ERROR_KIND.search(output or "")
    return m.group(1) if m else None


def mine(root=TRANSCRIPTS):
    groups = Counter()
    shapes = defaultdict(lambda: [0, 0])
    fixes = {}
    n_sessions = n_cmds = 0
    for sess in sessions(root):
        n_sessions += 1
        shaped = []
        for cmd, failed, out in sess:
            n_cmds += 1
            if INLINE_PY.search(cmd):
                groups[py_group(cmd)] += 1
                shaped.append(None)
                continue
            s = calls.shape(cmd)
            shaped.append((s, failed, out))
            shapes[s][0] += 1
            shapes[s][1] += 0 if failed else 1
        for i, item in enumerate(shaped):
            if not item or not item[1]:
                continue
            s, _, out = item
            kind = error_kind(out)
            if not kind:
                continue
            for later in shaped[i + 1:i + 1 + FIX_WINDOW]:
                if later and not later[1] and binary(later[0]) == binary(s) and later[0] != s:
                    key = (binary(s), kind, later[0])
                    fixes.setdefault(key, {"failed_shape": s, "count": 0})["count"] += 1
                    break
    return n_sessions, n_cmds, groups, shapes, fixes


def recipe_candidates(shapes, taken):
    out = []
    for s, (uses, ok) in shapes.items():
        b = binary(s)
        if uses < MIN_USES or ok / uses < MIN_SUCCESS or b in PLUMBING or "<<" in s or "python" in b:
            continue
        body = template(s)
        if not body:
            continue
        words = [w for w in s.split(" ")[:3] if re.fullmatch(r"[a-z][a-z0-9-]{1,15}", w)]
        name = "-".join(words)[:40] or b
        base, k = name, 2
        while name in taken:
            name, k = f"{base}-{k}", k + 1
        taken.add(name)
        out.append({"id": cid("recipe", body), "type": "recipe", "name": name, "body": body,
                    "uses": uses, "success": round(ok / uses, 2)})
    return sorted(out, key=lambda c: -c["uses"])


def hint_candidates(fixes):
    out = []
    for (b, kind, fixed), v in fixes.items():
        text = f"{b} failed with {kind}. A call that worked right after: {fixed}"
        out.append({"id": cid("hint", b + kind + fixed), "type": "hint", "binary": b, "error": kind,
                    "failed_shape": v["failed_shape"], "fixed_shape": fixed, "count": v["count"],
                    "hint": {"id": f"learned-{b}-{kind}"[:60], "when": "fail", "binary": b,
                             "match": re.escape(kind), "hint": text}})
    return sorted(out, key=lambda c: -c["count"])


def run_log_candidates(rows, taken):
    counts = defaultdict(lambda: [0, 0])
    for r in rows:
        if r.get("lane") == "exec":
            counts[r["shape"]][0] += 1
            counts[r["shape"]][1] += r.get("exit") == 0
    return recipe_candidates({s: v for s, v in counts.items() if v[0] >= MIN_RUN_USES}, taken)


def cand_dir():
    return home() / "candidates"


def rejected():
    p = cand_dir() / "rejected.json"
    try:
        return set(json.loads(p.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return set()


def learn(root=TRANSCRIPTS, taken=None):
    """Mine candidates, write them to candidates/, return counts only."""
    n_sessions, n_cmds, groups, shapes, fixes = mine(root)
    taken = set(taken or [])
    skip = rejected()
    recs = [c for c in recipe_candidates(shapes, taken) if c["id"] not in skip]
    recs += [c for c in run_log_candidates(calls.read(), taken) if c["id"] not in skip]
    hints_ = [c for c in hint_candidates(fixes) if c["id"] not in skip]
    cand_dir().mkdir(parents=True, exist_ok=True)
    (cand_dir() / "candidates.json").write_text(json.dumps(recs + hints_, indent=1, ensure_ascii=False),
                                                encoding="utf-8")
    covered = {name: rec for name, _, rec in PY_GROUPS}
    return {
        "transcripts": n_sessions,
        "shell_calls": n_cmds,
        "inline_python_groups": [{"group": g, "scripts": n, "recipe": covered.get(g)}
                                 for g, n in groups.most_common()],
        "recipe_candidates": len(recs),
        "hint_candidates": len(hints_),
        "review": "a person runs: callrouter learn --review",
    }


def agent_env():
    return bool(os.environ.get("AI_AGENT") or os.environ.get("CLAUDECODE")
                or os.environ.get("CLAUDE_CODE_SESSION_ID"))


def review(ask=input, show=print):
    """Walk the candidates with a person. Approved ones become recipes or hints."""
    from callrouter import recipes as store
    if agent_env():
        raise PermissionError("learn --review is for a person. It refuses to run while AI_AGENT or "
                              "CLAUDECODE is set, because candidates come from raw transcripts")
    path = cand_dir() / "candidates.json"
    if not path.is_file():
        return {"approved": 0, "rejected": 0, "left": 0}
    cands = json.loads(path.read_text(encoding="utf-8"))
    skip = rejected()
    approved = rejected_n = 0
    left = []
    for i, c in enumerate(cands):
        if c["type"] == "recipe":
            show(f"\n[{i + 1}/{len(cands)}] recipe {c['name']}  ({c['uses']} uses, {int(100 * c['success'])}% ok)")
            show(f"    {c['body']}")
        else:
            show(f"\n[{i + 1}/{len(cands)}] hint for {c['binary']} on {c['error']}  ({c['count']} times)")
            show(f"    failed: {c['failed_shape']}\n    worked: {c['fixed_shape']}")
        a = ask("    keep? [y]es / [n]o / [s]kip for now / [q]uit: ").strip().lower()
        if a == "q":
            left += cands[i:]
            break
        if a == "y":
            if c["type"] == "recipe":
                store.save(c["name"], c["body"], source="learned")
            else:
                hp = home() / "hints.json"
                try:
                    current = json.loads(hp.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    current = []
                current.append(c["hint"])
                hp.write_text(json.dumps(current, indent=1, ensure_ascii=False), encoding="utf-8")
            approved += 1
        elif a == "n":
            skip.add(c["id"])
            rejected_n += 1
        else:
            left.append(c)
    (cand_dir() / "rejected.json").write_text(json.dumps(sorted(skip)), encoding="utf-8")
    path.write_text(json.dumps(left, indent=1, ensure_ascii=False), encoding="utf-8")
    return {"approved": approved, "rejected": rejected_n, "left": len(left)}
