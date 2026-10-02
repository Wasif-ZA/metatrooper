import base64
import time
from urllib.parse import urlparse

INTERACTIVE = {"link", "button", "textbox", "searchbox", "combobox", "checkbox", "radio", "menuitem", "tab",
               "switch", "slider", "spinbutton", "listbox", "option"}
MAX_ELEMENTS = 80
MAX_HEADINGS = 20
NAME_CLIP = 80
LOAD_TIMEOUT = 15


def value(node, key):
    return ((node.get(key) or {}).get("value") or "")


def host_blocked(url, blocked):
    host = (urlparse(url if "://" in url else "//" + url).hostname or "").rstrip(".").lower()
    return any(host == b or host.endswith("." + b) for b in blocked) if host else False


class Page:
    def __init__(self, chrome):
        self.c = chrome
        target = self.c.send("Target.createTarget", {"url": "about:blank"})["targetId"]
        self.session = self.c.send("Target.attachToTarget", {"targetId": target, "flatten": True})["sessionId"]
        self.target = target
        for domain in ("Page", "DOM", "Accessibility", "Runtime"):
            self.send(f"{domain}.enable")
        self.refs = {}
        self.last = None

    def send(self, method, params=None, timeout=30):
        return self.c.send(method, params, session=self.session, timeout=timeout)

    def js(self, expr):
        res = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        return (res.get("result") or {}).get("value")

    def settle(self, timeout=LOAD_TIMEOUT):
        start = time.monotonic()
        time.sleep(0.2)
        while time.monotonic() - start < timeout:
            try:
                if self.js("document.readyState") == "complete":
                    return True
            except (RuntimeError, TimeoutError):
                pass
            time.sleep(0.2)
        return False

    def url(self):
        return self.js("location.href") or ""

    def navigate(self, url):
        res = self.send("Page.navigate", {"url": url})
        if res.get("errorText"):
            raise RuntimeError(f"could not open {url}: {res['errorText']}")
        self.settle()

    def snapshot(self):
        nodes = self.send("Accessibility.getFullAXTree").get("nodes", [])
        headings, elements, refs = [], [], {}
        for n in nodes:
            if n.get("ignored"):
                continue
            role, name = value(n, "role"), " ".join(value(n, "name").split())[:NAME_CLIP]
            if role == "heading" and name:
                headings.append(name)
            elif role in INTERACTIVE and n.get("backendDOMNodeId"):
                ref = f"@{len(refs) + 1}"
                refs[ref] = n["backendDOMNodeId"]
                elements.append(f"{ref} {role} {name}".rstrip())
        self.refs = refs
        snap = {"url": self.url(), "title": self.js("document.title") or "", "headings": headings,
                "elements": elements}
        return snap

    def summary(self, snap):
        out = {"url": snap["url"], "title": snap["title"], "headings": snap["headings"][:MAX_HEADINGS],
               "elements": snap["elements"][:MAX_ELEMENTS]}
        if len(snap["elements"]) > MAX_ELEMENTS:
            out["more_elements"] = len(snap["elements"]) - MAX_ELEMENTS
        return out

    def look(self):
        snap = self.snapshot()
        self.last = snap
        return self.summary(snap)

    def changed(self):
        """Snapshot again and return only what changed since the last one."""
        before = self.last
        snap = self.snapshot()
        self.last = snap
        if not before or before["url"] != snap["url"]:
            return {"navigated": True, **self.summary(snap)}
        strip = lambda e: e.split(" ", 1)[1] if " " in e else e
        old = {strip(e) for e in before["elements"]}
        new = {strip(e) for e in snap["elements"]}
        out = {"navigated": False, "url": snap["url"]}
        if before["title"] != snap["title"]:
            out["title"] = snap["title"]
        out["added"] = [e for e in snap["elements"] if strip(e) not in old][:MAX_ELEMENTS]
        out["removed"] = sorted(old - new)[:MAX_ELEMENTS]
        added_h = [h for h in snap["headings"] if h not in before["headings"]]
        if added_h:
            out["new_headings"] = added_h[:MAX_HEADINGS]
        if not out["added"] and not out["removed"] and "title" not in out:
            out["note"] = "nothing on the page changed"
        return out

    def node(self, ref):
        if ref not in self.refs:
            raise KeyError(f"no element {ref}. Run look to number the page again")
        obj = self.send("DOM.resolveNode", {"backendNodeId": self.refs[ref]})["object"]["objectId"]
        return obj

    def click(self, ref):
        obj = self.node(ref)
        self.send("Runtime.callFunctionOn", {"objectId": obj, "functionDeclaration":
                  "function(){this.scrollIntoView({block:'center'}); this.click();}"})
        self.settle()

    def type(self, ref, text):
        obj = self.node(ref)
        self.send("Runtime.callFunctionOn", {"objectId": obj, "functionDeclaration":
                  "function(){this.scrollIntoView({block:'center'}); this.focus();"
                  " if ('value' in this) { this.value = ''; }}"})
        self.send("Input.insertText", {"text": text})

    def read(self):
        return self.js("document.body ? document.body.innerText : ''") or ""

    def shot(self, full=False):
        params = {"format": "png"}
        if full:
            params["captureBeyondViewport"] = True
        return base64.b64decode(self.send("Page.captureScreenshot", params, timeout=60)["data"])

    def back(self):
        old = self.url()
        self.js("history.back()")
        start = time.monotonic()
        while self.url() == old and time.monotonic() - start < LOAD_TIMEOUT:
            time.sleep(0.1)
        self.settle()
