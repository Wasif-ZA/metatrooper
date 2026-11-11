import datetime
import difflib
import importlib
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

from metarouter import calls, filters, hints, log, shield, shrink
from metarouter import recipes as store
from metarouter.log import config, private
from metarouter.result import Result, mode, render

VERBS = {
    "run": "run <recipe> [args] [--no-trunc]  run a recipe: find, replace, page, repo, or one you saved",
    "exec": "exec [--no-trunc] [--strict] [--shell powershell] -- <command> | --file <script> | --stdin  run a shell command, print a short result, keep the full log",
    "log": "log [last|n] [--grep P] [--tail N]  read part of a saved full output",
    "search": "search <words>          find a recipe by plain words",
    "list": "list                    every recipe, one line each",
    "add": "add <name> [--project] -- <cmd>  keep a command that worked as a recipe; {1} {2} mark arguments",
    "check": "check [--project]       run every recipe's example; --project: this repo's, for CI",
    "undo": "undo [snapshot]         put back the files the last write changed",
    "tools": "tools [name]            CLI tools used here; with a name, its --help",
    "mode": "mode [learn|auto]       learn: approved recipes only; auto: also repo scripts and PATH CLIs",
    "stats": "stats [--days N] [--here]  recipe runs, failures, hints",
    "export": "export [file]           write your saved recipes to one JSON file to share",
    "import": "import <file>           add recipes from an export; existing names are kept",
    "ab": 'ab --task "<prompt>" --check "<cmd>" --yes [--agent claude|codex] [--runs 3]  measure an agent with and without metarouter',
    "init": "init [agent] [--project] [--undo]  add the instruction block to an agent's file; no agent lists them",
    "uninstall": "uninstall               remove every block init wrote",
    "doctor": "doctor                  check the setup, one line each with the fix",
}
GIT_BASH = Path(r"C:\Program Files\Git\bin\bash.exe")
OUT_LIMIT = 8000
COMPACT_LIMIT = 4000
SEARCH_HITS = 3
LIST_ROWS = 10
STALE_DAYS = 60
BREAKER_ROWS = 200
VALUE_FLAGS = ("--want", "--shell", "--file")
HIDDEN = False
RUNNER_FLAGS = ("--no-trunc", "--strict", "--stdin", *VALUE_FLAGS)
HELP_LINES = 60
EXE_EXT = {".exe", ".cmd", ".bat"} if os.name == "nt" else {""}
SCRIPT_DIRS = ("scripts", "meta/scripts", "bin", "")
SHELL_WORDS = {"cd", "for", "while", "if", "do", "export", "set", "source", ".", "eval", "exec", "echo", "true",
               "false", "[", "test", "(", "{"}
SCRIPT_EXT = (".sh", ".py", ".js", ".cjs", ".mjs", ".ps1")


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


def run_shell(cmd, force=None, file=None):
    """Return (exit, raw bytes, secs). With file, bash runs the script file. Raises OSError when no shell can start."""
    sh = bash() if file else shell(force)
    if file and not sh:
        raise OSError("bash required to run a script file")
    if is_powershell(sh):
        argv = [sh, "-NoProfile", "-Command", cmd]
    else:
        argv = [sh, file] if file else [sh, "-c", cmd]
    start = time.monotonic()
    proc = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          stdin=subprocess.DEVNULL if file else None)
    return proc.returncode, proc.stdout or b"", round(time.monotonic() - start, 1)


def run_argv(argv):
    """Run argv with no shell in between. Return (exit, raw bytes, secs)."""
    start = time.monotonic()
    proc = subprocess.run([shutil.which(argv[0]) or argv[0], *argv[1:]], stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT)
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


def finish(*args, **kw):
    return shield.guard(build(*args, **kw))


def build(lane, label, raw, exit_code, secs, recipe=None, compact=None, log_label=None, whole=False, want=None,
          is_shell=False, cap=True):
    text = shrink.clean(raw.decode("utf-8", errors="replace"))
    shown = shrink.clip(label)
    path, why = None, None
    if not (HIDDEN or private(label) or private(os.getcwd())):
        try:
            path = log.write(log_label or calls.shape(label), shield.mask_bytes(raw))
        except OSError as e:
            why = f"log not written ({e})"
    if path is None:
        r = Result(ok=exit_code == 0, lane=lane, exit=exit_code, secs=secs, cmd=shown, recipe=recipe,
                   lines=len(text.splitlines()), bytes=len(raw))
        if compact is not None:
            flat = compact if isinstance(compact, str) else json.dumps(compact, ensure_ascii=False)
            r.whole = not cap or len(flat) <= OUT_LIMIT
            r.out = compact if r.whole else shrink.budget(flat)
        else:
            try:
                for k, v in shrink.shrink(text, failed=exit_code != 0).items():
                    setattr(r, k, v)
            except Exception:
                r.out = shrink.budget(text)
            r.whole = r.out == text
        if not r.whole:
            why = f"{why or 'private: no log kept'}; rerun with exec --no-trunc for all of it"
        r.note = why
        return r
    r = Result(ok=exit_code == 0, lane=lane, exit=exit_code, secs=secs, lines=len(text.splitlines()),
               bytes=len(raw), log=path.as_posix(), cmd=shown, recipe=recipe)
    filter_match = filters.match(label) if exit_code == 0 and (lane == "exec" or is_shell) else None
    if len(text) <= shrink.SHORT:
        filter_match = None
    if compact is not None:
        flat = compact if isinstance(compact, str) else json.dumps(compact, ensure_ascii=False)
        limit = (OUT_LIMIT if cap else float("inf")) if whole else COMPACT_LIMIT
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
        found = hints.find(label, text, failed=exit_code != 0)
        r.hint = found and found["hint"]
        r.rec["hint"] = found and found.get("id")
        if exit_code != 0:
            r.breaker = hints.breaker(calls.read(tail=BREAKER_ROWS) + [r.rec], r.rec)
    except Exception:
        pass
    if r.breaker:
        r.rec["breaker"] = True
    return r


def exec_lane(args, argv=None):
    i, opts, file, from_stdin = 0, [], None, False
    while i < len(args) and args[i] in RUNNER_FLAGS:
        n = 2 if args[i] in VALUE_FLAGS else 1
        if args[i] == "--file":
            file = args[i + 1] if i + 1 < len(args) else ""
        elif args[i] == "--stdin":
            from_stdin = True
        else:
            opts += args[i:i + n]
        i += n
    if file is None and not from_stdin:
        return exec_text(args, argv)
    if not bash():
        return Result(ok=False, lane="exec", exit=127, note="bash required to run a script: install Git Bash "
                                                            "or put bash on PATH")
    if file is not None:
        try:
            cmd = Path(file).read_bytes().decode("utf-8", errors="replace")
        except OSError as e:
            return Result(ok=False, lane="exec", exit=2, note=f"could not read {file} ({e})")
        return exec_text(opts, argv, cmd=cmd, file=file)
    data = sys.stdin.buffer.read()
    data = data[:-1] if data.endswith(b"\n") else data
    fd, tmp = tempfile.mkstemp(prefix="metarouter-", suffix=".sh")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        return exec_text(opts, argv, cmd=data.decode("utf-8", errors="replace"), file=tmp)
    finally:
        try:
            Path(tmp).unlink(missing_ok=True)
        except OSError:
            pass


def exec_text(args, argv=None, cmd=None, file=None):
    cut = args.index("--") if "--" in args else len(args)
    head, tail = args[:cut], args[cut:]
    whole = "--no-trunc" in head
    strict = "--strict" in head or bool(config().get("strict"))
    want = head[head.index("--want") + 1] if "--want" in head[:-1] else None
    force = head[head.index("--shell") + 1] if "--shell" in head[:-1] else None
    if force not in (None, "bash", "powershell"):
        return Result(ok=False, lane="exec", exit=2, note=f"--shell is bash or powershell, not {force}")
    values = {i + 1 for i, a in enumerate(head[:-1]) if a in ("--want", "--shell")}
    flags = ("--no-trunc", "--strict", "--want", "--shell")
    args = [a for i, a in enumerate(head) if i not in values and a not in flags] + tail
    cmd = command_text(args) if cmd is None else cmd
    if not cmd.strip():
        return Result(ok=False, lane="exec", exit=2, note='nothing to run. Try: metarouter exec -- "pytest -q"')
    if strict:
        why = hints.stuck(calls.read(tail=BREAKER_ROWS), calls.shape(cmd), calls.project(), datetime.datetime.now().astimezone())
        if why:
            return Result(ok=False, lane="exec", exit=3, cmd=shrink.clip(cmd), note=why)
    try:
        if argv:
            code, raw, secs = run_argv(argv)
        else:
            code, raw, secs = run_shell(cmd, force, file) if force or file else run_shell(cmd)
    except OSError as e:
        return Result(ok=False, lane="exec", exit=127, cmd=shrink.clip(cmd),
                      note=f"could not start {argv[0]} ({e})" if argv else
                      f"could not start a shell ({e}). Set METAROUTER_SHELL to a bash or PowerShell path")
    if whole:
        r = finish("exec", cmd, raw, code, secs, compact=shrink.clean(raw.decode("utf-8", errors="replace")),
                   whole=True, cap=False)
    else:
        r = finish("exec", cmd, raw, code, secs, want=want)
        if not r.whole and not r.note:
            r.note = "shrunk; --no-trunc for all"
    return r


def no_recipe(name, recipes):
    near = difflib.get_close_matches(name, list(recipes), n=1)
    tip = f"Did you mean: metarouter run {store.signature(recipes[near[0]])}" if near else \
        f"Try: metarouter search {name}"
    return Result(ok=False, lane="run", exit=2, note=f'no recipe "{name}". {tip}')


def repo_scripts():
    root = store.project_root()
    if not root:
        return []
    found = []
    for d in SCRIPT_DIRS:
        try:
            found += sorted(f for f in (root / d).iterdir() if f.is_file() and f.suffix.lower() in SCRIPT_EXT
                            and f.resolve().is_relative_to(root))
        except OSError:
            continue
    return found


def is_path(name):
    return "/" in name or "\\" in name


def find_script(name):
    root = store.project_root()
    if not root:
        return None
    if is_path(name):
        for base in (Path.cwd(), root):
            p = (base / name).resolve()
            if p.is_file() and p.suffix.lower() in SCRIPT_EXT and p.is_relative_to(root):
                return p
        return None
    for f in repo_scripts():
        if f.name == name or f.stem == name:
            return f
    return None


def script_command(path, rest):
    ext = path.suffix.lower()
    runner = {".sh": [bash() or "bash"], ".py": [sys.executable], ".ps1": [powershell() or "powershell", "-NoProfile",
              "-File"]}.get(ext, ["node"])
    argv = [Path(a).as_posix() if os.path.isabs(a) else a for a in runner] + [path.as_posix(), *rest]
    return argv


def fall_through(name, rest):
    """In auto mode, an argv for a repo script or a PATH CLI called name, or None."""
    if store.mode() != "auto":
        return None
    if not is_path(name) and shutil.which(name):
        return [name, *rest]
    script = find_script(name)
    return script_command(script, rest) if script else None


def run_lane(args):
    if not args:
        return Result(ok=False, lane="run", exit=2, note="which recipe? Try: metarouter search <words>")
    name, rest = args[0], args[1:]
    yes, no_trunc = "--yes" in rest, "--no-trunc" in rest
    rest = [a for a in rest if a not in ("--yes", "--no-trunc")]
    recipes = store.load()
    r = recipes.get(name)
    if not r:
        argv = fall_through(name, [a for a in args[1:] if a != "--no-trunc"])
        if not argv:
            return no_recipe(name, recipes)
        return exec_lane(["--no-trunc"] * no_trunc + ["--", shlex.join(argv)], argv=argv)
    if store.needs_trust(r):
        if not yes:
            return Result(ok=False, lane="run", exit=2, recipe=name,
                          note=f"{name} is a {r.get('purity', 'read')} recipe from this repo's .metarouter/recipes. Read it with "
                               f"metarouter list, then run again with --yes once to trust it here")
        store.trust(r)
    if r.get("purity") == "destructive" and not yes:
        return Result(ok=False, lane="run", exit=2, recipe=name,
                      note=f"{name} is destructive. Run again with --yes to go ahead")
    label = shlex.join([name, *rest])
    kind = r.get("kind")
    if kind == "flow":
        return run_flow(r, rest)
    if kind == "python":
        code, text, raw, secs, whole = run_python(r, rest)
        return finish("run", label, raw, code, secs, recipe=name, compact=text, log_label=name,
                      whole=whole or no_trunc, cap=not no_trunc)
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
        whole = no_trunc or (bool(r.get("whole")) and code == 0)
        res = finish("run", cmd, raw, code, secs, recipe=name, log_label=name, whole=whole, cap=not no_trunc,
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


def quote_any(s):
    """Quote s so bash and PowerShell both read it as one argument."""
    if re.fullmatch(r"[\w./+-]+", s):
        return s
    return f'"{s}"' if not re.search(r'["$`\\]', s) else shlex.quote(s)


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
        root = store.project_root()
        extra += [f"metarouter run {quote_any('./' + f.relative_to(root).as_posix())}    repo script" for f in repo_scripts()
                  if any(w in f.name.lower() for w in words)][:5]
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
        "repo scripts and every CLI on PATH as well"
    return Result(ok=True, lane="mode", out=f"{m}: {what}")


def add_flow(args):
    opts = {"summary": None, "purity": "read"}
    project = "--project" in args
    args = [a for a in args if a != "--project"]
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
        r = store.save(name, steps, summary=opts["summary"], kind="flow", purity=opts["purity"], project=project)
        if project:
            store.trust(r)
    except ValueError as e:
        return Result(ok=False, lane="add", exit=2, note=str(e))
    return Result(ok=True, lane="add", recipe=name,
                  out=f"saved a flow of {len(steps)} steps. Run it: metarouter run {store.signature(r)}")


def flow_is_private(r, args, recipes):
    """True when the cwd, a filled step, or the body of a recipe a step runs matches a private pattern."""
    texts = [os.getcwd()]
    for text in r["body"]:
        try:
            texts.append(fill(text, args) if re.search(r"\{\d\}", text) else text)
            words = shlex.split(texts[-1])
        except ValueError:
            continue
        if words[:1] == ["run"] and len(words) > 1:
            body = recipes.get(words[1], {}).get("body")
            texts.append(json.dumps(body) if body is not None else "")
    return any(private(t) for t in texts)


def run_flow(r, args):
    global HIDDEN
    recipes = store.load()
    outer, HIDDEN = HIDDEN, HIDDEN or flow_is_private(r, args, recipes)
    try:
        return flow_steps(r, args, recipes)
    finally:
        HIDDEN = outer


def flow_steps(r, args, recipes):
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
    project = "--project" in head
    head = [a for a in head if a != "--project"]
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
        r = store.save(name, cmd, summary=opts["summary"], purity=opts["purity"], project=project)
        if project:
            store.trust(r)
    except ValueError as e:
        return Result(ok=False, lane="add", exit=2, note=str(e))
    return Result(ok=True, lane="add", recipe=name, out=f"saved. Run it: metarouter run {store.signature(r)}")


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
    project_only = "--project" in args
    if project_only:
        recipes = {n: r for n, r in recipes.items() if r.get("source") == "project"}
        if not recipes:
            return Result(ok=True, lane="check", out="no recipes in this repo's .metarouter/recipes")
    untrusted = set() if project_only else {n for n, r in recipes.items() if store.needs_trust(r)}
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
                    why = "flow, its steps are checked as recipes" if r.get("kind") == "flow" else "no example"
                    lines.append(f"skip  {name}: {why}")
                    continue
                if r.get("purity") == "destructive":
                    lines.append(f"skip  {name}: destructive, not run by check")
                    continue
                if name in untrusted:
                    lines.append(f"skip  {name}: repo recipe not trusted yet; check --project runs it")
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
                if ex.get("repo"):
                    git = ["git", "-c", "user.name=check", "-c", "user.email=check@example.invalid",
                           "-c", "commit.gpgsign=false"]
                    subprocess.run(["git", "-c", "init.defaultBranch=main", "init", "-q"], cwd=work,
                                   capture_output=True)
                    subprocess.run([*git, "commit", "-q", "--no-verify", "--allow-empty", "-m", "check"], cwd=work,
                                   capture_output=True)
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
    for flt in [] if project_only else filters.load():
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
        if project_only or r.get("source") == "seed":
            continue
        last = max((row["time"] for row in rows if row.get("recipe") == name), default=None)
        if last is None or last < cutoff:
            lines.append(f"stale {name}: not used in {STALE_DAYS} days")
    return Result(ok=failed == 0, lane="check", exit=1 if failed else 0, out="\n".join(lines))


def tools_lane(args):
    if args:
        name = args[0]
        exe = shutil.which(name)
        if not exe:
            return Result(ok=False, lane="tools", exit=1, note=f"{name} is not on PATH")
        try:
            p = subprocess.run([exe, "--help"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=15)
        except (OSError, subprocess.TimeoutExpired) as e:
            return Result(ok=False, lane="tools", exit=1, note=f"{name} --help failed: {e}")
        lines = p.stdout.decode("utf-8", errors="replace").splitlines()
        more = f"\n...{len(lines) - HELP_LINES} more lines: metarouter exec -- \"{name} --help\"" \
            if len(lines) > HELP_LINES else ""
        return Result(ok=True, lane="tools", out="\n".join(lines[:HELP_LINES]) + more)
    here = calls.project()
    bins = {}
    for r in calls.read():
        b = (r.get("shape") or "").split(" ")[0].lower().removesuffix(".exe")
        if r.get("lane") == "exec" and b and b not in SHELL_WORDS:
            local, total = bins.get(b, (0, 0))
            bins[b] = (local + (r.get("project") == here and r.get("exit") == 0), total + 1)
    out = [f"{b}  ({n} calls, {k} ok here)" for b, (k, n) in
           sorted(bins.items(), key=lambda x: (-x[1][0], -x[1][1])) if shutil.which(b)][:30]
    return Result(ok=True, lane="tools", out=out or "nothing yet: no exec calls logged")


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
    days = flag_value(args, "--days")
    if days and not days.isdigit():
        return Result(ok=False, lane="stats", exit=2, note="--days needs a number")
    rows = [r for r in calls.read() if not private(str(r.get("project") or "")) and not private(r.get("recipe") or "")]
    if days:
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
    tracked = sum("hint" in r or "hinted" in r for r in rows)
    for i, r in enumerate(rows):
        if not (r.get("hint") or r.get("hinted")):
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
        "hint_sources": hints.by_source(),
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
    mine = [r for r in store.load().values() if r.get("source") != "seed"]
    if not mine:
        return Result(ok=False, lane="export", exit=1, note='no saved recipes yet. Save one: metarouter add <name> -- "<command>"')
    secret = [r["name"] for r in mine if shield.leaks(r)]
    if secret:
        return Result(ok=False, lane="export", exit=2, note=f"export refused: {', '.join(secret)} looks like it holds "
                                                            f"a secret in its body or example. Remove it, then export")
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
    from metarouter import snapshot
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


def lazy(module, name):
    return lambda args: getattr(importlib.import_module(f"metarouter.{module}"), name)(args)


LANES = {"run": run_lane, "exec": exec_lane, "search": search_lane, "list": list_lane, "add": add_lane,
         "check": check, "undo": undo, "tools": tools_lane, "mode": mode_lane, "log": log_lane, "stats": stats_lane,
         "export": export_lane, "import": import_lane, "init": lazy("setup", "init"),
         "uninstall": lazy("setup", "uninstall"), "doctor": lazy("setup", "doctor"), "ab": lazy("ab", "ab_lane"),
}


def log_call(rec):
    if not rec:
        return
    try:
        calls.append(rec)
    except Exception as e:
        print(f"metarouter: call log not written ({type(e).__name__})", file=sys.stderr)


def main(argv=None, text_ok=True):
    how_, argv = mode(list(sys.argv[1:] if argv is None else argv))
    verb, rest = (argv[0], argv[1:]) if argv else (None, [])
    if verb is None or verb in ("help", "-h", "--help"):
        r = menu()
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
    r = shield.guard(r)
    out = render(r, how_, text_ok)
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
