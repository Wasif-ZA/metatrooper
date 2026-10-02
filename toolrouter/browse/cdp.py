import json
import os
import subprocess
import threading
from pathlib import Path

CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]


def find_chrome():
    if os.environ.get("TOOLROUTER_CHROME"):
        return os.environ["TOOLROUTER_CHROME"]
    for p in CHROME_PATHS:
        if Path(p).exists():
            return p
    raise FileNotFoundError("Chrome not found. Set TOOLROUTER_CHROME to its path")


class Chrome:
    """Chrome driven over --remote-debugging-pipe: JSON messages separated by NUL bytes."""

    def __init__(self, profile, show=False):
        r_in, w_in = os.pipe()
        r_out, w_out = os.pipe()
        args = [find_chrome(), "--remote-debugging-pipe", f"--user-data-dir={profile}", "--no-first-run",
                "--no-default-browser-check", "about:blank"]
        if not show:
            args.insert(1, "--headless=new")
        # ponytail: Windows pipe handles only; macOS and Linux pass fds 3 and 4 instead, add when one is used
        import msvcrt
        h_in, h_out = msvcrt.get_osfhandle(r_in), msvcrt.get_osfhandle(w_out)
        os.set_handle_inheritable(h_in, True)
        os.set_handle_inheritable(h_out, True)
        args.insert(1, f"--remote-debugging-io-pipes={h_in},{h_out}")
        self.proc = subprocess.Popen(args, close_fds=False, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL)
        os.close(r_in)
        os.close(w_out)
        self.w, self.r = w_in, r_out
        self.next_id = 0
        self.waiting = {}
        self.lock = threading.Lock()
        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self):
        buf = b""
        while True:
            try:
                chunk = os.read(self.r, 1 << 16)
            except OSError:
                chunk = b""
            if not chunk:
                for ev in list(self.waiting.values()):
                    ev[1] = {"error": {"message": "chrome closed the pipe"}}
                    ev[0].set()
                return
            buf += chunk
            while b"\0" in buf:
                msg, buf = buf.split(b"\0", 1)
                try:
                    data = json.loads(msg)
                except ValueError:
                    continue
                slot = self.waiting.get(data.get("id")) if isinstance(data, dict) else None
                if slot:
                    slot[1] = data
                    slot[0].set()

    def send(self, method, params=None, session=None, timeout=30):
        if self.proc.poll() is not None:
            raise ConnectionError("chrome is not running")
        with self.lock:
            self.next_id += 1
            mid = self.next_id
            slot = [threading.Event(), None]
            self.waiting[mid] = slot
            msg = {"id": mid, "method": method, "params": params or {}}
            if session:
                msg["sessionId"] = session
            os.write(self.w, json.dumps(msg).encode() + b"\0")
        if not slot[0].wait(timeout):
            self.waiting.pop(mid, None)
            raise TimeoutError(f"{method} got no answer in {timeout}s")
        self.waiting.pop(mid, None)
        data = slot[1]
        if "error" in data:
            raise RuntimeError(f"{method}: {data['error'].get('message')}")
        return data.get("result", {})

    def close(self):
        try:
            self.send("Browser.close", timeout=5)
        except Exception:
            pass
        try:
            self.proc.wait(5)
        except subprocess.TimeoutExpired:
            self.proc.kill()
