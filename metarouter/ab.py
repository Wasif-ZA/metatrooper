import datetime
import json
import os
import re
import shlex
import shutil
import statistics
import subprocess
import tempfile
import time
from pathlib import Path

from metarouter import log
from metarouter.result import Result

START, END = "<!-- metarouter:start -->", "<!-- metarouter:end -->"
BLOCK = """## Tools
Run shell commands through metarouter.
- Look for a saved recipe first: `metarouter search <words>`, then `metarouter run <recipe> ...`.
- Anything else: `metarouter exec -- "<command>"`. Read the short result; it names the full log.
- A command that worked and will be needed again: `metarouter add <name> -- '<command, {1} for arguments>'`.
- If metarouter is missing or errors, run the plain command."""
AGENTS = {
    "claude": ("CLAUDE.md", ["-p", "--output-format", "json", "--dangerously-skip-permissions"]),
    "codex": ("AGENTS.md", ["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write", "-"]),
}
USER_FILES = {"claude": Path.home() / ".claude" / "CLAUDE.md"}
MARKED = re.compile(re.escape(START) + r".*?" + re.escape(END) + r"\n?", re.S)
TIMEOUT = 1800
FEW_RUNS = 5


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)


def set_block(tree, filename, on):
    path = tree / filename
    text = path.read_text(encoding="utf-8") if path.is_file() else ""
    text = MARKED.sub("", text)
    if on:
        text = f"{text.rstrip()}\n\n{START}\n{BLOCK}\n{END}\n".lstrip()
    if text or path.is_file():
        path.write_text(text, encoding="utf-8")


def parse_claude(stdout):
    """Fields of `claude -p --output-format json`: num_turns, total_cost_usd, usage, is_error."""
    try:
        d = json.loads(stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return {}
    u = d.get("usage") or {}
    keys = ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
    return {"turns": d.get("num_turns"), "tokens": sum(int(u.get(k) or 0) for k in keys) if u else None,
            "cost": d.get("total_cost_usd"), "error": d.get("is_error") or None}


def parse_codex(stdout):
    """Events of `codex exec --json`: turn.completed carries usage, item.completed one item each."""
    tokens, tools, error = None, 0, None
    for line in stdout.splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if not isinstance(e, dict):
            continue
        if e.get("type") == "turn.completed":
            u = e.get("usage") or {}
            tokens = (tokens or 0) + int(u.get("input_tokens") or 0) + int(u.get("output_tokens") or 0)
        elif e.get("type") == "item.completed" and (e.get("item") or {}).get("type") not in ("agent_message", "reasoning"):
            tools += 1
        elif e.get("type") in ("turn.failed", "error"):
            error = (e.get("error") or {}).get("message") or e.get("message") or True
    return {"turns": tools + 1 if tokens is not None else None, "tokens": tokens, "cost": None, "error": error}


def agent_env(agent, run_dir):
    env = {**os.environ, "METAROUTER_HOME": str(run_dir / "metarouter-home")}
    (run_dir / "metarouter-home").mkdir()
    if agent == "codex":
        real = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
        home = run_dir / "codex-home"
        home.mkdir()
        for name in ("auth.json", "config.toml"):
            if (real / name).is_file():
                shutil.copy2(real / name, home / name)
        env["CODEX_HOME"] = str(home)
    return env


def one_run(repo, arm, agent, argv, task, check, shell):
    run_dir = Path(tempfile.mkdtemp(prefix=f"metarouter-ab-{arm}-"))
    tree = run_dir / "tree"
    row = {"arm": arm, "pass": False}
    try:
        made = git(repo, "worktree", "add", "--detach", str(tree), "HEAD")
        if made.returncode:
            raise RuntimeError(f"git worktree add failed: {made.stderr.strip()}")
        set_block(tree, AGENTS[agent][0], arm == "A")
        start = time.monotonic()
        try:
            proc = subprocess.run(argv, input=task, cwd=tree, env=agent_env(agent, run_dir), capture_output=True,
                                  text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT)
            stdout, row["exit"] = proc.stdout or "", proc.returncode
        except subprocess.TimeoutExpired:
            stdout, row["exit"] = "", 124
        row["secs"] = round(time.monotonic() - start, 1)
        row.update((parse_claude if agent == "claude" else parse_codex)(stdout))
        row["pass"] = subprocess.run([shell, "-c", check], cwd=tree, capture_output=True).returncode == 0
    finally:
        git(repo, "worktree", "remove", "--force", str(tree))
        shutil.rmtree(run_dir, ignore_errors=True)
        git(repo, "worktree", "prune")
    return row


def summary(rows):
    passed = [r for r in rows if r["pass"]]
    turns = [r["turns"] for r in rows if r.get("turns") is not None]
    tokens = [r["tokens"] for r in rows if r.get("tokens") is not None]
    costs = [r["cost"] for r in rows if r.get("cost") is not None]
    per = (lambda xs: round(sum(xs) / len(passed), 4) if xs and passed else None)
    return {"runs": len(rows), "passed": len(passed), "pass_rate": round(len(passed) / len(rows), 2) if rows else None,
            "median_turns": statistics.median(turns) if turns else None,
            "tokens_per_pass": per(tokens), "cost_per_pass": per(costs),
            "median_secs": statistics.median(r["secs"] for r in rows if "secs" in r) if rows else None}


def diff(a, b):
    return {k: round(a[k] - b[k], 4) for k in a if k != "runs" and a[k] is not None and b[k] is not None}


def ab_lane(args):
    from metarouter.cli import flag_value, shell
    task, check = flag_value(args, "--task"), flag_value(args, "--check")
    agent = flag_value(args, "--agent") or "claude"
    runs, repo = flag_value(args, "--runs") or "3", Path(flag_value(args, "--repo") or ".").resolve()
    usage = 'usage: metarouter ab --task "<prompt>" --check "<command>" [--agent claude|codex] [--runs 3] [--repo .]'
    if not task or not check or agent not in AGENTS or not runs.isdigit() or int(runs) < 1:
        return Result(ok=False, lane="ab", exit=2, note=usage)
    top = git(repo, "rev-parse", "--show-toplevel")
    if top.returncode or git(repo, "rev-parse", "--verify", "HEAD").returncode:
        return Result(ok=False, lane="ab", exit=2, note=f"{repo.as_posix()} is not a git repo with a commit")
    repo = Path(top.stdout.strip())
    custom = flag_value(args, "--agent-cmd")
    binary = shlex.split(custom) if custom else [shutil.which(agent)] if shutil.which(agent) else None
    if not binary:
        return Result(ok=False, lane="ab", exit=2, note=f"{agent} is not on PATH")
    argv, sh = binary + AGENTS[agent][1], shell()
    rows = []
    for n in range(1, int(runs) + 1):
        for arm in ("A", "B"):
            rows.append({"run": n, **one_run(repo, arm, agent, argv, task, check, sh)})
    a, b = summary([r for r in rows if r["arm"] == "A"]), summary([r for r in rows if r["arm"] == "B"])
    out = {"A (metarouter block)": a, "B (no block, empty home)": b, "A minus B": diff(a, b)}
    now = datetime.datetime.now().astimezone()
    report = log.home() / "ab" / f"{now:%Y%m%dT%H%M%S}.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({"time": now.isoformat(timespec="seconds"), "agent": agent, "task": task,
                                  "check": check, "summary": out, "rows": rows}, indent=1), encoding="utf-8")
    notes = [f"report: {report.as_posix()}", "both arms start from the last commit; uncommitted changes are not copied"]
    if int(runs) < FEW_RUNS:
        notes.append("too few runs to call a difference")
    user = USER_FILES.get(agent)
    if user and user.is_file() and "metarouter" in user.read_text(encoding="utf-8", errors="replace"):
        notes.append(f"{user.as_posix()} mentions metarouter and loads in both arms")
    return Result(ok=True, lane="ab", out=out, note="; ".join(notes))
