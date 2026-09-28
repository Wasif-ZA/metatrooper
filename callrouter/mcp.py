import json
import os
import queue
import subprocess
import threading

from callrouter.log import home

PROTOCOL = "2025-06-18"
TIMEOUT = 60


def servers():
    path = home() / "servers.json"
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("mcpServers", data) if isinstance(data, dict) else {}


class Session:
    """One MCP server over stdio: newline-delimited JSON-RPC."""

    def __init__(self, spec):
        cmd = [spec["command"], *spec.get("args", [])]
        env = {**os.environ, **spec.get("env", {})}
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                     env=env)
        self.lines = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()
        self.next_id = 0
        try:
            self.request("initialize", {"protocolVersion": PROTOCOL, "capabilities": {},
                                        "clientInfo": {"name": "callrouter", "version": "0.1"}})
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
    all_ = servers()
    if name not in all_:
        known = ", ".join(sorted(all_)) or "none yet"
        raise KeyError(f'no MCP server "{name}" in {home() / "servers.json"}. Known: {known}')
    return Session(all_[name])


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
