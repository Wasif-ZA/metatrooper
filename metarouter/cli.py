import datetime
import difflib
import io
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from metarouter import calls, filters, hints, log, shrink, snapshot, tldr
from metarouter import recipes as store
from metarouter.log import config, private
from metarouter.result import Result, mode, render

VERBS = {
    "run": "run <recipe> [args]      run a recipe: json, replace, find, img, codex, gemini, local...",
    "exec": "exec [--no-trunc] [--strict] [--shell powershell] -- <command>  run a shell command, print a short result, keep the full log",
    "log": "log [last|n] [--grep P] [--tail N]  read part of a saved full output",
    "search": "search <words>          find a recipe by plain words",
    "list": "list                    every recipe, one line each",
    "add": "add <name> -- <cmd>     keep a command that worked as a recipe; {1} {2} mark arguments",
    "check": "check                   run every recipe's example",
    "undo": "undo [snapshot]         put back the files the last write changed",
    "jobs": "jobs [id] [--wait]      list background jobs, or wait for one and show its result",
    "browse": "browse open <url> | look | click @n | type @n <text> | read | shot | close",
    "mcp": "mcp [server] [tool] [json]  list MCP servers, a server's tools, or call one",
    "tools": "tools [name]            CLI tools used here, and each MCP tool in one line",
    "mode": "mode [learn|auto]       learn: approved recipes only; auto: catalogue, PATH CLIs, MCP registry",
    "learn": "learn [--review]        find recipe and hint candidates in the transcripts",
    "ingest": "ingest [--since T]      where tool-result tokens go, from the transcripts",
    "stats": "stats [--days N] [--here]  recipe runs, failures, and hints followed by a success",
    "export": "export [file]           write your saved recipes to one JSON file to share",
    "import": "import <file>           add recipes from an export; existing names are kept",
}
GIT_BASH = Path(r"C:\Program Files\Git\bin\bash.exe")
OUT_LIMIT = 8000
COMPACT_LIMIT = 4000
SEARCH_HITS = 3
LIST_ROWS = 10
STALE_DAYS = 60
HELP_LINES = 60
EXE_EXT = {".exe", ".cmd", ".bat"} if os.name == "nt" else {""}


def bash():
    """Return a bash path, or None. On Windows, skip WSL's System32 bash."""
    found = shutil.which("bash")
    if os.name == "nt":
        if found and "system32" not in found.lower():
            return found
        return str(GIT_BASH) if GIT_BASH.exists() else None
    return found or shutil.which("sh")


def powershell():
    return shutil.which("pwsh") or shutil.which("powershell")


def is_powershell(path):
    return Path(path).stem.lower() in ("pwsh", "powershell")


def shell(force=None):
    """Return the shell to run commands with: METAROUTER_SHELL, config "shell", bash, then PowerShell."""
    if os.environ.get("METAROUTER_SHELL") and not force:
        return os.environ["METAROUTER_SHELL"]
    if (force or config().get("shell")) == "powershell":
        return powershell() or bash() or "sh"
    return bash() or powershell() or "sh"


def command_text(args):
    if args[:1] == ["--"]:
        args = args[1:]
    if len(args) == 1:
        return args[0]
    return shlex.join(args)


def run_shell(cmd, force=None):
    """Return (exit, raw bytes, secs). Raises OSError when no shell can start."""
    sh = shell(force)
    argv = [sh, "-NoProfile", "-Command", cmd] if is_powershell(sh) else [sh, "-c", cmd]
    start = time.monotonic()
    proc = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return proc.returncode, proc.stdout or b"", round(time.monotonic() - start, 1)


def recipe_choices(cmd):
    try:
        code, raw, _ = run_shell(cmd)
        if code == 0:
            return [ln.strip() for ln in raw.decode("utf-8", errors="replace").splitlines() if ln.strip()]
    except OSError:
        pass
    return []


def run_python(recipe, args):
    """Return (exit, compact text, raw bytes for the log, secs, whether compact hides nothing)."""
    start = time.monotonic()
    buf = io.StringIO()
    with redirect_stdout(buf), redirect_stderr(buf):
        try:
            mod = store.module(recipe)
            res = mod.run(args, recipe["name"]) if hasattr(mod, "RECIPES") else mod.run(args)
        except SystemExit as e:
            code = e.code if isinstance(e.code, int) else (0 if e.code is None else 2)
            res = {"exit": code, "out": buf.getvalue()}
        except Exception as e:
            res = {"exit": 1, "out": f"recipe {recipe['name']} crashed: {type(e).__name__}: {e}"}
    out = res.get("out", "")
    text = out if isinstance(out, str) else json.dumps(out, ensure_ascii=False)
    full = res.get("full")
    full = text if full is None else full
    return res.get("exit", 0), out, full.encode("utf-8"), round(time.monotonic() - start, 1), bool(res.get("whole"))


def fill(body, args):
    """Put quoted args into {1}..{9}. With no placeholders, args are appended."""
    used = [int(n) for n in re.findall(r"\{(\d)\}", body)]
    if 0 in used:
        raise ValueError("placeholders start at {1}; {0} is not allowed")
    if not used:
        return " ".join([body, *map(shlex.quote, args)]).strip()
    if max(used) > len(args):
        raise ValueError(f"this recipe needs {max(used)} arguments, got {len(args)}")
    return re.sub(r"\{(\d)\}", lambda m: shlex.quote(args[int(m.group(1)) - 1]), body)


def finish(lane, label, raw, exit_code, secs, recipe=None, compact=None, log_label=None, whole=False, want=None,
           is_shell=False):
    text = shrink.clean(raw.decode("utf-8", errors="replace"))
    shown = shrink.clip(label)
    try:
        path = log.write(log_label or calls.shape(label), raw)
    except OSError as e:
        r = Result(ok=exit_code == 0, lane=lane, exit=exit_code, secs=secs, cmd=shown, recipe=recipe,
                   lines=len(text.splitlines()), bytes=len(raw), note=f"log not written ({e}); rerun with exec --no-trunc for all of it")
        if compact is not None:
            flat = compact if isinstance(compact, str) else json.dumps(compact, ensure_ascii=False)
            r.out = compact if len(flat) <= OUT_LIMIT else shrink.budget(flat)
            return r
        try:
            for k, v in shrink.shrink(text, failed=exit_code != 0).items():
                setattr(r, k, v)
        except Exception:
            r.out = shrink.budget(text)
        return r
    r = Result(ok=exit_code == 0, lane=lane, exit=exit_code, secs=secs, lines=len(text.splitlines()),
               bytes=len(raw), log=path.as_posix(), cmd=shown, recipe=recipe)
    filter_match = filters.match(label) if exit_code == 0 and (lane == "exec" or is_shell) else None
    if len(text) <= shrink.SHORT:
        filter_match = None
    if compact is not None:
        flat = compact if isinstance(compact, str) else json.dumps(compact, ensure_ascii=False)
        limit = OUT_LIMIT if whole else COMPACT_LIMIT
        if len(flat) <= limit:
            r.out = compact
        elif isinstance(compact, str):
            r.out = shrink.budget(flat, limit - shrink.TAIL_CHARS, shrink.TAIL_CHARS)
        else:
            r.out = shrink.json_shape(compact)
            r.note = "too big to print whole: this is its shape. Narrow it with a path, or read the log"
        r.whole = len(flat) <= limit and (whole or flat.strip() == text.strip())
    elif want is not None:
        try:
            for k, v in shrink.shrink(text, failed=exit_code != 0).items():
                setattr(r, k, v)
            matched = shrink.want(text, want)
            if matched is not None:
                r.out = matched
                r.errors = [e for e in r.errors if e not in matched]
                r.tail = [t for t in r.tail if t not in matched]
            else:
                r.out = f"no part of the output matched: {want} ({r.lines} lines; full output in the log)"
            r.whole = False
        except Exception as e:
            r.out, r.errors, r.tail = shrink.budget(text), [], []
            r.note = f"shrinker failed ({type(e).__name__}); head and tail shown"
    elif filter_match is not None:
        filtered = "\n".join(shrink.clip(ln) for ln in filters.apply(filter_match, text).splitlines())
        r.out = shrink.budget(filtered, COMPACT_LIMIT - shrink.TAIL_CHARS, shrink.TAIL_CHARS)
        r.note = f"filtered by {filter_match['name']}; full output in the log"
        r.whole = False
    else:
        try:
            for k, v in shrink.shrink(text, failed=exit_code != 0).items():
                setattr(r, k, v)
            r.whole = r.out == text
        except Exception as e:
            r.out, r.errors, r.tail = shrink.budget(text), [], []
            r.note = f"shrinker failed ({type(e).__name__}); head and tail shown"
    r.rec = calls.record(lane, label, r.exit, secs, r.bytes, path, recipe=recipe)
    try:
        r.hint = hints.match(label, text, failed=exit_code != 0)
        if exit_code != 0:
            r.breaker = hints.breaker(calls.read() + [r.rec], r.rec)
    except Exception:
        pass
    r.rec["hinted"] = bool(r.hint)
    if r.breaker:
        r.rec["breaker"] = True
    return r


def exec_lane(args):
    cut = args.index("--") if "--" in args else len(args)
    head, tail = args[:cut], args[cut:]
    whole = "--no-trunc" in head
    strict = "--strict" in head or bool(config().get("strict"))
    want = head[head.index("--want") + 1] if "--want" in head[:-1] else None
    force = head[head.index("--shell") + 1] if "--shell" in head[:-1] else None
    if force not in (None, "bash", "powershell"):
        return Result(ok=False, lane="exec", exit=2, note=f"--shell is bash or powershell, not {force}")
    drop = {"--no-trunc", "--strict", "--want", want, "--shell", force}
    args = [a for a in head if a not in drop] + tail
    cmd = command_text(args)
    if not cmd.strip():
        return Result(ok=False, lane="exec", exit=2, note='nothing to run. Try: metarouter exec -- "pytest -q"')
    if strict:
        why = hints.stuck(calls.read(), calls.shape(cmd), calls.project(), datetime.datetime.now().astimezone())
        if why:
            return Result(ok=False, lane="exec", exit=3, cmd=shrink.clip(cmd), note=why)
    try:
        code, raw, secs = run_shell(cmd, force) if force else run_shell(cmd)
    except OSError as e:
        return Result(ok=False, lane="exec", exit=127, cmd=shrink.clip(cmd),
                      note=f"could not start a shell ({e}). Set METAROUTER_SHELL to a bash or PowerShell path")
    if whole:
        return finish("exec", cmd, raw, code, secs, compact=shrink.clean(raw.decode("utf-8", errors="replace")),
                      whole=True)
    r = finish("exec", cmd, raw, code, secs, want=want)
    if not r.whole and not r.note:
        r.note = "shrunk; --no-trunc for all"
    return r


def no_recipe(name, recipes):
    near = difflib.get_close_matches(name, list(recipes), n=1)
    tip = f"Did you mean: metarouter run {store.signature(recipes[near[0]])}" if near else \
        f"Try: metarouter search {name}"
    return Result(ok=False, lane="run", exit=2, note=f'no recipe "{name}". {tip}')


def run_lane(args):
    if not args:
        return Result(ok=False, lane="run", exit=2, note="which recipe? Try: metarouter search <words>")
    name, rest = args[0], args[1:]
    yes = "--yes" in rest
    background = "--background" in rest
    rest = [a for a in rest if a not in ("--yes", "--background")]
    recipes = store.load()
    r = recipes.get(name)
    if not r:
        return no_recipe(name, recipes)
    if r.get("purity") == "destructive" and not yes:
        return Result(ok=False, lane="run", exit=2, recipe=name,
                      note=f"{name} is destructive. Run again with --yes to go ahead")
    if background:
        from metarouter import jobs
        jid = jobs.start(["run", name, *rest, *(["--yes"] if yes else [])], label=name)
        return Result(ok=True, lane="jobs", recipe=name,
                      out={"job": jid, "collect": f"metarouter jobs {jid} --wait"})
    label = shlex.join([name, *rest])
    kind = r.get("kind")
    if kind == "engine":
        return run_engine(r, rest)
    if kind == "flow":
        return run_flow(r, rest)
    if kind == "python":
        code, text, raw, secs, whole = run_python(r, rest)
        return finish("run", label, raw, code, secs, recipe=name, compact=text, log_label=name, whole=whole)
    if kind == "shell":
        if r.get("shell") == "bash" and is_powershell(shell()):
            return Result(ok=False, lane="run", exit=2, recipe=name, note=bash_only(name))
        try:
            cmd = fill(r["body"], rest)
            code, raw, secs = run_shell(cmd)
        except ValueError as e:
            if "needs" in str(e):
                choices = r.get("choices") if isinstance(r.get("choices"), dict) else {}
                missing = len(rest) + 1
                if str(missing) in choices:
                    lines = recipe_choices(choices[str(missing)])[:20]
                    if lines:
                        return Result(ok=False, lane="run", exit=2, recipe=name, note=str(e),
                                      out={f"choices for {{{missing}}}": lines})
            return Result(ok=False, lane="run", exit=2, recipe=name, note=str(e))
        except OSError as e:
            return Result(ok=False, lane="run", exit=2, recipe=name, note=str(e))
        whole = bool(r.get("whole")) and code == 0
        res = finish("run", cmd, raw, code, secs, recipe=name, log_label=name, whole=whole,
                     compact=shrink.clean(raw.decode("utf-8", errors="replace")) if whole else None,
                     is_shell=True)
        if not res.ok:
            choices = r.get("choices") if isinstance(r.get("choices"), dict) else {}
            if "1" in choices:
                lines = recipe_choices(choices["1"])
                if lines:
                    val_str = ", ".join(lines[:10])
                    note_line = f"valid values for {{1}}: {val_str}"
                    res.note = f"{res.note.rstrip()}\n{note_line}" if res.note else note_line
        return res
    return Result(ok=False, lane="run", exit=2, recipe=name, note=f'recipe kind "{kind}" is not built yet')


def bash_only(name):
    return (f"{name} uses bash syntax and this machine runs PowerShell. Install Git Bash, "
            f"or set METAROUTER_SHELL to a bash path")


def run_engine(r, args):
    from metarouter.recipes import engines
    name = r["name"]
    try:
        sh = shell()
        cmd = engines.argv(r, args, (bash() or "bash") if is_powershell(sh) else sh)
    except (ValueError, FileNotFoundError) as e:
        return Result(ok=False, lane="run", exit=2, recipe=name, note=str(e))
    env = {**os.environ, "NODE_NO_WARNINGS": "1"}
    start = time.monotonic()
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    except OSError as e:
        return Result(ok=False, lane="run", exit=127, recipe=name, note=f"could not start {cmd[0]}: {e}")
    secs = round(time.monotonic() - start, 1)
    answer = proc.stdout.decode("utf-8", errors="replace").replace("\r\n", "\n")
    stems = "|".join(re.escape(Path(n).stem) for n in engines.scripts())
    if stems:
        answer = re.split(rf"\n-{{20,}}\n(?:{stems}): ", answer)[0]
    answer = answer.strip()
    err = proc.stderr.decode("utf-8", errors="replace").strip()
    if proc.returncode != 0 and err:
        tail = "\n".join(err.splitlines()[-10:])
        answer = f"{answer}\n--- stderr ---\n{tail}" if answer else tail
    try:
        compact = json.loads(answer) if answer[:1] in "[{" else answer
    except ValueError:
        compact = answer
    raw = proc.stdout + (b"\n--- stderr ---\n" + proc.stderr if proc.stderr else b"")
    label = " ".join([name, *(a for a in args if a.startswith("--"))])
    return finish("run", label, raw, proc.returncode, secs, recipe=name, compact=compact, log_label=name)


def jobs_lane(args):
    from metarouter import jobs
    try:
        if not args:
            rows = [{k: j.get(k) for k in ("id", "label", "status", "started", "cwd")} for j in jobs.all_jobs()]
            return Result(ok=True, lane="jobs", out=rows or "no jobs yet")
        timeout = None
        if "--timeout" in args:
            timeout = float(args[args.index("--timeout") + 1])
        values = {args.index("--timeout") + 1} if "--timeout" in args else set()
        ids = [a for i, a in enumerate(args) if not a.startswith("--") and i not in values]
        if not ids:
            raise ValueError("which job? List them: metarouter jobs")
        jid = ids[0]
        s = jobs.wait(jid, timeout) if "--wait" in args else jobs.status(jid)
    except (FileNotFoundError, ValueError, IndexError) as e:
        return Result(ok=False, lane="jobs", exit=2, note=str(e))
    if s["status"] == "done":
        fields = {k: v for k, v in s["result"].items() if k in Result.__dataclass_fields__}
        return Result(**{"lane": "jobs", **fields})
    code = 0 if s["status"] == "running" else 1
    note = "still running" if code == 0 else "the job stopped without a result; its log may say why"
    return Result(ok=code == 0, lane="jobs", exit=code, out={"job": jid, "status": s["status"]}, note=note)


def search_lane(args):
    words = [w.lower() for w in args]
    recipes = store.load()
    ranked = store.rank(recipes, calls.read(), calls.project())

    def hits(r):
        text = " ".join([r["name"], r.get("summary", ""), *r.get("args", [])]).lower()
        return sum(w in text for w in words)

    found = [(n, c) for n, _, c in ranked if not words or hits(recipes[n])]
    found.sort(key=lambda x: -hits(recipes[x[0]]))
    extra = []
    if words and store.mode() == "auto":
        from metarouter import mcp
        extra += [f"metarouter mcp {ln}" for ln in mcp.catalog_lines(words, remote=False)[:5]]
        cached_lines = []
        for sname, sdata in sorted(mcp.cached_tools().items()):
            for t in sdata.get("tools", []):
                tname = t.get("name", "")
                tdesc = t.get("description") or ""
                if any(w in tname.lower() or w in tdesc.lower() for w in words):
                    first = tdesc.strip().split("\n")[0].split(". ")[0][:100]
                    cached_lines.append(f"metarouter mcp {sname} {tname}    {first}".rstrip())
        extra += cached_lines[:5]
        extra += [f"metarouter tools {b}    installed CLI, shows its --help" for b in path_bins()
                  if any(w in b for w in words)][:5]
    if not found and not extra:
        return Result(ok=False, lane="search", exit=1,
                      note=f'no recipe matches "{" ".join(args)}". Save one: metarouter add <name> -- "<command>"')
    lines = []
    for i, (n, c) in enumerate(found[:SEARCH_HITS]):
        r = recipes[n]
        used = f"  ({c} call{'s' if c != 1 else ''} here)" if c else ""
        lines.append(f"metarouter run {store.signature(r)}  {r.get('summary', '')}{used}")
        ex = r.get("example", {}).get("args")
        if ex and i == 0:
            lines.append(f"    e.g. metarouter run {n} {shlex.join(ex)}")
    more = max(0, len(found) - SEARCH_HITS) + max(0, len(extra) - SEARCH_HITS)
    out = lines + extra[:SEARCH_HITS]
    if more > 0:
        out.append(f"+{more} more: add words to narrow")
    return Result(ok=True, lane="search", out="\n".join(out))


def path_bins():
    out = set()
    for d in os.environ.get("PATH", "").split(os.pathsep):
        try:
            for f in Path(d).iterdir():
                if f.suffix.lower() in EXE_EXT and (os.name == "nt" or os.access(f, os.X_OK)):
                    out.add(f.stem.lower())
        except OSError:
            continue
    return sorted(out)


def mode_lane(args):
    if args:
        try:
            store.set_mode(args[0])
        except ValueError as e:
            return Result(ok=False, lane="mode", exit=2, note=str(e))
    m = store.mode()
    what = "seed recipes and the ones you approved" if m == "learn" else \
        "the catalogue, every CLI on PATH, and the public MCP registry as well"
    return Result(ok=True, lane="mode", out=f"{m}: {what}")


def add_flow(args):
    opts = {"summary": None, "purity": "read"}
    steps, name, i = [], None, 0
    while i < len(args):
        if args[i] in ("--step", "--summary", "--purity") and i + 1 < len(args):
            if args[i] == "--step":
                steps.append(args[i + 1])
            else:
                opts[args[i][2:]] = args[i + 1]
            i += 2
            continue
        name = name or args[i]
        i += 1
    if not name or not steps:
        return Result(ok=False, lane="add", exit=2,
                      note='usage: metarouter add <name> --step "<command>" --step "<command>" ...')
    try:
        r = store.save(name, steps, summary=opts["summary"], kind="flow", purity=opts["purity"])
    except ValueError as e:
        return Result(ok=False, lane="add", exit=2, note=str(e))
    return Result(ok=True, lane="add", recipe=name,
                  out=f"saved a flow of {len(steps)} steps. Run it: metarouter run {store.signature(r)}")


def run_flow(r, args):
    recipes = store.load()
    results, code = [], 0
    start = time.monotonic()
    for text in r["body"]:
        try:
            argv = shlex.split(fill(text, args) if re.search(r"\{\d\}", text) else text)
        except ValueError as e:
            results.append({"step": text, "ok": False, "exit": 2, "note": str(e)})
            code = 2
            break
        verb = argv[0] if argv else ""
        if verb not in LANES:
            results.append({"step": text, "ok": False, "exit": 2, "note": f'unknown verb "{verb}"'})
            code = 2
            break
        if verb == "run" and len(argv) > 1 and recipes.get(argv[1], {}).get("kind") == "flow":
            results.append({"step": text, "ok": False, "exit": 2, "note": "a step may not run another flow"})
            code = 2
            break
        sr = LANES[verb](argv[1:])
        log_call(sr.rec)
        entry = {"step": shlex.join(argv), "ok": sr.ok, "exit": sr.exit}
        for k in ("out", "errors", "tail", "note", "hint", "log"):
            v = getattr(sr, k)
            if v not in (None, [], ""):
                entry[k] = v
        results.append(entry)
        if not sr.ok:
            code = sr.exit or 1
            break
    secs = round(time.monotonic() - start, 1)
    raw = json.dumps(results, ensure_ascii=False, indent=1).encode("utf-8")
    return finish("run", r["name"], raw, code, secs, recipe=r["name"], compact=results, log_label=r["name"])


def add_lane(args):
    if "--step" in args:
        return add_flow(args)
    if "--" not in args:
        return Result(ok=False, lane="add", exit=2, note='usage: metarouter add <name> [--summary S] -- "<command>"')
    cut = args.index("--")
    head, cmd = args[:cut], command_text(args[cut:])
    opts = {"summary": None, "purity": "read"}
    name = None
    i = 0
    while i < len(head):
        if head[i] in ("--summary", "--purity") and i + 1 < len(head):
            opts[head[i][2:]] = head[i + 1]
            i += 2
            continue
        name = name or head[i]
        i += 1
    if not name or not cmd.strip():
        return Result(ok=False, lane="add", exit=2, note='usage: metarouter add <name> [--summary S] -- "<command>"')
    try:
        r = store.save(name, cmd, summary=opts["summary"], purity=opts["purity"])
    except ValueError as e:
        return Result(ok=False, lane="add", exit=2, note=str(e))
    return Result(ok=True, lane="add", recipe=name, out=f"saved. Run it: metarouter run {store.signature(r)}")


def compact_schema(tool):
    def strip(v):
        if isinstance(v, dict):
            return {k: strip(x) for k, x in v.items()
                    if k not in ("title", "$schema", "additionalProperties") or isinstance(x, dict)}
        if isinstance(v, list):
            return [strip(x) for x in v]
        return v
    return strip(tool)


def capped(rows, more_cmd, n=LIST_ROWS):
    return rows if len(rows) <= n else rows[:n] + [f"+{len(rows) - n} more: {more_cmd}"]


def list_lane(args):
    recipes = store.load()
    return Result(ok=True, lane="list", out=[f"{store.signature(r)}  ({r.get('source')}) {r.get('summary', '')}"
                                             for _, r in sorted(recipes.items())])


def execute_quiet(r, args):
    """Run a recipe with no log and no call record. Return (exit, output text)."""
    if r.get("kind") == "python":
        code, out, *_ = run_python(r, args)
        return code, out if isinstance(out, str) else json.dumps(out, ensure_ascii=False)
    code, raw, _ = run_shell(fill(r["body"], args))
    return code, raw.decode("utf-8", errors="replace")


def check(args):
    recipes = store.load()
    rows = calls.read()
    lines, failed = [], 0
    real_home, real_cwd = os.environ.get("METAROUTER_HOME"), os.getcwd()
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["METAROUTER_HOME"] = str(Path(tmp) / "home")
        try:
            for name in sorted(recipes):
                r = recipes[name]
                ex = r.get("example")
                if r.get("needs") and not shutil.which(r["needs"]):
                    lines.append(f"skip  {name}: {r['needs']} is not installed")
                    continue
                if r.get("shell") == "bash" and is_powershell(shell()):
                    lines.append(f"skip  {name}: needs bash, this machine runs PowerShell")
                    continue
                if not ex:
                    why = {"engine": "engine, calls an outside model",
                           "flow": "flow, its steps are checked as recipes"}.get(r.get("kind"), "no example")
                    lines.append(f"skip  {name}: {why}")
                    continue
                if r.get("purity") == "destructive":
                    lines.append(f"skip  {name}: destructive, not run by check")
                    continue
                work = Path(tmp) / name
                work.mkdir()
                bad = [fn for fn in ex.get("setup", {}) if not (work / fn).resolve().is_relative_to(work.resolve())]
                if bad:
                    failed += 1
                    lines.append(f"FAIL  {name}: setup file {bad[0]!r} is outside the example folder")
                    continue
                for fn, content in ex.get("setup", {}).items():
                    (work / fn).write_text(content, encoding="utf-8")
                os.chdir(work)
                try:
                    code, text = execute_quiet(r, ex.get("args", []))
                except (OSError, ValueError) as e:
                    code, text = -1, str(e)
                finally:
                    os.chdir(real_cwd)
                want_exit, want_out = ex.get("expect_exit", 0), ex.get("expect_out", "")
                if code == want_exit and want_out in text:
                    lines.append(f"pass  {name}")
                else:
                    failed += 1
                    lines.append(f"FAIL  {name}: exit {code} (wanted {want_exit}), "
                                 f"output {'has' if want_out in text else 'lacks'} {want_out!r}")
        finally:
            if real_home is None:
                os.environ.pop("METAROUTER_HOME", None)
            else:
                os.environ["METAROUTER_HOME"] = real_home
    for flt in filters.load():
        name = flt.get("name", "")
        for t in flt.get("tests", []):
            cmd = t.get("command", "")
            inp = t.get("input", "")
            want = t.get("expected", "")
            matched = filters.match(cmd)
            if matched and matched.get("name") == name:
                got = filters.apply(matched, inp)
            else:
                got = f"command did not match filter {name}"
            if got == want:
                lines.append(f"pass  filter:{name}")
            else:
                failed += 1
                lines.append(f"FAIL  filter:{name}: got {got}")
    cutoff = (datetime.datetime.now().astimezone() - datetime.timedelta(days=STALE_DAYS)).isoformat()
    for name, r in sorted(recipes.items()):
        if r.get("source") in ("seed", "catalog"):
            continue
        last = max((row["time"] for row in rows if row.get("recipe") == name), default=None)
        if last is None or last < cutoff:
            lines.append(f"stale {name}: not used in {STALE_DAYS} days")
    return Result(ok=failed == 0, lane="check", exit=1 if failed else 0, out="\n".join(lines))


BROWSE_VERBS = {"open": 1, "look": 0, "click": 1, "type": 2, "read": 0, "shot": 0, "back": 0, "tabs": 0,
                "close": 0}


def browse_lane(args):
    from metarouter.browse import daemon
    from metarouter.browse.page import host_blocked
    show = "--show" in args
    args = [a for a in args if a != "--show"]
    if not args or args[0] not in BROWSE_VERBS:
        return Result(ok=False, lane="browse", exit=2,
                      note="usage: metarouter browse open <url> | look | click @n | type @n <text> | read | "
                           "shot [--full] | back | tabs | close")
    verb, rest = args[0], args[1:]
    if len(rest) < BROWSE_VERBS[verb]:
        return Result(ok=False, lane="browse", exit=2, note=f"browse {verb} needs {BROWSE_VERBS[verb]} argument(s)")
    if verb == "open" and host_blocked(rest[0], daemon.blocked_hosts()):
        return Result(ok=False, lane="browse", exit=2, note=f"{rest[0]} is on the blocked-hosts list")
    if verb == "close" and not daemon.state_path().is_file():
        return Result(ok=True, lane="browse", out={"closed": True, "note": "no browser was running"})
    start = time.monotonic()
    try:
        reply = daemon.call(verb, rest, daemon.ensure(show))
    except Exception as e:
        return Result(ok=False, lane="browse", exit=1, note=f"browser unavailable: {type(e).__name__}: {e}")
    secs = round(time.monotonic() - start, 1)
    if not reply.get("ok"):
        return Result(ok=False, lane="browse", exit=1, secs=secs, note=reply.get("error"))
    res = reply["result"]
    if verb == "shot":
        from metarouter.hook import shrink_image
        small = shrink_image(Path(res["shot"]), cache=log.home() / "img")
        res["shrunk"] = Path(small).as_posix() if small else res["shot"]
    raw = json.dumps(res, ensure_ascii=False, indent=1).encode("utf-8")
    compact = res
    if verb == "read":
        compact = {"url": res["url"], "text": res["text"]}
    return finish("browse", f"browse {verb}", raw, 0, secs, compact=compact, log_label=f"browse-{verb}")


def parse_mcp_arg(v):
    try:
        return json.loads(v)
    except ValueError:
        return v


def mcp_lane(args):
    from metarouter import mcp
    if args[:1] == ["stop"]:
        from metarouter import mcp_daemon
        return Result(ok=True, lane="mcp", out=mcp_daemon.stop())
    if args[:1] == ["search"]:
        return Result(ok=True, lane="mcp", out=mcp.catalog_lines(args[1:]))
    if args[:1] == ["import"]:
        return Result(ok=True, lane="mcp", out=mcp.import_servers())
    if not args:
        return Result(ok=True, lane="mcp", out=mcp.catalog_lines(),
                      note="metarouter mcp <server> lists its tools; metarouter mcp <server> <tool> '<json>' calls one")
    if len(args) == 1:
        try:
            return Result(ok=True, lane="mcp", out=[mcp.one_line(t) for t in mcp.list_tools(args[0])])
        except KeyError as e:
            return Result(ok=False, lane="mcp", exit=1, note=e.args[0])
        except (OSError, RuntimeError, TimeoutError, ConnectionError) as e:
            return Result(ok=False, lane="mcp", exit=1, note=str(e))
    server, tool = args[0], args[1]
    extra = args[2:]
    if len(extra) == 1 and extra[0].startswith("{"):
        try:
            params = json.loads(extra[0])
            if not isinstance(params, dict):
                raise ValueError("arguments must be a JSON object")
        except ValueError as e:
            return Result(ok=False, lane="mcp", exit=2, note=f"bad JSON arguments: {e}")
    else:
        params = {}
        for a in extra:
            if "=" not in a:
                return Result(ok=False, lane="mcp", exit=2, note="arguments are key=value or one JSON object")
            k, v = a.split("=", 1)
            params[k] = parse_mcp_arg(v)
    start = time.monotonic()
    try:
        res = mcp.call_tool(server, tool, params)
    except KeyError as e:
        return Result(ok=False, lane="mcp", exit=1, note=e.args[0])
    except (OSError, RuntimeError, TimeoutError, ConnectionError) as e:
        return Result(ok=False, lane="mcp", exit=1, note=str(e))
    secs = round(time.monotonic() - start, 1)
    code = 1 if res.get("isError") else 0
    raw = json.dumps(res, ensure_ascii=False, indent=1).encode("utf-8")
    return finish("mcp", f"mcp {server} {tool}", raw, code, secs, compact=mcp.text_of(res),
                  log_label=f"mcp-{server}-{tool}")


def tools_lane(args):
    from metarouter import mcp
    here = calls.project()
    rows = calls.read()
    if args:
        name = args[0]
        for server in mcp.servers():
            try:
                for t in mcp.list_tools(server):
                    if t["name"] == name or f"{server}.{t['name']}" == name:
                        return Result(ok=True, lane="tools", out={"server": server, **compact_schema(t)})
            except Exception:
                continue
        exe = shutil.which(name)
        if exe and store.mode() == "auto":
            text = tldr.page(name)
            if text is not None:
                return Result(ok=True, lane="tools", out=text)
            try:
                p = subprocess.run([exe, "--help"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=15)
            except (OSError, subprocess.TimeoutExpired) as e:
                return Result(ok=False, lane="tools", exit=1, note=f"{name} --help failed: {e}")
            lines = p.stdout.decode("utf-8", errors="replace").splitlines()
            more = f"\n...{len(lines) - HELP_LINES} more lines: metarouter exec -- \"{name} --help\"" \
                if len(lines) > HELP_LINES else ""
            return Result(ok=True, lane="tools", out="\n".join(lines[:HELP_LINES]) + more)
        return Result(ok=True, lane="tools", out=f"{name} is not an MCP tool here. For a CLI try: "
                                                 f"metarouter exec -- \"{name} --help\"")
    out = {}
    bins = {}
    for r in rows:
        b = (r.get("shape") or "").split(" ")[0]
        if r.get("lane") == "exec" and b:
            local, total = bins.get(b, (0, 0))
            bins[b] = (local + (r.get("project") == here and r.get("exit") == 0), total + 1)
    if bins:
        out["cli"] = [f"{b}  ({n} calls, {k} ok here)" for b, (k, n) in
                      sorted(bins.items(), key=lambda x: (-x[1][0], -x[1][1]))[:30]]
    for server in sorted(mcp.servers()):
        try:
            out[f"mcp:{server}"] = capped([mcp.one_line(t) for t in mcp.list_tools(server)],
                                          f"metarouter mcp {server}")
        except Exception as e:
            out[f"mcp:{server}"] = f"unavailable: {type(e).__name__}: {e}"
    if not out:
        out = "nothing yet: no run calls logged and no servers in servers.json"
    return Result(ok=True, lane="tools", out=out)


def learn_lane(args):
    from metarouter import learn
    try:
        if "--review" in args:
            return Result(ok=True, lane="learn", out=learn.review())
        root = args[args.index("--root") + 1] if "--root" in args else learn.TRANSCRIPTS
        return Result(ok=True, lane="learn", out=learn.learn(root, taken=store.load()),
                      note=log.no_private_warning())
    except PermissionError as e:
        return Result(ok=False, lane="learn", exit=2, note=str(e))
    except (IndexError, OSError, ValueError) as e:
        return Result(ok=False, lane="learn", exit=1, note=f"{type(e).__name__}: {e}")


def flag_value(args, flag):
    return args[args.index(flag) + 1] if flag in args[:-1] else None


def log_lane(args):
    pattern, tail = flag_value(args, "--grep"), flag_value(args, "--tail")
    refs = [a for a in args if not a.startswith("--") and a not in (pattern, tail)]
    ref = refs[0] if refs else "last"
    rows = [r for r in calls.read() if r.get("log") and not private(str(r.get("project") or ""))]
    me = calls.agent()
    rows = [r for r in rows if r.get("agent") == me] or rows
    logs = (log.home() / "logs").resolve()
    if Path(ref).is_file():
        path = Path(ref)
        if not path.resolve().is_relative_to(logs):
            return Result(ok=False, lane="log", exit=2, note=f"log reads only saved outputs under {logs.as_posix()}")
    elif ref == "last" or ref.isdigit():
        n = 1 if ref == "last" else int(ref)
        if n < 1 or n > len(rows):
            return Result(ok=False, lane="log", exit=2, note=f"no saved output number {ref}; {len(rows)} saved")
        path = Path(rows[-n]["log"])
    else:
        return Result(ok=False, lane="log", exit=2, note="usage: metarouter log [last|<n>|<path>] [--grep P] [--tail N]")
    try:
        text = shrink.clean(path.read_bytes().decode("utf-8", errors="replace"))
    except OSError as e:
        return Result(ok=False, lane="log", exit=1, note=f"could not read {path}: {e}")
    lines = text.splitlines()
    if pattern:
        try:
            rx = re.compile(pattern, re.I)
        except re.error as e:
            return Result(ok=False, lane="log", exit=2, note=f"bad --grep pattern: {e}")
        lines = [f"{i}: {ln}" for i, ln in enumerate(lines, 1) if rx.search(ln)]
        if not lines:
            return Result(ok=True, lane="log", log=path.as_posix(), out=f"no line matches {pattern}")
    if tail:
        if not tail.isdigit():
            return Result(ok=False, lane="log", exit=2, note="--tail needs a number of lines")
        lines = lines[-int(tail):]
    out = "\n".join(shrink.clip(ln) for ln in lines)
    return Result(ok=True, lane="log", log=path.as_posix(), lines=len(lines),
                  out=shrink.budget(out, OUT_LIMIT - shrink.TAIL_CHARS, shrink.TAIL_CHARS))


RECOVER_WITHIN = 3


def stats_lane(args):
    rows = [r for r in calls.read() if not private(str(r.get("project") or "")) and not private(r.get("recipe") or "")]
    days = flag_value(args, "--days")
    if days:
        if not days.isdigit():
            return Result(ok=False, lane="stats", exit=2, note="--days needs a number")
        cutoff = (datetime.datetime.now().astimezone() - datetime.timedelta(days=int(days))).isoformat()
        rows = [r for r in rows if r.get("time", "") >= cutoff]
    if "--here" in args:
        here = calls.project()
        rows = [r for r in rows if r.get("project") == here]
    if not rows:
        return Result(ok=True, lane="stats", out="no calls logged yet")
    per = {}
    for r in rows:
        if r.get("recipe"):
            n, bad = per.get(r["recipe"], (0, 0))
            per[r["recipe"]] = (n + 1, bad + (r.get("exit") != 0))
    hinted = recovered = 0
    tracked = sum("hinted" in r for r in rows)
    for i, r in enumerate(rows):
        if not r.get("hinted"):
            continue
        hinted += 1
        tool = hints.breaker_key(r)
        later = [x for x in rows[i + 1:] if x.get("project") == r.get("project") and x.get("agent") == r.get("agent")]
        if any(hints.breaker_key(x) == tool and x.get("exit") == 0 for x in later[:RECOVER_WITHIN]):
            recovered += 1
    shown = [r for r in rows if "shown_bytes" in r]
    kept = sum(max(0, r.get("bytes", 0) - r["shown_bytes"]) for r in shown) // 4
    out = {
        "calls": len(rows),
        "failed": sum(r.get("exit") != 0 for r in rows),
        "recipes": [f"{n}: {c} runs, {b} failed" for n, (c, b) in sorted(per.items(), key=lambda x: -x[1][0])[:LIST_ROWS]],
        "hints": f"{hinted} shown in {tracked} calls that record hints, {recovered} followed by a success of the "
                 f"same tool within {RECOVER_WITHIN} calls",
        "breaker": f"{sum(bool(r.get('breaker')) for r in rows)} warnings",
        "output_kept_out": f"about {kept:,} tokens of output not printed (bytes / 4). This is not money saved: "
                           f"cached reads are cheap and an extra turn can cost more",
    }
    return Result(ok=True, lane="stats", out=out)


def strings(v):
    """Every string inside a nested dict or list."""
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for x in v.values():
            yield from strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from strings(x)


def export_lane(args):
    mine = [r for r in store.load().values() if r.get("source") not in ("seed", "catalog")]
    if not mine:
        return Result(ok=False, lane="export", exit=1, note='no saved recipes yet. Save one: metarouter add <name> -- "<command>"')
    flagged = [r["name"] for r in mine if any(private(x) for x in strings(r))]
    keep = [r for r in mine if r["name"] not in flagged]
    path = Path(args[0]) if args else Path("metarouter-recipes.json")
    path.write_text(json.dumps({"metarouter_recipes": 1, "recipes": keep}, indent=1, ensure_ascii=False),
                    encoding="utf-8")
    note = f"left out {len(flagged)} matching a private pattern: {', '.join(flagged)}" if flagged else None
    return Result(ok=True, lane="export", out=f"wrote {len(keep)} recipes to {path.as_posix()}. Read it before "
                                              f"sharing: literal paths and values in a body go with it", note=note)


def import_lane(args):
    if not args:
        return Result(ok=False, lane="import", exit=2, note="usage: metarouter import <file>")
    try:
        data = json.loads(Path(args[0]).read_text(encoding="utf-8"))
        incoming = data["recipes"] if isinstance(data, dict) else None
        if not isinstance(incoming, list):
            raise ValueError("not a metarouter export: no recipes list")
    except (OSError, ValueError, KeyError) as e:
        return Result(ok=False, lane="import", exit=2, note=f"could not read {args[0]}: {e}")
    have = store.load()
    added, kept, bad = [], [], []
    for r in incoming:
        name = r.get("name") if isinstance(r, dict) else None
        if not name or r.get("kind") not in ("shell", "flow"):
            bad.append(str(name))
            continue
        if name in have:
            kept.append(name)
            continue
        try:
            store.save(name, r["body"], summary=r.get("summary"), kind=r["kind"], purity=r.get("purity", "read"),
                       source="import", example=r.get("example"))
            body = r["body"] if isinstance(r["body"], str) else " && ".join(r["body"])
            added.append(f"{name}: {shrink.clip(body)}")
        except (ValueError, KeyError) as e:
            bad.append(f"{name} ({e})")
    out = {"added": added, "kept existing": kept, "skipped": bad}
    return Result(ok=bool(added) or not bad, lane="import", exit=0 if added or not bad else 1,
                  out={k: v for k, v in out.items() if v} or "nothing to import")


def undo(args):
    try:
        restored = snapshot.restore(args[0] if args else None)
    except (FileNotFoundError, OSError, ValueError) as e:
        return Result(ok=False, lane="undo", exit=1, note=str(e))
    return Result(ok=True, lane="undo", out="restored:\n" + "\n".join(f"  {p}" for p in restored))


def menu():
    lines = ["metarouter: the agent's tool memory", ""]
    lines += [f"  metarouter {v}" for v in VERBS.values()]
    try:
        recipes = store.load()
        top = store.rank(recipes, calls.read(), calls.project())[:5]
        lines += ["", "recipes:"] + [f"  {store.signature(recipes[n])}" for n, _, _ in top]
    except Exception:
        pass
    lines += ["", "  --json or --human forces the output style."]
    return Result(ok=True, lane="menu", out="\n".join(lines))


def unknown(verb):
    near = difflib.get_close_matches(verb, list(VERBS), n=1)
    tip = f"Did you mean: metarouter {VERBS[near[0]].split('  ')[0]}" if near else "Run metarouter for the menu."
    return Result(ok=False, lane="menu", exit=2, note=f'no verb "{verb}". {tip}')


LANES = {"run": run_lane, "exec": exec_lane, "search": search_lane, "list": list_lane, "add": add_lane,
         "check": check, "undo": undo, "jobs": jobs_lane, "learn": learn_lane, "browse": browse_lane,
         "mcp": mcp_lane, "tools": tools_lane, "mode": mode_lane, "log": log_lane, "stats": stats_lane,
         "export": export_lane, "import": import_lane}


def log_call(rec):
    if not rec:
        return
    try:
        calls.append(rec)
    except Exception as e:
        print(f"metarouter: call log not written ({type(e).__name__})", file=sys.stderr)


def main(argv=None):
    how_, argv = mode(list(sys.argv[1:] if argv is None else argv))
    verb, rest = (argv[0], argv[1:]) if argv else (None, [])
    if verb == "ingest":
        from metarouter import ingest
        return ingest.main(["ingest", *rest], how=how_) or 0
    if verb is None or verb in ("help", "-h", "--help"):
        r = menu()
    elif verb == "learn" and "--review" in rest and how_ == "json":
        r = Result(ok=False, lane="learn", exit=2, note="learn --review is for a person. It refuses to run in JSON or agent mode")
    elif verb == "import" and how_ == "json":
        r = Result(ok=False, lane="import", exit=2, note="import adds commands an agent will run. A person runs it, "
                                                          "not JSON or agent mode")
    elif verb in LANES:
        try:
            r = LANES[verb](rest)
        except Exception as e:
            r = Result(ok=False, lane=verb, exit=1, note=f"{verb} crashed: {type(e).__name__}: {e}")
    else:
        r = unknown(verb)
    out = render(r, how_)
    if r.rec:
        log_call({**r.rec, "shown_bytes": len(out.encode("utf-8"))})
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", newline="\n")
    except (AttributeError, ValueError):
        pass
    print(out)
    return r.exit


def entry():
    sys.exit(main())


if __name__ == "__main__":
    entry()
