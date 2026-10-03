import json
import os
import socket
import subprocess
import sys
import time

from metarouter.log import child_env, home

IDLE_SECONDS = 30 * 60
START_TIMEOUT = 10


def state_path():
    return home() / "mcp-daemon.json"


def serve():
    from metarouter import mcp

    sessions = {}
    last = [time.monotonic()]
    stop = [False]

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    listener.listen(128)
    listener.settimeout(2.0)

    state_path().parent.mkdir(parents=True, exist_ok=True)
    state_path().write_text(json.dumps({"port": port, "pid": os.getpid()}), encoding="utf-8")

    try:
        while not stop[0] and time.monotonic() - last[0] < IDLE_SECONDS:
            try:
                conn, _ = listener.accept()
            except TimeoutError:
                continue
            except OSError:
                break
            try:
                conn.settimeout(60)
                f = conn.makefile("rwb")
                raw = f.readline()
                if not raw:
                    conn.close()
                    continue
                req = json.loads(raw.decode("utf-8"))
                if req.get("method") == "stop":
                    stop[0] = True
                    reply = {"result": "stopped"}
                elif "server" in req:
                    last[0] = time.monotonic()
                    server = req["server"]
                    method = req.get("method", "")
                    params = req.get("params") or {}
                    try:
                        if server not in sessions:
                            sessions[server] = mcp.open_session(server)
                        res = sessions[server].request(method, params)
                        reply = {"result": res}
                    except Exception as e:
                        if isinstance(e, (ConnectionError, BrokenPipeError, TimeoutError)):
                            old = sessions.pop(server, None)
                            if old:
                                try:
                                    old.close()
                                except Exception:
                                    pass
                        reply = {"error": str(e)}
                else:
                    reply = {"error": "invalid request"}
                f.write((json.dumps(reply, ensure_ascii=False) + "\n").encode("utf-8"))
                f.flush()
            except Exception as e:
                try:
                    f.write((json.dumps({"error": str(e)}) + "\n").encode("utf-8"))
                    f.flush()
                except Exception:
                    pass
            finally:
                try:
                    conn.close()
                except Exception:
                    pass
    finally:
        for s in list(sessions.values()):
            try:
                s.close()
            except Exception:
                pass
        sessions.clear()
        try:
            listener.close()
        except Exception:
            pass
        state_path().unlink(missing_ok=True)


def ensure():
    """Return the running daemon's state, starting one if needed."""
    if state_path().is_file():
        try:
            state = json.loads(state_path().read_text(encoding="utf-8"))
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2.0)
            sock.connect(("127.0.0.1", state["port"]))
            sock.close()
            return state
        except (OSError, ValueError, KeyError):
            pass
        state_path().unlink(missing_ok=True)
    kw = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
          "env": child_env()}
    if os.name == "nt":
        kw["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    subprocess.Popen([sys.executable, "-m", "metarouter.mcp_daemon"], **kw)
    start = time.monotonic()
    while time.monotonic() - start < START_TIMEOUT:
        if state_path().is_file():
            try:
                state = json.loads(state_path().read_text(encoding="utf-8"))
                if "port" in state:
                    return state
            except ValueError:
                pass
        time.sleep(0.05)
    raise TimeoutError("the MCP daemon did not start in time")


def call(server, method, params=None):
    state = ensure()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(60)
    sock.connect(("127.0.0.1", state["port"]))
    with sock:
        f = sock.makefile("rwb")
        req = {"server": server, "method": method, "params": params or {}}
        f.write((json.dumps(req, ensure_ascii=False) + "\n").encode("utf-8"))
        f.flush()
        line = f.readline()
        if not line:
            raise ConnectionError("daemon closed connection without reply")
        msg = json.loads(line.decode("utf-8"))
        if "error" in msg:
            raise RuntimeError(msg["error"])
        return msg.get("result", {})


def stop():
    if not state_path().is_file():
        return "not running"
    try:
        state = json.loads(state_path().read_text(encoding="utf-8"))
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5.0)
        sock.connect(("127.0.0.1", state["port"]))
        with sock:
            f = sock.makefile("rwb")
            f.write((json.dumps({"method": "stop"}) + "\n").encode("utf-8"))
            f.flush()
            f.readline()
        start = time.monotonic()
        while time.monotonic() - start < 3:
            if not state_path().is_file():
                break
            time.sleep(0.05)
        state_path().unlink(missing_ok=True)
        return "stopped"
    except (OSError, ValueError, KeyError):
        state_path().unlink(missing_ok=True)
        return "not running"


if __name__ == "__main__":
    serve()
