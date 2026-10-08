import datetime
import json
import re

from metarouter import calls
from metarouter.log import home

BREAKER_RUN = 3
BREAKER_WINDOW = datetime.timedelta(hours=1)

# when="before" matches the command before it runs; when="fail" matches the output of a failed call.
SEED = [
    {"id": "agy-add-dir", "when": "before", "match": r"(^|[;&|]\s*)agy\b(?!.*--add-dir)",
     "hint": "agy cannot read files outside its folder and returns nothing. Add --add-dir <folder>, "
             "or use: metarouter run gemini --add-dir <folder> \"<question>\""},
    {"id": "ollama-v1", "when": "before", "match": r"11434/v1/chat/completions",
     "hint": "Ollama's /v1/chat/completions returns empty content for qwen3 and gemma4. Use /api/generate "
             "with \"think\": false and an explicit num_ctx, or: metarouter run local \"<prompt>\""},
    {"id": "taskkill-node", "when": "before", "match": r"taskkill\b.*(/|//)IM\s+node(\.exe)?\b",
     "hint": "This kills every node process on the machine, including other sessions' servers. "
             "Kill the one pid instead"},
    {"id": "git-clean-x", "when": "before", "match": r"git\s+clean\s+-[a-zA-Z]*x",
     "hint": "git clean -x deletes ignored files too, which can include the only copy of local data"},
    {"id": "git-bash-date", "when": "before", "match": r"(^|[;&|(]\s*)date(\s|$|\))",
     "hint": "Git Bash on Windows can read the clock as UTC. For local time with its offset: "
             "python -c \"import datetime; print(datetime.datetime.now().astimezone().isoformat())\""},
    {"id": "foreground-sleep", "when": "before", "match": r"(^|[;&|]\s*)sleep\s+\d{2,}",
     "hint": "Long foreground sleeps are blocked by the harness. Wait on a condition, or run the job "
             "with --background and collect it with metarouter jobs <id> --wait. Waiting on a dev "
             "server: metarouter run up <port> --wait 60"},
    {"id": "curl-jina", "when": "before", "match": r"curl\b.*r\.jina\.ai/",
     "hint": "Shorter: metarouter run page <url>"},
    {"id": "gh-api-repo", "when": "before", "match": r"gh\s+api\s+/?repos/[\w.-]+/[\w.-]+/?(\s|$)",
     "hint": "For stars, licence and last push: metarouter run repo <owner/name>"},
    {"id": "playwright-browser", "when": "fail", "match": r"Executable doesn't exist at .*ms-playwright",
     "hint": "Playwright's browser build is missing for this version. playwright install chromium downloads it"},
    {"id": "cp1252", "when": "fail", "match": r"UnicodeDecodeError|UnicodeEncodeError|'charmap' codec",
     "hint": "Python on Windows reads and writes files as cp1252 by default. Pass encoding=\"utf-8\" to "
             "open, read_text and write_text"},
    {"id": "no-jq", "when": "fail", "match": r"jq: (command )?not found|command not found: jq",
     "hint": "There is no jq here. Use: metarouter run json <file> <path>"},
    {"id": "store-python", "when": "fail", "match": r"Python was not found; run without arguments to install",
     "hint": "Bare python is the Microsoft Store stub. Use the full interpreter path"},
    {"id": "module-missing", "when": "fail", "match": r"ModuleNotFoundError: No module named '([\w.]+)'",
     "hint": "That module is not installed for this interpreter. Check which python ran, then pip install it there"},
    {"id": "gh-search-recipe", "when": "before", "match": r"(^|[;&|]\s*)gh\s+search\s+repos\b",
     "hint": "Shorter: metarouter run gh-search-repos <query> (auto mode)"},
    {"id": "gh-json-field", "when": "fail", "match": r"Unknown JSON field",
     "hint": "gh lists the valid --json fields in this error, under 'Available fields'. Pick from that list"},
]


def load():
    hints = list(SEED)
    path = home() / "hints.json"
    if path.is_file():
        try:
            user = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(user, list):
                ids = {h.get("id") for h in user}
                hints = [h for h in hints if h["id"] not in ids] + [h for h in user if h.get("match")]
        except ValueError:
            pass
    return hints


def match(cmd, output=None, failed=False):
    """Return the first matching hint text: a before-hint on the command, else a fail-hint on the output."""
    for h in load():
        try:
            if h.get("when") == "before" and re.search(h["match"], cmd or ""):
                if h.get("shape") and h["shape"] != calls.shape(cmd or ""):
                    continue
                return h["hint"]
            if failed and h.get("when") == "fail" and re.search(h["match"], output or ""):
                if h.get("binary") and h["binary"] != first_word(cmd):
                    continue
                return h["hint"]
        except re.error:
            continue
    return None


def by_source():
    """Hint count per source: seed, learned, pack, user."""
    seeds = {h["id"] for h in SEED}
    out = {}
    for h in load():
        src = (h.get("source") or ("seed" if h.get("id") in seeds else "user")).split(":")[0]
        out[src] = out.get(src, 0) + 1
    return out


def first_word(cmd):
    parts = (cmd or "").split()
    return re.split(r"[/\\]", parts[0])[-1].lower() if parts else ""


def breaker_key(record):
    if record.get("recipe"):
        return "recipe:" + record["recipe"]
    return "cmd:" + (record.get("shape") or "").split(" ")[0]


def stuck(rows, shape, project, now):
    """Return a refusal when this exact command shape failed BREAKER_RUN times in a row here within the hour."""
    mine = [r for r in rows if r.get("shape") == shape and r.get("project") == project][-BREAKER_RUN:]
    if len(mine) < BREAKER_RUN or any(r.get("exit") == 0 for r in mine):
        return None
    try:
        first = datetime.datetime.fromisoformat(mine[0]["time"])
    except (KeyError, ValueError):
        return None
    if now - first > BREAKER_WINDOW:
        return None
    return (f"refused: this command failed {BREAKER_RUN} times in a row since {first:%H:%M}. "
            f"Read the last log (metarouter log --tail 40) and change the approach")


def breaker(rows, record):
    """Return a warning when this call's tool has failed BREAKER_RUN times in a row within the hour."""
    key = breaker_key(record)
    mine = [r for r in rows if breaker_key(r) == key][-BREAKER_RUN:]
    if len(mine) < BREAKER_RUN or any(r.get("exit") == 0 for r in mine):
        return None
    try:
        first = datetime.datetime.fromisoformat(mine[0]["time"])
        last = datetime.datetime.fromisoformat(record["time"])
    except (KeyError, ValueError):
        return None
    if last - first > BREAKER_WINDOW:
        return None
    name = key.split(":", 1)[1]
    return f"{name} failed {BREAKER_RUN} times in a row since {first:%H:%M}; read the log before retrying"
