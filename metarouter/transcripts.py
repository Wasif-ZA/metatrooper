"""Shell calls from each coding agent's saved sessions, as lists of (command, failed, output)."""
import datetime
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path

from metarouter import calls
from metarouter.ingest import touches_private, when
from metarouter.log import private

HOME = Path.home()
ROOTS = {
    "claude": HOME / ".claude" / "projects",
    "codex": HOME / ".codex" / "sessions",
    "gemini": HOME / ".gemini",
    "opencode": HOME / ".local" / "share" / "opencode",
}
EXIT_LINE = re.compile(r"^Exit code: (-?\d+)", re.M)
AGY_EXIT = re.compile(r"exited with code (-?\d+)")
THROUGH = re.compile(r"(^|[;&|]\s*)(\S*[/\\])?metarouter(\.exe)?(\s|$)")
TOP_MISSED = 10


def result_text(content):
    if isinstance(content, str):
        return content
    return "\n".join(b.get("text", "") for b in content or [] if isinstance(b, dict) and b.get("type") == "text")


def cutoff(since):
    """since as an aware datetime: epoch seconds, ISO text or a datetime; None stays None."""
    if since is None or isinstance(since, datetime.datetime):
        return when(since) if since else None
    if isinstance(since, (int, float)):
        return datetime.datetime.fromtimestamp(since, datetime.timezone.utc)
    return when(since)


def fresh(stamp, since):
    """A record is kept unless it carries a time before since."""
    t = when(stamp) if stamp else None
    return since is None or t is None or t >= since


def files(paths, since):
    return [f for f in sorted(paths) if since is None or f.stat().st_mtime >= since.timestamp()]


def lines(f):
    with f.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if isinstance(e, dict):
                yield line, e


def claude(root, since=None):
    since = cutoff(since)
    for f in files(Path(root).rglob("*.jsonl"), since):
        uses, order, results = {}, [], {}
        for line, e in lines(f):
            if touches_private(line):
                order = []
                break
            if not fresh(e.get("timestamp"), since):
                continue
            content = (e.get("message") or {}).get("content")
            for b in content if isinstance(content, list) else []:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use" and b.get("name") in ("Bash", "PowerShell"):
                    cmd = (b.get("input") or {}).get("command")
                    if isinstance(cmd, str):
                        uses[b.get("id")] = cmd
                        order.append(b.get("id"))
                elif b.get("type") == "tool_result" and b.get("tool_use_id") in uses:
                    results[b["tool_use_id"]] = (bool(b.get("is_error")), result_text(b.get("content")))
        yield [(uses[i], *results.get(i, (False, ""))) for i in order]


def codex_output(text):
    """Split a shell_command output ("Exit code: N", "Wall time", "Output:", text) into (failed, text)."""
    m = EXIT_LINE.search(text or "")
    body = text.split("Output:\n", 1)[1] if "Output:\n" in (text or "") else text or ""
    return bool(m and m.group(1) != "0"), body


def codex(root, since=None):
    """Newer rollouts log each command as an item_completed CommandExecution event; older ones as
    shell_command or exec_command function calls paired with their output by call_id."""
    since = cutoff(since)
    for f in files(Path(root).rglob("rollout-*.jsonl"), since):
        events, uses, order, outs, skip = [], {}, [], {}, False
        for _, e in lines(f):
            p = e.get("payload") if isinstance(e.get("payload"), dict) else {}
            if private(str(p.get("cwd") or "")):
                skip = True
                break
            if not fresh(e.get("timestamp"), since):
                continue
            item = p.get("item") if isinstance(p.get("item"), dict) else {}
            if p.get("type") == "item_completed" and item.get("type") == "CommandExecution":
                cmd = item.get("command")
                cmd = cmd[-1] if isinstance(cmd, list) and cmd else cmd
                if not isinstance(cmd, str):
                    continue
                code = item.get("exit_code")
                failed = code != 0 if isinstance(code, int) else item.get("status") == "failed"
                events.append((cmd, failed, item.get("aggregated_output") or ""))
            elif p.get("type") == "function_call" and p.get("name") in ("shell_command", "exec_command"):
                try:
                    args = json.loads(p.get("arguments") or "{}")
                except ValueError:
                    continue
                cmd = args.get("command") or args.get("cmd") if isinstance(args, dict) else None
                cmd = " ".join(cmd) if isinstance(cmd, list) else cmd
                if isinstance(cmd, str):
                    uses[p.get("call_id")] = cmd
                    order.append(p.get("call_id"))
            elif p.get("type") == "function_call_output" and p.get("call_id") in uses:
                out = p.get("output")
                outs[p["call_id"]] = codex_output(out if isinstance(out, str) else result_text(out))
        sess = events or [(uses[i], *outs.get(i, (False, ""))) for i in order]
        if skip or any(private(c) for c, _, _ in sess):
            sess = []
        yield sess


def gemini(root, since=None):
    """Antigravity (agy) brain transcripts: a run_command tool call, then a GENERIC step holding its result.
    Gemini CLI chat folders under tmp/ held no tool calls on the machine this was built on, so they are not read."""
    since = cutoff(since)
    for f in files(Path(root).glob("antigravity*/brain/*/.system_generated/logs/transcript.jsonl"), since):
        sess, pending, skip = [], None, False
        for _, e in lines(f):
            if not fresh(e.get("created_at"), since):
                continue
            tcs = e.get("tool_calls") or []
            if tcs:
                pending = None
                tc = tcs[0] if isinstance(tcs[0], dict) else {}
                args = tc.get("args") if isinstance(tc.get("args"), dict) else {}
                if tc.get("name") == "run_command" and isinstance(args.get("CommandLine"), str):
                    pending = args["CommandLine"]
                    if private(pending) or private(str(args.get("Cwd") or "")):
                        skip = True
                        break
                continue
            if pending is not None and e.get("type") == "GENERIC":
                text = str(e.get("content") or "")
                m = AGY_EXIT.search(text)
                failed = e.get("status") == "ERROR" or "error" in e or bool(m and m.group(1) != "0")
                sess.append((pending, failed, text))
                pending = None
        yield [] if skip else sess


def opencode(root, since=None):
    """opencode.db, read-only: tool parts named bash, in time order per session."""
    since = cutoff(since)
    db = Path(root) / "opencode.db"
    if not db.is_file():
        return
    try:
        con = sqlite3.connect(db.resolve().as_uri() + "?mode=ro", uri=True)
        try:
            dirs = dict(con.execute("select id, directory from session"))
            rows = con.execute("select session_id, time_created, data from part order by session_id, time_created, id").fetchall()
        finally:
            con.close()
    except (sqlite3.Error, OSError):
        return
    by = {}
    for sid, created, data in rows:
        try:
            d = json.loads(data)
        except (TypeError, ValueError):
            continue
        if not isinstance(d, dict) or d.get("type") != "tool" or d.get("tool") != "bash":
            continue
        stamp = datetime.datetime.fromtimestamp(created / 1000, datetime.timezone.utc) if created else None
        if not fresh(stamp, since):
            continue
        st = d.get("state") if isinstance(d.get("state"), dict) else {}
        cmd = (st.get("input") or {}).get("command")
        if not isinstance(cmd, str):
            continue
        code = (st.get("metadata") or {}).get("exit")
        failed = st.get("status") == "error" or (isinstance(code, int) and code != 0)
        by.setdefault(sid, []).append((cmd, failed, str(st.get("output") or "")))
    for sid, sess in by.items():
        yield [] if private(str(dirs.get(sid) or "")) or any(private(c) for c, _, _ in sess) else sess


READERS = {"claude": claude, "codex": codex, "gemini": gemini, "opencode": opencode}


def found(roots=None):
    roots = {**ROOTS, **(roots or {})}
    return [a for a in READERS if Path(roots[a]).exists()]


def parse_from(text):
    """--from claude,codex -> ["claude", "codex"]; raises ValueError on an unknown agent."""
    agents = [a.strip() for a in (text or "").split(",") if a.strip()]
    bad = [a for a in agents if a not in READERS]
    if bad:
        raise ValueError(f"unknown agent {', '.join(bad)}; known: {', '.join(READERS)}")
    return agents


def sessions(agents=None, since=None, roots=None):
    """Yield (agent, session) from each named agent whose folder exists; all found when agents is None."""
    roots = {**ROOTS, **(roots or {})}
    for a in agents or found(roots):
        if Path(roots[a]).exists():
            for sess in READERS[a](roots[a], since):
                yield a, sess


def through(cmd):
    return bool(THROUGH.search(cmd or ""))


def recipe_words(body):
    toks = body.split()
    return toks[0], tuple(t for t in toks[1:] if not re.search(r"\{\d\}", t))


def shape_words(s):
    toks = s.split()
    return toks[0], tuple(t for t in toks[1:] if t not in ("S", "N", "P"))


def adoption(days=7, agents=None, roots=None):
    """Shell calls that went through metarouter against raw ones, and raw shapes a saved recipe already covers."""
    from metarouter import learn, recipes as store
    since = datetime.datetime.now().astimezone() - datetime.timedelta(days=days)
    total = via = 0
    raw = Counter()
    for _, sess in sessions(agents, since, roots):
        for cmd, _, _ in sess:
            total += 1
            if through(cmd):
                via += 1
            elif learn.INLINE_PY.search(cmd):
                raw["inline python: " + learn.py_group(cmd)] += 1
            else:
                raw[calls.shape(cmd)] += 1
    recipes = store.load()
    covers = {"inline python: " + g: rec for g, _, rec in learn.PY_GROUPS if rec in recipes}
    for r in recipes.values():
        if r.get("kind") == "shell" and isinstance(r.get("body"), str) and r["body"].strip() and not private(r["body"]):
            covers.setdefault(recipe_words(r["body"]), r["name"])
    missed = []
    for s, n in raw.most_common():
        name = (covers.get(s) or covers.get(shape_words(s))) if s else None
        if name:
            missed.append({"shape": s, "recipe": name, "count": n})
            if len(missed) == TOP_MISSED:
                break
    return {"shell_calls": total, "through_metarouter": via,
            "share": f"{round(100 * via / total) if total else 0}%", "missed_recipes": missed}
