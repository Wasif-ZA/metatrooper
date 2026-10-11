import hashlib
import json
import os
import re
import sys
from pathlib import Path

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
MAX_EDGE = 784  # half of Claude's 1568 px long-edge cap, so a quarter of the tokens
LINE_LIMIT = 300
MIN_BYTES_FOR_LIMIT = 12_000  # about 300 lines of typical source
SKIP_EXTS = {".pdf", ".ipynb"}
CACHE = Path.home() / ".cache" / "metarouter" / "img"


def shrink_image(path, cache=None):
    from PIL import Image

    cache = cache or CACHE
    st = path.stat()
    key = hashlib.sha1(f"{path.resolve()}|{st.st_mtime_ns}|{st.st_size}".encode()).hexdigest()[:16]
    out = cache / f"{key}.png"
    if out.exists():
        return out
    with Image.open(path) as im:
        if max(im.size) <= MAX_EDGE:
            return None
        im.thumbnail((MAX_EDGE, MAX_EDGE))
        cache.mkdir(parents=True, exist_ok=True)
        im.save(out)
    return out


def decide(tool_input):
    """Return the updated Read input, or None to leave the call alone."""
    fp = tool_input.get("file_path")
    if not fp:
        return None
    path = Path(fp)
    if not path.is_file():
        return None
    ext = path.suffix.lower()
    if ext in IMAGE_EXTS:
        small = shrink_image(path)
        return {**tool_input, "file_path": str(small)} if small else None
    if ext in SKIP_EXTS or "limit" in tool_input or "offset" in tool_input:
        return None
    if path.stat().st_size < MIN_BYTES_FOR_LIMIT:
        return None
    return {**tool_input, "limit": LINE_LIMIT}


RAW = re.compile(r"^\s*MR_RAW=1\b|^\s*(cd|export|source|\.)\s[^;&|\n]*$|\bmetarouter\b|\brm\s|\bgit\s+(add|commit|push|reset|rebase|clean|checkout|restore|stash|merge|tag|branch)\b")


def wrap_bash(tool_input, cwd=""):
    """Return the Bash input with its command run through metarouter exec, or None to leave it raw."""
    from metarouter.log import private

    cmd = tool_input.get("command") or ""
    if not cmd.strip() or tool_input.get("run_in_background") or RAW.search(cmd) or private(cmd) or private(cwd):
        return None
    quoted = "'" + cmd.replace("'", "'\\''") + "'"
    return {**tool_input, "command": f"metarouter exec -- {quoted}"}


def main():
    try:
        event = json.load(sys.stdin)
        tool = event.get("tool_name")
        if tool == "Bash":
            if os.environ.get("METAROUTER_HOOK") == "off":
                return
            updated = wrap_bash(event.get("tool_input") or {}, event.get("cwd") or "")
            decision = {}
        elif tool == "Read":
            updated = decide(event.get("tool_input") or {})
            decision = {"permissionDecision": "allow"}
        else:
            return
        if updated is None:
            return
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            **decision,
            "updatedInput": updated,
        }}))
    except Exception:
        pass


if __name__ == "__main__":
    main()
