import datetime
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

from toolrouter.log import child_env, home

STILL_ACTIVE = 259


def folder():
    return home() / "jobs"


def alive(pid):
    if os.name == "nt":
        import ctypes
        k = ctypes.windll.kernel32
        k.OpenProcess.restype = ctypes.c_void_p
        k.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        k.CloseHandle.argtypes = [ctypes.c_void_p]
        h = k.OpenProcess(0x1000, False, pid)
        if not h:
            return False
        code = ctypes.c_ulong()
        ok = k.GetExitCodeProcess(h, ctypes.byref(code))
        k.CloseHandle(h)
        return bool(ok) and code.value == STILL_ACTIVE
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def start(argv, label):
    """Run `toolrouter <argv>` detached in this folder. Return the job id."""
    jid = f"{datetime.datetime.now():%m%d-%H%M%S}-{uuid.uuid4().hex[:12]}"
    folder().mkdir(parents=True, exist_ok=True)
    meta = {"id": jid, "label": label, "cwd": os.getcwd(),
            "started": datetime.datetime.now().astimezone().isoformat(timespec="seconds")}
    cmd = [sys.executable, "-m", "toolrouter.jobs", "_run", jid, *argv]
    kw = {"cwd": meta["cwd"], "stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL,
          "stderr": subprocess.DEVNULL, "env": child_env()}
    if os.name == "nt":
        kw["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    meta["pid"] = subprocess.Popen(cmd, **kw).pid
    (folder() / f"{jid}.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return jid


def _run(jid, argv):
    """Job runner: run the call in JSON mode and store its result."""
    from toolrouter import cli
    import contextlib
    import io
    buf = io.StringIO()
    os.environ["TOOLROUTER_OUTPUT"] = "json"
    try:
        with contextlib.redirect_stdout(buf):
            cli.main(argv)
        result = json.loads(buf.getvalue().strip().splitlines()[-1])
    except Exception as e:
        result = {"ok": False, "lane": "jobs", "exit": 1, "note": f"job runner failed: {type(e).__name__}: {e}"}
    result["job"] = jid
    tmp = folder() / f"{jid}.result.tmp"
    tmp.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    tmp.replace(folder() / f"{jid}.result.json")


def status(jid):
    meta_path = folder() / f"{jid}.json"
    if not meta_path.is_file():
        raise FileNotFoundError(f'no job "{jid}". List them: toolrouter jobs')
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    res = folder() / f"{jid}.result.json"
    running = not res.is_file() and alive(meta["pid"])
    if running:
        meta["status"] = "running"
    elif res.is_file():
        meta["status"] = "done"
        meta["result"] = json.loads(res.read_text(encoding="utf-8"))
    else:
        meta["status"] = "lost"
    return meta


def all_jobs():
    if not folder().is_dir():
        return []
    ids = sorted(p.stem for p in folder().glob("*.json") if not p.name.endswith(".result.json"))
    return [status(j) for j in ids]


def wait(jid, timeout=None):
    start = time.monotonic()
    while True:
        s = status(jid)
        if s["status"] != "running":
            return s
        if timeout and time.monotonic() - start > timeout:
            return s
        time.sleep(1)


if __name__ == "__main__":
    if sys.argv[1:2] == ["_run"]:
        _run(sys.argv[2], sys.argv[3:])
