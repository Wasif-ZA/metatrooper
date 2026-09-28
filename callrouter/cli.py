import difflib
import os
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path

from callrouter import calls, log, shrink
from callrouter.result import Result, mode, render

VERBS = {
    "run": "run -- <command>      run a shell command, print a short result, keep the full log",
    "ingest": "ingest [--since T]    where tool-result tokens go, from the transcripts",
}
GIT_BASH = Path(r"C:\Program Files\Git\bin\bash.exe")


def shell():
    """Return the bash to run commands with. On Windows, skip WSL's System32 bash."""
    if os.environ.get("CALLROUTER_SHELL"):
        return os.environ["CALLROUTER_SHELL"]
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


def run(args):
    cmd = command_text(args)
    if not cmd.strip():
        return Result(ok=False, lane="run", exit=2,
                      note='nothing to run. Try: callrouter run -- "pytest -q"')
    start = time.monotonic()
    try:
        proc = subprocess.run([shell(), "-c", cmd], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    except OSError as e:
        return Result(ok=False, lane="run", exit=127, cmd=shrink.clip(cmd),
                      note=f"could not start a shell ({e}). Set CALLROUTER_SHELL to a bash path")
    secs = round(time.monotonic() - start, 1)
    raw = proc.stdout or b""
    text = raw.decode("utf-8", errors="replace")
    try:
        path = log.write(cmd, raw)
    except OSError as e:
        return Result(ok=proc.returncode == 0, lane="run", exit=proc.returncode, secs=secs, out=text,
                      cmd=shrink.clip(cmd), note=f"log not written ({e}); output shown whole")
    r = Result(ok=proc.returncode == 0, lane="run", exit=proc.returncode, secs=secs,
               lines=len(text.splitlines()), bytes=len(raw), log=path.as_posix(),
               cmd=shrink.clip(cmd))
    try:
        for k, v in shrink.shrink(text).items():
            setattr(r, k, v)
    except Exception as e:
        r.out, r.errors, r.tail = text, [], []
        r.note = f"shrinker failed ({type(e).__name__}); output shown whole"
    try:
        calls.append(calls.record("run", cmd, r.exit, secs, r.bytes, path))
    except Exception as e:
        r.note = (r.note + "; " if r.note else "") + f"call log not written ({type(e).__name__})"
    return r


def menu():
    lines = ["callrouter: the agent's tool memory", ""]
    lines += [f"  callrouter {v}" for v in VERBS.values()]
    lines += ["", "  --json or --human forces the output style."]
    return Result(ok=True, lane="menu", out="\n".join(lines))


def unknown(verb):
    near = difflib.get_close_matches(verb, list(VERBS), n=1)
    tip = f"Did you mean: callrouter {VERBS[near[0]].split('  ')[0]}" if near else "Run callrouter for the menu."
    return Result(ok=False, lane="menu", exit=2, note=f'no verb "{verb}". {tip}')


def main(argv=None):
    how, argv = mode(list(sys.argv[1:] if argv is None else argv))
    verb, rest = (argv[0], argv[1:]) if argv else (None, [])
    if verb == "ingest":
        from callrouter import ingest
        return ingest.main(["ingest", *rest], how=how) or 0
    if verb is None or verb in ("help", "-h", "--help"):
        r = menu()
    elif verb == "run":
        r = run(rest)
    else:
        r = unknown(verb)
    out = render(r, how)
    try:
        print(out)
    except UnicodeEncodeError:
        sys.stdout.buffer.write((out + "\n").encode("utf-8", errors="replace"))
    return r.exit


def entry():
    sys.exit(main())


if __name__ == "__main__":
    entry()
