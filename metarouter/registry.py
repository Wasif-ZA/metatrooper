import json
import re
import urllib.parse
import urllib.request

API = "https://registry.modelcontextprotocol.io/v0/servers"
RUNNERS = {"npm": "npx", "pypi": "uvx", "oci": "docker"}


def fetch(words, limit=30):
    q = urllib.parse.urlencode({"search": words, "version": "latest", "limit": limit})
    req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": "metarouter"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return [s["server"] for s in json.loads(resp.read()).get("servers", [])]


def flat(arguments):
    """Registry arguments to argv. Ones holding an unfilled {variable} are optional extras and are left out."""
    out = []
    for a in arguments or []:
        value = a.get("value") or a.get("default")
        if not value or "{" in value:
            continue
        out += [a["name"], value] if a.get("type") == "named" else [value]
    return out


def launch(server):
    """Return a stdio spec {command, args, env: [required names]} or None for remote-only servers."""
    for p in server.get("packages") or []:
        if (p.get("transport") or {}).get("type") != "stdio" or p.get("registryType") not in RUNNERS:
            continue
        kind, ident, ver = p["registryType"], p["identifier"], p.get("version")
        cmd = p.get("runtimeHint") or RUNNERS[kind]
        pinned = {"npm": f"{ident}@{ver}", "pypi": f"{ident}=={ver}"}.get(kind, ident) if ver else ident
        run_args = flat(p.get("runtimeArguments"))
        if kind == "oci":
            run_args = ["run", "-i", "--rm", *run_args]
        if kind == "npm" and "-y" not in run_args:
            run_args.insert(0, "-y")
        pkg_args = flat(p.get("packageArguments"))
        env = [e["name"] for e in p.get("environmentVariables") or [] if e.get("isRequired")]
        return {"command": cmd, "args": [*run_args, pinned, *pkg_args], "env": env}
    for r in server.get("remotes") or []:
        if r.get("type") != "streamable-http" or not r.get("url"):
            continue
        headers, env = {}, []
        for h in r.get("headers") or []:
            value = h.get("value") or ""
            if "{" in value and not h.get("isRequired"):
                continue
            for var in re.findall(r"\{([^{}]+)\}", value):
                env.append(var)
                value = value.replace("{" + var + "}", "${" + var + "}")
            if value:
                headers[h["name"]] = value
        return {"url": r["url"], "headers": headers, "env": env}
    return None


def search(words, limit=10):
    out = []
    for s in fetch(words):
        spec = launch(s)
        if spec and s["name"] not in {o["name"] for o in out}:
            out.append({"name": s["name"], "summary": (s.get("description") or "")[:120], **spec})
        if len(out) >= limit:
            break
    return out


def spec(name):
    for s in fetch(name, limit=50):
        if s["name"] == name:
            found = launch(s)
            if found:
                return found
            raise KeyError(f"{name} is remote-only in the registry; metarouter speaks stdio")
    raise KeyError(f'no MCP server "{name}" in the public registry. Try: metarouter mcp search <words>')
