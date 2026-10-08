import hashlib
import json
import os
import re
import shlex
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

from metarouter import calls, tldr
from metarouter.ingest import touches_private
from metarouter.recipes import engines
from metarouter.log import home, private

TRANSCRIPTS = Path.home() / ".claude" / "projects"
MIN_USES = 5
MIN_SUCCESS = 0.8
MIN_RUN_USES = 3
FIX_WINDOW = 3
MAX_PLACEHOLDERS = 9
PLUMBING = {"ls", "cat", "echo", "cd", "grep", "sed", "head", "tail", "wc", "pwd", "mkdir", "rm", "cp",
            "mv", "touch", "printf", "true", "false", "test", "[", "sleep", "find", "awk", "sort", "uniq",
            "tr", "cut", "xargs", "tee", "which", "export", "set", "for", "while", "if", "metarouter"}
READ_ONLY = re.compile(r"^(git (status|log|diff|show|branch|rev-parse|ls-files|blame|describe|--version)\b|"
                       r"(node|npm|pip|uv|python|docker|kubectl|tectonic|ffprobe) (--version|-v)\b|"
                       r"npm (ls|view|outdated)\b|pip (list|show)\b|docker (ps|images)\b|kubectl get\b)")
WRITE_MARK = re.compile(r">|\btee\b|\bmv |\bcp |git (commit|add|checkout|restore|stash|merge|rebase)\b|"
                        r"\b(install|uninstall|add|kill|taskkill|chmod|mkdir|touch|sed -i)\b")
EXTERNAL = re.compile(r"(^|\|\s*)(curl|wget|gh|ssh|scp|npx)\b")
NAME_NOISE = {"prefix", "dev", "null", "tail", "the"}
FORWARDER = re.compile(r"codex-companion\.mjs|app-server-broker")
CLI_NAME = re.compile(r"^[a-z][a-z0-9._-]*$")
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


def sessions(root, since=None):
    """Yield, per transcript, the shell calls in order: (command, failed, output). Private sessions are skipped."""
    for f in sorted(Path(root).rglob("*.jsonl")):
        if since and f.stat().st_mtime < since:
            continue
        uses, order, results = {}, [], {}
        with f.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if touches_private(line):
                    order = []
                    break
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


def candidate_shape(s):
    b = binary(s)
    return bool(b and CLI_NAME.match(b) and b not in PLUMBING and "<<" not in s and "python" not in b)


def purity_guess(body):
    if any(w in body for w in ("rm ", "rmdir", "git push", "git reset", "git clean", "del ")):
        return "destructive"
    if WRITE_MARK.search(body):
        return "write"
    if EXTERNAL.search(body):
        return "external"
    return "read" if READ_ONLY.match(body) else "write"


def example_for(body, sample):
    if not sample or not body:
        return None
    try:
        sample_tokens = shlex.split(sample, posix=True)
    except ValueError:
        return None
    body_tokens = body.split(" ")
    if len(sample_tokens) != len(body_tokens):
        return None
    args = []
    for i, tok in enumerate(body_tokens):
        if re.fullmatch(r"\{\d+\}", tok):
            args.append(sample_tokens[i])
    placeholders = [int(p) for p in re.findall(r"\{(\d+)\}", body)]
    if placeholders and max(placeholders) != len(args):
        return None
    return {"args": args, "expect_exit": 0, "expect_out": ""}


def flow_candidates(pairs):
    out = []
    for (a, b), n in pairs.items():
        if n < MIN_USES:
            continue
        ta, tb = template(a), template(b)
        if ta is None or tb is None:
            continue
        out.append({"id": cid("flow", a + " && " + b), "type": "flow", "steps": [ta, tb], "uses": n})
    return sorted(out, key=lambda c: -c["uses"])


def mine(root=TRANSCRIPTS, since=None):
    groups = Counter()
    shapes = defaultdict(lambda: [0, 0])
    fixes = {}
    samples = {}
    pairs = Counter()
    runners = engines.scripts()
    n_sessions = n_cmds = 0
    for sess in sessions(root, since):
        n_sessions += 1
        shaped = []
        for cmd, failed, out in sess:
            n_cmds += 1
            if FORWARDER.search(cmd) or any(n in cmd for n in runners):
                shaped.append(None)
                continue
            if INLINE_PY.search(cmd):
                groups[py_group(cmd)] += 1
                shaped.append(None)
                continue
            s = calls.shape(cmd)
            shaped.append((s, failed, out))
            shapes[s][0] += 1
            if not failed:
                shapes[s][1] += 1
                if s not in samples:
                    samples[s] = cmd
        for i, item in enumerate(shaped):
            if not item or item[1]:
                continue
            a = item[0]
            if not candidate_shape(a):
                continue
            seen = set()
            for later in shaped[i + 1:min(i + 4, len(shaped))]:
                if not later or later[1]:
                    break
                b = later[0]
                if a != b and candidate_shape(b) and b not in seen:
                    seen.add(b)
                    pairs[(a, b)] += 1
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
    return n_sessions, n_cmds, groups, shapes, fixes, samples, pairs


def name_of(body):
    """Binary plus the fixed words and long flags that say what it does: curl -s --max-time {1} | head -> curl-max-time-head."""
    words = []
    for t in body.split(" "):
        w = t.lstrip("-").lower()
        if re.fullmatch(r"[a-z][a-z0-9-]{1,15}", w) and w not in words and w not in NAME_NOISE:
            words.append(w)
    return "-".join(words[:4])[:40]


def recipe_candidates(shapes, taken, samples=None):
    samples = samples or {}
    out = []
    for s, val in shapes.items():
        uses, ok = val[0], val[1]
        b = binary(s)
        if uses < MIN_USES or ok / uses < MIN_SUCCESS or b in PLUMBING or "<<" in s or "python" in b:
            continue
        if not CLI_NAME.match(b):
            continue
        body = template(s)
        if not body or not any(not re.fullmatch(r"\{\d\}", t) and not calls.REDIRECT.match(t)
                               for t in body.split(" ")[1:]):
            continue
        name = name_of(body)
        base, k = name, 2
        while name in taken:
            name, k = f"{base}-{k}", k + 1
        taken.add(name)
        cand = {"id": cid("recipe", body), "type": "recipe", "name": name, "body": body,
                "uses": uses, "success": round(ok / uses, 2)}
        sample = samples.get(s) or (val[2] if len(val) > 2 else None)
        if sample:
            cand["sample"] = sample
        out.append(cand)
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
    samples = {}
    for r in rows:
        if r.get("lane") == "exec":
            s = r.get("shape")
            counts[s][0] += 1
            counts[s][1] += r.get("exit") == 0
            if r.get("exit") == 0 and s not in samples and r.get("cmd"):
                samples[s] = r["cmd"]
    return recipe_candidates({s: v for s, v in counts.items() if v[0] >= MIN_RUN_USES}, taken, samples)


def cand_dir():
    return home() / "candidates"


def rejected():
    p = cand_dir() / "rejected.json"
    try:
        return set(json.loads(p.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return set()


def example_exit(cli, cand, ex):
    here = os.getcwd()
    with tempfile.TemporaryDirectory() as tmp:
        os.chdir(tmp)
        try:
            return cli.execute_quiet({"name": cand["name"], "body": cand["body"], "kind": "shell"}, ex["args"])[0]
        except (OSError, ValueError):
            return 1
        finally:
            os.chdir(here)


def learn(root=TRANSCRIPTS, taken=None):
    """Mine candidates, write them to candidates/, return counts only."""
    n_sessions, n_cmds, groups, shapes, fixes, samples, pairs = mine(root)
    taken = set(taken or [])
    skip = rejected()
    recs = [c for c in recipe_candidates(shapes, taken, samples) if c["id"] not in skip]
    recs += [c for c in run_log_candidates(calls.read(), taken) if c["id"] not in skip]
    flows = [c for c in flow_candidates(pairs) if c["id"] not in skip]
    hints_ = [c for c in hint_candidates(fixes) if c["id"] not in skip]
    added = []
    queued_unsafe = 0
    from metarouter import recipes as store
    if store.mode() == "auto":
        from metarouter import cli
        for c in recs:
            purity = purity_guess(c["body"])
            ex = example_for(c["body"], c.get("sample"))
            if purity != "read" or not ex:
                queued_unsafe += 1
                continue
            if private(c["body"]) or any(private(a) for a in ex["args"]):
                continue
            code = example_exit(cli, c, ex)
            if code == 0:
                store.save(c["name"], c["body"], summary=tldr.summary_for(c["body"]),
                           purity=purity, source="learned", example=ex)
                added.append(c["name"])
        recs = [c for c in recs if c["name"] not in added]
    cand_dir().mkdir(parents=True, exist_ok=True)
    (cand_dir() / "candidates.json").write_text(json.dumps(recs + flows + hints_, indent=1, ensure_ascii=False),
                                                encoding="utf-8")
    covered = {name: rec for name, _, rec in PY_GROUPS}
    return {
        "transcripts": n_sessions,
        "shell_calls": n_cmds,
        "inline_python_groups": [{"group": g, "scripts": n, "recipe": covered.get(g)}
                                 for g, n in groups.most_common()],
        "added": added,
        "queued_unsafe": queued_unsafe,
        "recipe_candidates": len(recs),
        "flow_candidates": len(flows),
        "hint_candidates": len(hints_),
        "review": "a person runs: metarouter learn --review",
    }


def agent_env():
    return bool(os.environ.get("AI_AGENT") or os.environ.get("CLAUDECODE")
                or os.environ.get("CLAUDE_CODE_SESSION_ID"))


def review(ask=input, show=print):
    """Walk the candidates with a person. Approved ones become recipes or hints."""
    from metarouter import recipes as store
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
        elif c["type"] == "flow":
            show(f"\n[{i + 1}/{len(cands)}] flow  ({c['uses']} uses)")
            show(f"    flow: {c['steps'][0]} then {c['steps'][1]}")
        else:
            show(f"\n[{i + 1}/{len(cands)}] hint for {c['binary']} on {c['error']}  ({c['count']} times)")
            show(f"    failed: {c['failed_shape']}\n    worked: {c['fixed_shape']}")
        a = ask("    keep? [y]es / [n]o / [s]kip for now / [q]uit: ").strip().lower()
        if a == "q":
            left += cands[i:]
            break
        if a == "y":
            if c["type"] == "recipe":
                store.save(c["name"], c["body"], summary=tldr.summary_for(c["body"]), source="learned")
            elif c["type"] == "flow":
                name = c.get("name")
                if not name:
                    w1, w2 = name_of(c["steps"][0]), name_of(c["steps"][1])
                    name = f"{w1}-{w2}"[:40] if w1 and w2 else (w1 or w2 or "flow")
                if not store.NAME.match(name):
                    name = "flow-" + c["id"][:8]
                try:
                    store.save(name, c["steps"], kind="flow", purity="read", source="learned")
                except Exception:
                    left.append(c)
                    continue
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
