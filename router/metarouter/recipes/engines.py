import os
import re
from pathlib import Path

from metarouter.log import config

LOCAL_LANES = {"extract", "audit", "commit", "edit", "work", "look", "ask", "models", "--doctor", "--test"}
LOCAL_MODEL = "gemma4:12b"
CODEX_VALUE_FLAGS = {"--model", "--effort", "--resume"}
CODEX_BARE_FLAGS = {"--write", "--fresh", "--resume-last"}
VALUE_FLAGS = ("--model", "--effort", "--resume", "--add-dir", "--dir", "--lane", "--timeout", "--base", "--scope")
FALLS_BACK = {"codex", "gemini"}
LIMIT = re.compile(r"usage limit|rate limit|\b429\b|quota|RESOURCE_EXHAUSTED|too many requests|limit reached", re.I)
FILE_WORD =re.compile(r"[\w./\\-]+\.(?:pdf|png|jpe?g|webp|md|py|txt|json|csv|html?|docx?|pptx?|xlsx?)\b", re.I)

RECIPES = [
    {"name": "codex", "summary": "ask Codex to do a task and wait for its answer",
     "args": ["prompt", "--write", "--model", "--effort", "--prompt-file"], "purity": "external", "engine": "codex"},
    {"name": "codex-review", "summary": "Codex code review of the current changes, waits for the verdict",
     "args": ["--base", "--scope"], "purity": "external", "engine": "codex-review"},
    {"name": "gemini", "summary": "ask Gemini through agy; file questions need --add-dir",
     "args": ["prompt", "--dir", "--add-dir", "--lane", "--prompt-file"], "purity": "external", "engine": "gemini"},
    {"name": "local", "summary": "ask a local Ollama model through your local runner script",
     "args": ["prompt", "--model", "--prompt-file"], "purity": "read", "engine": "local"},
]


def version_key(p):
    return [int(x) if x.isdigit() else 0 for x in re.split(r"[.-]", p.parts[-3])]


def codex_companion():
    if os.environ.get("METAROUTER_CODEX_COMPANION"):
        return os.environ["METAROUTER_CODEX_COMPANION"]
    found = sorted((Path.home() / ".claude" / "plugins" / "cache" / "openai-codex" / "codex")
                   .glob("*/scripts/codex-companion.mjs"), key=version_key)
    if not found:
        raise FileNotFoundError("codex-companion.mjs not found. Install the Codex plugin or set "
                                "METAROUTER_CODEX_COMPANION")
    return str(found[-1])


def script(engine):
    """Path of the runner script config.json names for this engine under "engines"."""
    path = (config().get("engines") or {}).get(engine)
    if not path:
        raise FileNotFoundError(f'no runner script for {engine}. Set "engines": {{"{engine}": "<path>"}} '
                                f"in ~/.metarouter/config.json")
    if not Path(path).is_file():
        raise FileNotFoundError(f"{path} not found. Fix engines.{engine} in ~/.metarouter/config.json")
    return path


def scripts():
    """File names of every configured runner script."""
    return [Path(p).name for p in (config().get("engines") or {}).values() if isinstance(p, str)]


def take(args, flag):
    """Remove every `flag value` pair from args. Return (values, remaining args)."""
    values, rest, i = [], [], 0
    while i < len(args):
        if args[i] == flag and i + 1 < len(args) and not args[i + 1].startswith("--"):
            values.append(args[i + 1])
            i += 2
        else:
            rest.append(args[i])
            i += 1
    return values, rest


def has_prompt(args):
    """True when some argument is not a Codex flag or a flag's value."""
    i = 0
    while i < len(args):
        if args[i] in CODEX_VALUE_FLAGS:
            i += 2
            continue
        if args[i] not in CODEX_BARE_FLAGS:
            return True
        i += 1
    return False


def argv(recipe, args, shell):
    """Return the argument list that runs this engine. Raises ValueError on a bad call."""
    engine = recipe["engine"]
    files, args = take(args, "--prompt-file")
    if files:
        args = [*args, Path(files[-1]).read_text(encoding="utf-8")]
    if engine == "codex":
        if not has_prompt(args):
            raise ValueError('codex needs a prompt: metarouter run codex "<task>"')
        return ["node", codex_companion(), "task", *args]
    if engine == "codex-review":
        return ["node", codex_companion(), "review", "--wait", *args]
    if engine == "gemini":
        dirs, rest = take(args, "--add-dir")
        lanes, rest = take(rest, "--lane")
        workdirs, rest = take(rest, "--dir")
        passed = []
        for flag in ("--model", "--timeout", "--effort"):
            vals, rest = take(rest, flag)
            passed += [flag, vals[-1]] if vals else []
        prompt = " ".join(rest)
        if not prompt:
            raise ValueError('gemini needs a prompt: metarouter run gemini "<question>"')
        if FILE_WORD.search(prompt) and not dirs and not workdirs:
            raise ValueError("this question names a file but has no --add-dir or --dir. agy cannot read "
                             "files outside its folder and comes back empty. Add --dir <folder>")
        cmd = [shell, script("gemini"), "--lane", (lanes or ["second-opinion"])[-1],
               "--prompt", prompt, *passed]
        for d in workdirs[-1:]:
            cmd += ["--dir", d]
        for d in dirs:
            cmd += ["--add-dir", d]
        return cmd
    if engine == "local":
        lanes, args = take(args, "--lane")
        if lanes:
            args = [lanes[-1], *args]
        if args and args[0] in LOCAL_LANES:
            return [shell, script("local"), *args]
        models, rest = take(args, "--model")
        prompt = " ".join(rest)
        if not prompt:
            raise ValueError('local needs a prompt: metarouter run local "<prompt>"')
        return [shell, script("local"), "ask", (models or [config().get("local_model") or LOCAL_MODEL])[-1], prompt]
    raise ValueError(f"unknown engine {engine}")


def limit_hit(engine, code, output):
    """The limit text that makes a failed codex or gemini call worth retrying elsewhere, else None."""
    if code == 0 or engine not in FALLS_BACK:
        return None
    m = LIMIT.search(output)
    return m.group(0) if m else None


def prompt_of(args):
    """The bare prompt from an engine call, without any engine's flags."""
    files, args = take(args, "--prompt-file")
    if files:
        args = [*args, Path(files[-1]).read_text(encoding="utf-8")]
    for flag in VALUE_FLAGS:
        _, args = take(args, flag)
    return " ".join(a for a in args if a not in CODEX_BARE_FLAGS)


def fallbacks(failed, args, shell):
    """Yield (engine, argv) for each engine in config "fallback" that is set up, skipping the one that failed."""
    prompt = prompt_of(args)
    dirs = [x for flag in ("--dir", "--add-dir") for v in take(args, flag)[0] for x in (flag, v)]
    for engine in config().get("fallback") or []:
        if engine == failed or engine not in ("codex", "gemini", "local"):
            continue
        try:
            yield engine, argv({"engine": engine}, [*(dirs if engine == "gemini" else []), prompt], shell)
        except (ValueError, FileNotFoundError):
            continue
