import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

from metarouter import log
from metarouter.log import config, home, private

START, END = "<!-- metarouter:start -->", "<!-- metarouter:end -->"
BLOCK = f"""{START}
## Tools
Run shell commands through metarouter.
- Look for a saved recipe first: `metarouter search <words>`, then `metarouter run <recipe> ...`.
- Anything else: `metarouter exec -- "<command>"`. Read the short result; it names the full log.
- A command that worked and will be needed again: `metarouter add <name> -- '<command, {{1}} for arguments>'`.
- If metarouter is missing or errors, run the plain command.
{END}"""
CHUNK = ("\n" + BLOCK + "\n").encode("utf-8")
REGION = re.compile(re.escape(START).encode() + rb".*?" + re.escape(END).encode(), re.S)

# name: (user-level file under home, project file, config dir under home)
AGENTS = {
    "claude": (".claude/CLAUDE.md", "CLAUDE.md", ".claude"),
    "codex": (".codex/AGENTS.md", "AGENTS.md", ".codex"),
    "gemini": (".gemini/GEMINI.md", "GEMINI.md", ".gemini"),
    "opencode": (None, "AGENTS.md", ".config/opencode"),
    "cursor": (None, ".cursor/rules/metarouter.mdc", ".cursor"),
    "kiro": (None, ".kiro/steering/metarouter.md", ".kiro"),
    "junie": (None, ".junie/guidelines.md", ".junie"),
    "copilot": (None, ".github/copilot-instructions.md", ".copilot"),
}
SCAN_DAYS = 30
SCAN_TOP = 10


def repo_root():
    here = Path.cwd()
    return next((p for p in (here, *here.parents) if (p / ".git").exists()), here)


def target(agent, project=False):
    user, proj, _ = AGENTS[agent]
    return Path.home() / user if user and not project else repo_root() / proj


def detected():
    return [a for a, (_, _, d) in AGENTS.items() if shutil.which(a) or (Path.home() / d).is_dir()]


def installed_path():
    return home() / "installed.json"


def installed():
    try:
        rows = json.loads(installed_path().read_text(encoding="utf-8"))
        return rows if isinstance(rows, list) else []
    except (OSError, ValueError):
        return []


def save_installed(rows):
    installed_path().parent.mkdir(parents=True, exist_ok=True)
    installed_path().write_text(json.dumps(rows, indent=1), encoding="utf-8")


def write_block(agent, path):
    created = not path.exists()
    old = b"" if created else path.read_bytes()
    if REGION.search(old):
        path.write_bytes(REGION.sub(lambda _: BLOCK.encode("utf-8"), old, count=1))
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(old + CHUNK)
    rows = installed()
    key = path.resolve().as_posix()
    if not any(r.get("path") == key for r in rows):
        rows.append({"agent": agent, "path": key, "created": created})
        save_installed(rows)


def remove_block(row):
    path = Path(row["path"])
    if not path.is_file():
        return f"{row['agent']}: {path.as_posix()} is gone already"
    data = path.read_bytes()
    left = data.replace(CHUNK, b"", 1) if CHUNK in data else REGION.sub(b"", data, count=1)
    if row.get("created") and not left.strip():
        path.unlink()
        return f"{row['agent']}: deleted {path.as_posix()} (init created it)"
    path.write_bytes(left)
    return f"{row['agent']}: removed the block from {path.as_posix()}"


def undo(agent=None, project=False):
    rows = installed()
    if agent:
        key = target(agent, project).resolve().as_posix()
        pick = [r for r in rows if r.get("path") == key]
    else:
        pick = rows
    done = [remove_block(r) for r in pick]
    save_installed([r for r in rows if r not in pick])
    return done


def init(args):
    from metarouter.result import Result
    project = "--project" in args
    names = [a for a in args if not a.startswith("--")]
    if "--undo" in args:
        if names and names[0] not in AGENTS:
            return Result(ok=False, lane="init", exit=2, note=f"no agent {names[0]}. Agents: {', '.join(AGENTS)}")
        done = undo(names[0] if names else None, project)
        return Result(ok=True, lane="init", out=done or "nothing to undo: no block written for that agent")
    if not names:
        found = detected()
        if not found:
            return Result(ok=True, lane="init", out=f"no agent found. Name one: metarouter init <{'|'.join(AGENTS)}>")
        return Result(ok=True, lane="init", out=[f"{a}: metarouter init {a}" for a in found],
                      note="nothing written. Run one of these to add the instruction block")
    if names[0] not in AGENTS:
        return Result(ok=False, lane="init", exit=2, note=f"no agent {names[0]}. Agents: {', '.join(AGENTS)}")
    path = target(names[0], project)
    try:
        write_block(names[0], path)
    except OSError as e:
        return Result(ok=False, lane="init", exit=1, note=f"could not write {path.as_posix()}: {e}")
    return Result(ok=True, lane="init", out=f"wrote the metarouter block to {path.as_posix()}",
                  note=f"undo: metarouter init --undo {names[0]}{' --project' if project else ''}")


def uninstall(args):
    from metarouter.result import Result
    done = undo()
    rm = f'Remove-Item -Recurse -Force "{home()}"' if os.name == "nt" else f'rm -rf "{home().as_posix()}"'
    return Result(ok=True, lane="uninstall", out=done or "no blocks to remove",
                  note=f"recipes, logs and config stay in {home().as_posix()}. To delete them: {rm}")


def scan_marker():
    return home() / "scan.json"


def first_run_tip():
    d = home() / "recipes"
    if scan_marker().exists() or (d.is_dir() and any(d.glob("*.json"))):
        return None
    return "First time? metarouter learn --scan shows what your agent keeps rewriting"


def scan(args):
    import time
    from metarouter import learn
    from metarouter.cli import flag_value
    from metarouter.result import Result
    days = flag_value(args, "--days") or str(SCAN_DAYS)
    if not days.isdigit():
        return Result(ok=False, lane="learn", exit=2, note="--days needs a number")
    root = flag_value(args, "--root") or learn.TRANSCRIPTS
    n_sessions, n_cmds, groups, shapes, *_ = learn.mine(root, since=time.time() - int(days) * 86400)
    counts = {s: v[0] for s, v in shapes.items() if learn.candidate_shape(s) and not private(s)}
    counts.update({f"inline python: {g}": n for g, n in groups.items()})
    top = sorted(((s, n) for s, n in counts.items() if n >= 2), key=lambda x: -x[1])[:SCAN_TOP]
    total = sum(n for _, n in top)
    card = "\n".join([f"metarouter scan, last {days} days",
                      f"{n_sessions} sessions, {n_cmds} shell calls",
                      f"{len(top)} repeated commands ran {total} times",
                      *[f"{n}x  {s}" for s, n in top[:2]]])
    scan_marker().parent.mkdir(parents=True, exist_ok=True)
    scan_marker().write_text(json.dumps({"days": int(days), "sessions": n_sessions}), encoding="utf-8")
    return Result(ok=True, lane="learn", note=log.no_private_warning(), out={
        "total": f"your agent ran these {len(top)} commands {total} times in {days} days",
        "top": [f"{n}x  {s}" for s, n in top],
        "card": card,
        "next": "metarouter learn, then metarouter learn --review",
    })


def check_lines():
    from metarouter import calls, cli
    lines = []

    def line(ok, text):
        lines.append(f"{'ok ' if ok else 'fix'}  {text}")

    v = sys.version_info
    line(v >= (3, 11), f"python {v.major}.{v.minor}" + ("" if v >= (3, 11) else ": needs 3.11 or newer"))
    sh = cli.shell()
    found = shutil.which(sh) or (Path(sh).is_file() and sh)
    line(bool(found), f"shell {found}" if found else "no bash found: install Git Bash or set METAROUTER_SHELL")
    try:
        home().mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=home()):
            pass
        line(True, f"home {home().as_posix()} is writable")
    except OSError as e:
        line(False, f"home {home().as_posix()} is not writable ({e}): set METAROUTER_HOME to a folder you own")
    pats = config().get("private") or []
    line(bool(pats), f"{len(pats)} private patterns" if pats else
         'no private patterns: add "private": ["<regex>"] to ~/.metarouter/config.json')
    set_up = sorted({r["agent"] for r in installed() if Path(r["path"]).is_file()
                     and START.encode() in Path(r["path"]).read_bytes()})
    if set_up:
        line(True, f"init block in: {', '.join(set_up)}")
    else:
        near = detected()
        line(False, f"no agent set up: run metarouter init {near[0] if near else '<agent>'}")
    from metarouter.recipes import engines
    names = list(config().get("engines") or {})
    if not names:
        lines.append('--   no engines configured (optional): "engines": {"gemini": "<script>"} in config.json')
    for n in names:
        try:
            line(True, f"engine {n}: {engines.script(n)}")
        except FileNotFoundError as e:
            line(False, f"engine {n}: {e}")
    try:
        from metarouter.browse.cdp import find_chrome
        line(True, f"chrome {find_chrome()}")
    except FileNotFoundError as e:
        line(False, str(e))
    try:
        line(True, f"call log readable, {len(calls.read())} calls")
    except (OSError, ValueError) as e:
        line(False, f"call log unreadable ({e}): move {home().as_posix()}/calls.jsonl aside")
    try:
        from metarouter.transcripts import adoption
    except ImportError:
        adoption = None
    if adoption is None:
        lines.append("--   adoption: not measured yet")
    else:
        try:
            a = adoption(7)
            lines.append(f"--   adoption, last 7 days: {a.get('share')} of {a.get('shell_calls')} shell calls "
                         f"through metarouter" if isinstance(a, dict) else f"--   adoption: {a}")
        except Exception as e:
            lines.append(f"--   adoption: not measured ({type(e).__name__})")
    return lines


def doctor(args):
    from metarouter.result import Result
    return Result(ok=True, lane="doctor", out="\n".join(check_lines()))
