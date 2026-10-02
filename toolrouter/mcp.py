import json
import os
import queue
import shutil
import subprocess
import threading
from pathlib import Path

from toolrouter import recipes as store
from toolrouter.log import home

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
        from toolrouter import registry
        seen = {n for n, _ in rows}
        try:
            out += [line(s["name"], s) for s in registry.search(" ".join(words)) if s["name"] not in seen]
        except OSError as e:
            out.append(f"(registry unreachable: {e})")
    if store.mode() != "auto":
        out.append("(learn mode: servers.json only. toolrouter mode auto adds the catalogue and the public registry)")
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
                                        "clientInfo": {"name": "toolrouter", "version": "0.1"}})
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


def open_session(name):
    mine = servers()
    all_ = {**catalog(), **mine}
    if name in all_:
        spec = all_[name]
    elif store.mode() == "auto" and "/" in name:
        from toolrouter import registry
        spec = registry.spec(name)
    else:
        known = ", ".join(sorted(all_)) or "none yet"
        raise KeyError(f'no MCP server "{name}" in {home() / "servers.json"} or the catalogue. Known: {known}. '
                       f'Find one: toolrouter mcp search <words>')
    if name not in mine:
        missing = [v for v in spec.get("env", []) if not os.environ.get(v)]
        if missing:
            raise KeyError(f'{name} needs {", ".join(missing)} set in the environment')
        spec = {k: v for k, v in spec.items() if k != "env"}
    return Session(spec)


def list_tools(name):
    s = open_session(name)
    try:
        return s.request("tools/list").get("tools", [])
    finally:
        s.close()


def call_tool(name, tool, args):
    s = open_session(name)
    try:
        return s.request("tools/call", {"name": tool, "arguments": args})
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
