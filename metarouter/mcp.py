import datetime
import json
import os
import queue
import re
import shutil
import subprocess
import threading
import tomllib
import urllib.error
import urllib.request
from pathlib import Path

from metarouter import recipes as store
from metarouter.log import home

PROTOCOL = "2025-06-18"
TIMEOUT = 60
CATALOG = Path(__file__).with_name("mcp_catalog.json")


def servers():
    path = home() / "servers.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as e:
        raise RuntimeError(f"{path} is not valid JSON: {e}") from e
    return data.get("mcpServers", data) if isinstance(data, dict) else {}


def catalog():
    if store.mode() != "auto" or not CATALOG.is_file():
        return {}
    return {s["name"]: s for s in json.loads(CATALOG.read_text(encoding="utf-8"))}


def line(name, s):
    need = f"  needs {', '.join(s['env'])}" if s.get("env") else ""
    return f"{name}  {s.get('summary', '')}{need}"


def catalog_lines(words=(), remote=True):
    words = [w.lower() for w in words]
    mine = servers()
    rows = [(n, {"summary": f"(servers.json) {s.get('command', '')} {' '.join(s.get('args', []))}"})
            for n, s in sorted(mine.items())]
    rows += [(n, s) for n, s in sorted(catalog().items()) if n not in mine]
    out = [line(n, s) for n, s in rows if all(w in f"{n} {s.get('summary', '')}".lower() for w in words)]
    if words and remote and store.mode() == "auto":
        from metarouter import registry
        seen = {n for n, _ in rows}
        try:
            out += [line(s["name"], s) for s in registry.search(" ".join(words)) if s["name"] not in seen]
        except OSError as e:
            out.append(f"(registry unreachable: {e})")
    if store.mode() != "auto":
        out.append("(learn mode: servers.json only. metarouter mode auto adds the catalogue and the public registry)")
    return out


class Session:
    """One MCP server over stdio: newline-delimited JSON-RPC."""

    def __init__(self, spec):
        cmd = [shutil.which(spec["command"]) or spec["command"], *spec.get("args", [])]
        env = {**os.environ, **spec.get("env", {})}
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                     env=env)
        self.lines = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()
        self.next_id = 0
        try:
            self.request("initialize", {"protocolVersion": PROTOCOL, "capabilities": {},
                                        "clientInfo": {"name": "metarouter", "version": "0.1"}})
            self.notify("notifications/initialized")
        except Exception:
            self.close()
            raise

    def _read(self):
        for line in self.proc.stdout:
            self.lines.put(line)
        self.lines.put(None)

    def _send(self, msg):
        self.proc.stdin.write((json.dumps(msg) + "\n").encode("utf-8"))
        self.proc.stdin.flush()

    def notify(self, method, params=None):
        self._send({"jsonrpc": "2.0", "method": method, **({"params": params} if params else {})})

    def request(self, method, params=None, timeout=TIMEOUT):
        self.next_id += 1
        mid = self.next_id
        self._send({"jsonrpc": "2.0", "id": mid, "method": method, "params": params or {}})
        while True:
            try:
                line = self.lines.get(timeout=timeout)
            except queue.Empty:
                raise TimeoutError(f"{method} got no answer in {timeout}s") from None
            if line is None:
                raise ConnectionError("the MCP server exited")
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if msg.get("id") != mid:
                continue
            if "error" in msg:
                raise RuntimeError(f"{method}: {msg['error'].get('message')}")
            return msg.get("result", {})

    def close(self):
        try:
            self.proc.stdin.close()
            self.proc.wait(5)
        except (OSError, subprocess.TimeoutExpired):
            self.proc.kill()


class HttpSession:
    """One MCP server over Streamable HTTP."""

    def __init__(self, spec):
        self.url = spec["url"]
        self.session_id = None
        self.next_id = 0
        if isinstance(spec.get("env"), list):
            missing = [v for v in spec["env"] if not os.environ.get(v)]
            if missing:
                raise KeyError(f'needs {", ".join(missing)} set in the environment')
        self.headers = {}
        for k, v in (spec.get("headers") or {}).items():
            self.headers[k] = re.sub(r"\$\{([A-Za-z0-9_]+)\}", lambda m: os.environ.get(m.group(1), ""), str(v))
        try:
            self.request("initialize", {"protocolVersion": PROTOCOL, "capabilities": {},
                                        "clientInfo": {"name": "metarouter", "version": "0.1"}})
            self.notify("notifications/initialized")
        except Exception:
            self.close()
            raise

    def notify(self, method, params=None):
        msg = {"jsonrpc": "2.0", "method": method, **({"params": params} if params else {})}
        data = json.dumps(msg).encode("utf-8")
        headers = {
            **self.headers,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        req = urllib.request.Request(self.url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                sid = resp.headers.get("Mcp-Session-Id")
                if sid:
                    self.session_id = sid
        except urllib.error.HTTPError as e:
            try:
                body = (e.read() or b"").decode("utf-8", errors="replace")[:200]
            except Exception:
                body = ""
            raise RuntimeError(f"{e.code}: {body}") from None

    def request(self, method, params=None, timeout=TIMEOUT):
        self.next_id += 1
        mid = self.next_id
        msg = {"jsonrpc": "2.0", "id": mid, "method": method, "params": params or {}}
        data = json.dumps(msg).encode("utf-8")
        headers = {
            **self.headers,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        req = urllib.request.Request(self.url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                sid = resp.headers.get("Mcp-Session-Id")
                if sid:
                    self.session_id = sid
                ctype = resp.headers.get("Content-Type", "")
                if "text/event-stream" in ctype:
                    for raw_line in resp:
                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if not line.startswith("data:"):
                            continue
                        try:
                            res_msg = json.loads(line[5:].lstrip())
                        except ValueError:
                            continue
                        if res_msg.get("id") != mid:
                            continue
                        if "error" in res_msg:
                            err = res_msg["error"]
                            err_text = err.get("message") if isinstance(err, dict) else str(err)
                            raise RuntimeError(f"{method}: {err_text}")
                        return res_msg.get("result", {})
                    raise ConnectionError("the MCP server stream ended without answering")
                body = resp.read().decode("utf-8", errors="replace")
                res_msg = json.loads(body)
                if "error" in res_msg:
                    err = res_msg["error"]
                    err_text = err.get("message") if isinstance(err, dict) else str(err)
                    raise RuntimeError(f"{method}: {err_text}")
                return res_msg.get("result", {})
        except urllib.error.HTTPError as e:
            try:
                body = (e.read() or b"").decode("utf-8", errors="replace")[:200]
            except Exception:
                body = ""
            raise RuntimeError(f"{e.code}: {body}") from None

    def close(self):
        if not self.session_id:
            return
        headers = {**self.headers, "Mcp-Session-Id": self.session_id}
        req = urllib.request.Request(self.url, headers=headers, method="DELETE")
        try:
            with urllib.request.urlopen(req, timeout=5):
                pass
        except Exception:
            pass
        self.session_id = None


def server_spec(name):
    mine = servers()
    all_ = {**catalog(), **mine}
    if name in all_:
        spec = all_[name]
        in_mine = True
    elif store.mode() == "auto" and "/" in name:
        from metarouter import registry
        spec = registry.spec(name)
        in_mine = False
    else:
        known = ", ".join(sorted(all_)) or "none yet"
        raise KeyError(f'no MCP server "{name}" in {home() / "servers.json"} or the catalogue. Known: {known}. '
                       f'Find one: metarouter mcp search <words>')
    if not in_mine or isinstance(spec.get("env"), list):
        missing = [v for v in spec.get("env", []) if not os.environ.get(v)]
        if missing:
            raise KeyError(f'{name} needs {", ".join(missing)} set in the environment')
        spec = {k: v for k, v in spec.items() if k != "env"}
    return spec


def open_session(name):
    spec = server_spec(name)
    return HttpSession(spec) if "url" in spec else Session(spec)


def cached_tools():
    path = home() / "mcp-tools.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def list_tools(name):
    spec = server_spec(name)
    if "url" in spec or os.environ.get("METAROUTER_MCP_KEEP") == "0":
        s = open_session(name)
        try:
            tools = s.request("tools/list").get("tools", [])
        finally:
            s.close()
    else:
        from metarouter import mcp_daemon
        try:
            tools = mcp_daemon.call(name, "tools/list").get("tools", [])
        except (ConnectionError, TimeoutError, OSError):
            s = Session(spec)
            try:
                tools = s.request("tools/list").get("tools", [])
            finally:
                s.close()
    cache = cached_tools()
    clean = [{k: t[k] for k in ("name", "description", "inputSchema") if k in t} for t in tools]
    cache[name] = {"time": datetime.datetime.now().astimezone().isoformat(), "tools": clean}
    path = home() / "mcp-tools.json"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(cache, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    except OSError:
        pass
    return tools


def call_tool(name, tool, args):
    spec = server_spec(name)
    params = {"name": tool, "arguments": args}
    if "url" in spec or os.environ.get("METAROUTER_MCP_KEEP") == "0":
        s = open_session(name)
        try:
            return s.request("tools/call", params)
        finally:
            s.close()
    from metarouter import mcp_daemon
    try:
        return mcp_daemon.call(name, "tools/call", params)
    except (ConnectionError, TimeoutError, OSError):
        s = Session(spec)
        try:
            return s.request("tools/call", params)
        finally:
            s.close()


def one_line(tool):
    props = (tool.get("inputSchema") or {}).get("properties") or {}
    required = set((tool.get("inputSchema") or {}).get("required") or [])
    args = ", ".join(p if p in required else p + "?" for p in props)
    first = (tool.get("description") or "").strip().split("\n")[0].split(". ")[0][:100]
    return f"{tool['name']}({args})  {first}".rstrip()


def text_of(result):
    parts = [c.get("text", "") for c in result.get("content", []) if c.get("type") == "text"]
    other = [c.get("type") for c in result.get("content", []) if c.get("type") != "text"]
    text = "\n".join(parts)
    try:
        value = json.loads(text) if text.strip()[:1] in "[{" else text
    except ValueError:
        value = text
    if other:
        value = {"text": value, "other_content": other}
    return value


def is_remote_server(spec):
    if "url" in spec:
        return True
    t = str(spec.get("type", "")).lower()
    if t in ("http", "sse", "streamable-http"):
        return True
    if isinstance(spec.get("transport"), dict):
        tt = str(spec["transport"].get("type", "")).lower()
        if tt in ("http", "sse", "streamable-http"):
            return True
    return False


def import_servers():
    claude_path = Path.home() / ".claude.json"
    codex_path = Path.home() / ".codex" / "config.toml"
    candidates = []
    if claude_path.is_file():
        try:
            cdata = json.loads(claude_path.read_text(encoding="utf-8"))
            if isinstance(cdata, dict):
                if isinstance(cdata.get("mcpServers"), dict):
                    for name, spec in cdata["mcpServers"].items():
                        candidates.append((name, spec))
                projects = cdata.get("projects")
                if isinstance(projects, dict):
                    for proj in projects.values():
                        if isinstance(proj, dict) and isinstance(proj.get("mcpServers"), dict):
                            for name, spec in proj["mcpServers"].items():
                                candidates.append((name, spec))
                elif isinstance(projects, list):
                    for proj in projects:
                        if isinstance(proj, dict) and isinstance(proj.get("mcpServers"), dict):
                            for name, spec in proj["mcpServers"].items():
                                candidates.append((name, spec))
        except (OSError, ValueError):
            pass
    if codex_path.is_file():
        try:
            tdata = tomllib.loads(codex_path.read_text(encoding="utf-8"))
            if isinstance(tdata, dict) and isinstance(tdata.get("mcp_servers"), dict):
                for name, spec in tdata["mcp_servers"].items():
                    candidates.append((name, spec))
        except (OSError, ValueError):
            pass
    path = home() / "servers.json"
    raw_data = {}
    if path.is_file():
        try:
            raw_data = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            raw_data = {}
    if not isinstance(raw_data, dict):
        raw_data = {}
    if "mcpServers" in raw_data and isinstance(raw_data["mcpServers"], dict):
        target = raw_data["mcpServers"]
    else:
        target = dict(raw_data)
        raw_data = {"mcpServers": target}
    added, skipped = [], []
    for name, spec in candidates:
        if not isinstance(spec, dict):
            skipped.append(f"{name}: invalid specification")
            continue
        if name in target:
            skipped.append(f"{name}: already present")
            continue
        if is_remote_server(spec):
            skipped.append(f"{name}: remote server")
            continue
        if "command" not in spec or not spec["command"]:
            skipped.append(f"{name}: missing command")
            continue
        entry = {}
        for k, v in spec.items():
            if k == "env":
                if isinstance(v, dict):
                    entry["env"] = list(v.keys())
                elif isinstance(v, list):
                    entry["env"] = list(v)
            else:
                entry[k] = v
        target[name] = entry
        added.append(name)
    if added:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(raw_data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"added": added, "skipped": skipped}
