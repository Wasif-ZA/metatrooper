import re
import urllib.error
import urllib.request

from toolrouter import log

BASE = "https://raw.githubusercontent.com/tldr-pages/tldr/main/pages"
CREDIT = "Source: tldr-pages (https://github.com/tldr-pages/tldr), CC-BY 4.0"
NAME = re.compile(r"^[a-z0-9][a-z0-9._+-]*$")
EXAMPLE = re.compile(r"^- (.+):\s*\n+`(.+)`\s*$", re.M)


def page(binary):
    name = binary.lower()
    if not NAME.match(name):
        return None
    cache = log.home() / "tldr" / f"{name}.md"
    if cache.is_file():
        return cache.read_text(encoding="utf-8")
    for platform in ("common", "windows", "linux"):
        req = urllib.request.Request(f"{BASE}/{platform}/{name}.md", headers={"User-Agent": "toolrouter"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                text = resp.read().decode("utf-8").replace("\r\n", "\n").rstrip("\n") + "\n" + CREDIT + "\n"
        except urllib.error.HTTPError as e:
            if e.code == 404:
                continue
            return None
        except OSError:
            return None
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(text, encoding="utf-8", newline="\n")
        return text
    return None


def examples(text):
    return [(d.strip(), re.sub(r"\{\{[^}]*\}\}", "{}", c.strip())) for d, c in EXAMPLE.findall(text or "")]


def words(text):
    return {t.lstrip("-").lower() for t in text.split() if not re.fullmatch(r"\{\d*\}", t)} - {""}


def summary_for(body):
    binary = body.split(" ", 1)[0]
    found = page(binary)
    if not found:
        return None
    mine = words(body)
    best, score = None, 0
    for desc, cmd in examples(found):
        shared = words(cmd) & mine
        if shared - {binary.lower()} and len(shared) > score:
            best, score = desc, len(shared)
    return best
