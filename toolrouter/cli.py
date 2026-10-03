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

from toolrouter import calls, filters, hints, log, shrink, snapshot, tldr
from toolrouter import recipes as store
from toolrouter.result import Result, mode, render

VERBS = {
    "run": "run <recipe> [args]      run a recipe: json, replace, find, img, codex, gemini, local...",
    "exec": "exec [--no-trunc] -- <command>  run a shell command, print a short result, keep the full log",
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
}
GIT_BASH = Path(r"C:\Program Files\Git\bin\bash.exe")
OUT_LIMIT = 8000
STALE_DAYS = 60
HELP_LINES = 60
EXE_EXT = {".exe", ".cmd", ".bat"} if os.name == "nt" else {""}


def shell():
    """Return the bash to run commands with. On Windows, skip WSL's System32 bash."""
    if os.environ.get("TOOLROUTER_SHELL"):
        return os.environ["TOOLROUTER_SHELL"]
    found = shutil.which("bash")
    if os.name == "nt":
        if found and "system32" not in found.lower():
            return found
        if GIT_BASH.exists():
            return str(GIT_BASH)
    return found or "sh"


def command_text(args):
    if args[:1] == ["--"]:
        args = args[1:]
    if len(args) == 1:
        return args[0]
    return shlex.join(args)


def run_shell(cmd):
    """Return (exit, raw bytes, secs). Raises OSError when no shell can start."""
    start = time.monotonic()
    proc = subprocess.run([shell(), "-c", cmd], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
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
        return Result(ok=exit_code == 0, lane=lane, exit=exit_code, secs=secs, out=compact or text,
                      cmd=shown, recipe=recipe, note=f"log not written ({e}); output shown whole")
    r = Result(ok=exit_code == 0, lane=lane, exit=exit_code, secs=secs, lines=len(text.splitlines()),
               bytes=len(raw), log=path.as_posix(), cmd=shown, recipe=recipe)
    filter_match = filters.match(label) if exit_code == 0 and (lane == "exec" or is_shell) else None
    if compact is not None:
        flat = compact if isinstance(compact, str) else json.dumps(compact, ensure_ascii=False)
        if len(flat) <= OUT_LIMIT:
            r.out = compact
        elif isinstance(compact, str):
            r.out = flat[:OUT_LIMIT] + "\n... (cut, full output in the log)"
        else:
            r.out = shrink.json_shape(compact)
            r.note = "too big to print whole: this is its shape. Narrow it with a path, or read the log"
        r.whole = len(flat) <= OUT_LIMIT and (whole or flat.strip() == text.strip())
    elif want is not None:
        try:
            for k, v in shrink.shrink(text, failed=exit_code != 0).items():
                setattr(r, k, v)
            matched = shrink.want(text, want)
            if matched is not None:
                r.out = matched
            else:
                r.out = f"no part of the output matched: {want} ({r.lines} lines; full output in the log)"
            r.whole = False
        except Exception as e:
            r.out, r.errors, r.tail = text, [], []
            r.note = f"shrinker failed ({type(e).__name__}); output shown whole"
    elif filter_match is not None:
        filtered = filters.apply(filter_match, text)
        if len(filtered) <= OUT_LIMIT:
            r.out = filtered
        else:
            r.out = filtered[:OUT_LIMIT] + "\n... (cut, full output in the log)"
        r.note = f"filtered by {filter_match['name']}; full output in the log"
        r.whole = False
    else:
        try:
            for k, v in shrink.shrink(text, failed=exit_code != 0).items():
                setattr(r, k, v)
            r.whole = r.out == text
        except Exception as e:
            r.out, r.errors, r.tail = text, [], []
            r.note = f"shrinker failed ({type(e).__name__}); output shown whole"
    r.rec = calls.record(lane, label, r.exit, secs, r.bytes, path, recipe=recipe)
    try:
        r.hint = hints.match(label, text, failed=exit_code != 0)
        if exit_code != 0:
            r.breaker = hints.breaker(calls.read() + [r.rec], r.rec)
    except Exception:
        pass
    return r


def exec_lane(args):
    cut = args.index("--") if "--" in args else len(args)
    head, tail = args[:cut], args[cut:]
    whole = "--no-trunc" in head
    want = head[head.index("--want") + 1] if "--want" in head[:-1] else None
    drop = {"--no-trunc", "--want", want}
    args = [a for a in head if a not in drop] + tail
    cmd = command_text(args)
    if not cmd.strip():
        return Result(ok=False, lane="exec", exit=2, note='nothing to run. Try: toolrouter exec -- "pytest -q"')
    try:
        code, raw, secs = run_shell(cmd)
    except OSError as e:
        return Result(ok=False, lane="exec", exit=127, cmd=shrink.clip(cmd),
                      note=f"could not start a shell ({e}). Set TOOLROUTER_SHELL to a bash path")
    if whole:
        return finish("exec", cmd, raw, code, secs, compact=shrink.clean(raw.decode("utf-8", errors="replace")))
    r = finish("exec", cmd, raw, code, secs, want=want)
    if not r.whole and not r.note:
        r.note = "shrunk. To read it whole: exec --no-trunc -- <command>"
    return r


def no_recipe(name, recipes):
    near = difflib.get_close_matches(name, list(recipes), n=1)
    tip = f"Did you mean: toolrouter run {store.signature(recipes[near[0]])}" if near else \
        f"Try: toolrouter search {name}"
    return Result(ok=False, lane="run", exit=2, note=f'no recipe "{name}". {tip}')


def run_lane(args):
    if not args:
        return Result(ok=False, lane="run", exit=2, note="which recipe? Try: toolrouter search <words>")
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
        from toolrouter import jobs
        jid = jobs.start(["run", name, *rest, *(["--yes"] if yes else [])], label=name)
        return Result(ok=True, lane="jobs", recipe=name,
                      out={"job": jid, "collect": f"toolrouter jobs {jid} --wait"})
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


def run_engine(r, args):
    from toolrouter.recipes import engines
    name = r["name"]
    try:
        cmd = engines.argv(r, args, shell())
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
    answer = re.split(r"\n-{20,}\nagy-run: ", answer)[0].strip()
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
    from toolrouter import jobs
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
            raise ValueError("which job? List them: toolrouter jobs")
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
        from toolrouter import mcp
        extra += [f"toolrouter mcp {ln}" for ln in mcp.catalog_lines(words, remote=False)[:5]]
        cached_lines = []
        for sname, sdata in sorted(mcp.cached_tools().items()):
            for t in sdata.get("tools", []):
                tname = t.get("name", "")
                tdesc = t.get("description") or ""
                if any(w in tname.lower() or w in tdesc.lower() for w in words):
                    first = tdesc.strip().split("\n")[0].split(". ")[0][:100]
                    cached_lines.append(f"toolrouter mcp {sname} {tname}    {first}".rstrip())
        extra += cached_lines[:5]
        extra += [f"toolrouter tools {b}    installed CLI, shows its --help" for b in path_bins()
                  if any(w in b for w in words)][:5]
    if not found and not extra:
        return Result(ok=False, lane="search", exit=1,
                      note=f'no recipe matches "{" ".join(args)}". Save one: toolrouter add <name> -- "<command>"')
    lines = []
    for n, c in found[:5]:
        r = recipes[n]
        used = f"  ({c} call{'s' if c != 1 else ''} here)" if c else ""
        lines.append(f"toolrouter run {store.signature(r)}\n    {r.get('summary', '')}{used}")
        ex = r.get("example", {}).get("args")
        if ex:
            lines.append(f"    e.g. toolrouter run {n} {shlex.join(ex)}")
    return Result(ok=True, lane="search", out="\n".join(lines + extra))


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
                      note='usage: toolrouter add <name> --step "<command>" --step "<command>" ...')
    try:
        r = store.save(name, steps, summary=opts["summary"], kind="flow", purity=opts["purity"])
    except ValueError as e:
        return Result(ok=False, lane="add", exit=2, note=str(e))
    return Result(ok=True, lane="add", recipe=name,
                  out=f"saved a flow of {len(steps)} steps. Run it: toolrouter run {store.signature(r)}")


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
        return Result(ok=False, lane="add", exit=2, note='usage: toolrouter add <name> [--summary S] -- "<command>"')
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
        return Result(ok=False, lane="add", exit=2, note='usage: toolrouter add <name> [--summary S] -- "<command>"')
    try:
        r = store.save(name, cmd, summary=opts["summary"], purity=opts["purity"])
    except ValueError as e:
        return Result(ok=False, lane="add", exit=2, note=str(e))
    return Result(ok=True, lane="add", recipe=name, out=f"saved. Run it: toolrouter run {store.signature(r)}")


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
    real_home, real_cwd = os.environ.get("TOOLROUTER_HOME"), os.getcwd()
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["TOOLROUTER_HOME"] = str(Path(tmp) / "home")
        try:
            for name in sorted(recipes):
                r = recipes[name]
                ex = r.get("example")
                if r.get("needs") and not shutil.which(r["needs"]):
                    lines.append(f"skip  {name}: {r['needs']} is not installed")
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
                os.environ.pop("TOOLROUTER_HOME", None)
            else:
                os.environ["TOOLROUTER_HOME"] = real_home
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
    from toolrouter.browse import daemon
    from toolrouter.browse.page import host_blocked
    show = "--show" in args
    args = [a for a in args if a != "--show"]
    if not args or args[0] not in BROWSE_VERBS:
        return Result(ok=False, lane="browse", exit=2,
                      note="usage: toolrouter browse open <url> | look | click @n | type @n <text> | read | "
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
        from toolrouter.hook import shrink_image
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
    from toolrouter import mcp
    if args[:1] == ["stop"]:
        from toolrouter import mcp_daemon
        return Result(ok=True, lane="mcp", out=mcp_daemon.stop())
    if args[:1] == ["search"]:
        return Result(ok=True, lane="mcp", out=mcp.catalog_lines(args[1:]))
    if args[:1] == ["import"]:
        return Result(ok=True, lane="mcp", out=mcp.import_servers())
    if not args:
        return Result(ok=True, lane="mcp", out=mcp.catalog_lines(),
                      note="toolrouter mcp <server> lists its tools; toolrouter mcp <server> <tool> '<json>' calls one")
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
    from toolrouter import mcp
    here = calls.project()
    rows = calls.read()
    if args:
        name = args[0]
        for server in mcp.servers():
            try:
                for t in mcp.list_tools(server):
                    if t["name"] == name or f"{server}.{t['name']}" == name:
                        return Result(ok=True, lane="tools", out={"server": server, **t})
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
            more = f"\n...{len(lines) - HELP_LINES} more lines: toolrouter exec -- \"{name} --help\"" \
                if len(lines) > HELP_LINES else ""
            return Result(ok=True, lane="tools", out="\n".join(lines[:HELP_LINES]) + more)
        return Result(ok=True, lane="tools", out=f"{name} is not an MCP tool here. For a CLI try: "
                                                 f"toolrouter exec -- \"{name} --help\"")
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
            out[f"mcp:{server}"] = [mcp.one_line(t) for t in mcp.list_tools(server)]
        except Exception as e:
            out[f"mcp:{server}"] = f"unavailable: {type(e).__name__}: {e}"
    if not out:
        out = "nothing yet: no run calls logged and no servers in servers.json"
    return Result(ok=True, lane="tools", out=out)


def learn_lane(args):
    from toolrouter import learn
    try:
        if "--review" in args:
            return Result(ok=True, lane="learn", out=learn.review())
        root = args[args.index("--root") + 1] if "--root" in args else learn.TRANSCRIPTS
        return Result(ok=True, lane="learn", out=learn.learn(root, taken=store.load()))
    except PermissionError as e:
        return Result(ok=False, lane="learn", exit=2, note=str(e))
    except (IndexError, OSError, ValueError) as e:
        return Result(ok=False, lane="learn", exit=1, note=f"{type(e).__name__}: {e}")


def undo(args):
    try:
        restored = snapshot.restore(args[0] if args else None)
    except (FileNotFoundError, OSError, ValueError) as e:
        return Result(ok=False, lane="undo", exit=1, note=str(e))
    return Result(ok=True, lane="undo", out="restored:\n" + "\n".join(f"  {p}" for p in restored))


def menu():
    lines = ["toolrouter: the agent's tool memory", ""]
    lines += [f"  toolrouter {v}" for v in VERBS.values()]
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
    tip = f"Did you mean: toolrouter {VERBS[near[0]].split('  ')[0]}" if near else "Run toolrouter for the menu."
    return Result(ok=False, lane="menu", exit=2, note=f'no verb "{verb}". {tip}')


LANES = {"run": run_lane, "exec": exec_lane, "search": search_lane, "list": list_lane, "add": add_lane,
         "check": check, "undo": undo, "jobs": jobs_lane, "learn": learn_lane, "browse": browse_lane,
         "mcp": mcp_lane, "tools": tools_lane, "mode": mode_lane}


def log_call(rec):
    if not rec:
        return
    try:
        calls.append(rec)
    except Exception as e:
        print(f"toolrouter: call log not written ({type(e).__name__})", file=sys.stderr)


def main(argv=None):
    how_, argv = mode(list(sys.argv[1:] if argv is None else argv))
    verb, rest = (argv[0], argv[1:]) if argv else (None, [])
    if verb == "ingest":
        from toolrouter import ingest
        return ingest.main(["ingest", *rest], how=how_) or 0
    if verb is None or verb in ("help", "-h", "--help"):
        r = menu()
    elif verb == "learn" and "--review" in rest and how_ == "json":
        r = Result(ok=False, lane="learn", exit=2, note="learn --review is for a person. It refuses to run in JSON or agent mode")
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
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    print(out)
    return r.exit


def entry():
    sys.exit(main())


if __name__ == "__main__":
    entry()
