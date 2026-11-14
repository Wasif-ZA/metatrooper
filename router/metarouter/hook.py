import json
import os
import re
import secrets
import sys

GIT_OPTS = r"(\s+(-[Cc]\s+\S+|--\S+))*"
GH_OPTS = r"(\s+(-R\s+\S+|--repo(=|\s+)\S+))*"
RAW = re.compile(rf"^\s*MR_RAW=1\b|^\s*(cd|export|source|\.)\s[^;&|\n]*$|\bmetarouter\b|\brm\s|\bgit{GIT_OPTS}\s+(add|commit|push|reset|rebase|clean|checkout|restore|stash|merge|tag|branch)\b")
BIG = re.compile(rf"\b(pytest|jest|vitest|tsc|make|gradle|mvn|git{GIT_OPTS}\s+(diff|log|show)|gh{GH_OPTS}\s+api"
                 r"|(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build)|node\s+--test|cargo\s+(build|test|check|clippy)"
                 r"|go\s+(test|build|vet)|dotnet\s+(build|test))\b")
OPT_OUT = re.compile(r"^\s*MR_RAW=1\b|\bmetarouter\b")


def hinted(cmd):
    from metarouter import hints
    return hints.find(cmd) is not None


def heredoc(cmd):
    """`metarouter exec --stdin` with cmd verbatim in a quoted heredoc whose delimiter no line of cmd equals."""
    lines = set(cmd.split("\n"))
    tag = "MR_" + secrets.token_hex(8)
    while tag in lines:
        tag = "MR_" + secrets.token_hex(8)
    return f"metarouter exec --stdin <<'{tag}'\n{cmd}\n{tag}"


def wrap_bash(tool_input, cwd=""):
    """Return the Bash input with its command run through metarouter exec, or None to leave it raw."""
    from metarouter.log import private

    cmd = tool_input.get("command") or ""
    if not cmd.strip() or tool_input.get("run_in_background") or OPT_OUT.search(cmd) or private(cmd) or private(cwd):
        return None
    if not ((BIG.search(cmd) and not RAW.search(cmd)) or hinted(cmd)):
        return None
    return {**tool_input, "command": heredoc(cmd)}


def main():
    try:
        event = json.load(sys.stdin)
        if event.get("tool_name") != "Bash" or os.environ.get("METAROUTER_HOOK") == "off":
            return
        updated = wrap_bash(event.get("tool_input") or {}, event.get("cwd") or "")
        if updated is None:
            return
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "updatedInput": updated}}))
    except Exception:
        pass


if __name__ == "__main__":
    main()
