import argparse
import datetime
import json
import math
import time
from collections import Counter, defaultdict
from pathlib import Path

from metarouter import calls
from metarouter.log import no_private_warning, private

IMAGE_TOKENS = 1500
CAPS = (400, 800, 2000, 4000)
BIG_READ_TOKENS = 10_000  # about 40 KB at four bytes per token
DEFAULT_ROOT = Path.home() / ".claude" / "projects"
OUT_DIR = Path.home() / ".metarouter"


def result_cost(content):
    """Return (text_tokens, image_count) for a tool_result content field."""
    if isinstance(content, str):
        return len(content) // 4, 0
    text, images = 0, 0
    for block in content or []:
        if block.get("type") == "image":
            images += 1
        elif block.get("type") == "text":
            text += len(block.get("text", "")) // 4
    return text, images


def when(value):
    """Parse an ISO time as an aware datetime; no offset means UTC. None when it does not parse."""
    if isinstance(value, datetime.datetime):
        dt = value
    else:
        try:
            dt = datetime.datetime.fromisoformat(value)
        except (TypeError, ValueError):
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)


def in_window(stamp, since, until):
    if not since and not until:
        return True
    t = when(stamp)
    if t is None:
        return False
    return (not since or t >= when(since)) and (not until or t < when(until))


def blocks(line, since, until=None):
    try:
        entry = json.loads(line)
    except json.JSONDecodeError:
        return []
    if not isinstance(entry, dict):
        return []
    if not in_window(entry.get("timestamp"), since, until):
        return []
    content = (entry.get("message") or {}).get("content")
    return content if isinstance(content, list) else []


def touches_private(line):
    try:
        entry = json.loads(line)
    except json.JSONDecodeError:
        return False
    if not isinstance(entry, dict):
        return False
    if private(str(entry.get("cwd") or "")):
        return True
    content = (entry.get("message") or {}).get("content")
    return isinstance(content, list) and any(
        isinstance(b, dict) and b.get("type") == "tool_use" and private(json.dumps(b.get("input") or {}))
        for b in content)


def scan(root, since=None, until=None):
    """Two passes: map tool_use_id to its call, then attribute each result to it. Private sessions are skipped."""
    root = Path(root)
    files = [root] if root.is_file() else sorted(root.rglob("*.jsonl"))
    calls, kept = {}, []
    for f in files:
        mine = {}
        with f.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if touches_private(line):
                    mine = None
                    break
                for b in blocks(line, since, until):
                    if b.get("type") == "tool_use" and "id" in b:
                        mine[b["id"]] = (b.get("name", "?"), b.get("input") or {}, f.parent.name)
        if mine is not None:
            calls.update(mine)
            kept.append(f)
    results = {}
    for f in kept:
        with f.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                for b in blocks(line, since, until):
                    tid = b.get("tool_use_id")
                    if b.get("type") == "tool_result" and tid in calls and tid not in results:
                        text, images = result_cost(b.get("content"))
                        results[tid] = (text, images, bool(b.get("is_error")))
    return len(files), calls, results


def pct(sorted_vals, p):
    if not sorted_vals:
        return 0
    return sorted_vals[min(len(sorted_vals) - 1, math.ceil(p / 100 * len(sorted_vals)) - 1)]


def summarise(calls, results):
    by_tool = defaultdict(lambda: {"calls": 0, "tokens": 0, "errors": 0})
    shell, big_read, images, repeats = [], 0, 0, Counter()
    for tid, (text, imgs, err) in results.items():
        name, inp, project = calls[tid]
        key = "mcp" if name.startswith("mcp__") else name
        tokens = text + imgs * IMAGE_TOKENS
        t = by_tool[key]
        t["calls"] += 1
        t["tokens"] += tokens
        t["errors"] += err
        images += imgs
        if name in ("Bash", "PowerShell"):
            shell.append(tokens)
            repeats[(project, inp.get("command", ""))] += 1
        if name == "Read" and not imgs and text > BIG_READ_TOKENS:
            big_read += text - BIG_READ_TOKENS
    total = sum(t["tokens"] for t in by_tool.values())
    shell.sort()
    return {
        "total_tokens": total,
        "results": len(results),
        "tools": {k: {**v, "share": round(100 * v["tokens"] / (total or 1), 2)}
                  for k, v in sorted(by_tool.items(), key=lambda kv: -kv[1]["tokens"])},
        "image_blocks": images,
        "image_tokens": images * IMAGE_TOKENS,
        "shell": {
            "calls": len(shell),
            "median": pct(shell, 50), "p90": pct(shell, 90), "p99": pct(shell, 99),
            "max": shell[-1] if shell else 0,
            "cap_saves": {c: sum(max(0, s - c) for s in shell) for c in CAPS},
            "exact_repeat_calls": sum(n - 1 for n in repeats.values() if n > 1),
        },
        "read_over_40kb_saves": big_read,
        "shell_read_tokens": sum(t["tokens"] for k, t in by_tool.items() if k in ("Bash", "PowerShell", "Read")),
    }


def saved_tokens(rows, since=None, until=None):
    """Output kept out of context, estimated as (bytes - shown_bytes) // 4 per printed call. Not billed tokens:
    a shorter result can still cost more if the agent needs extra turns."""
    total = 0
    for r in rows:
        if "shown_bytes" not in r or private(str(r.get("project") or "")):
            continue
        if when(r.get("time")) is None or not in_window(r.get("time"), since, until):
            continue
        total += max(0, (r.get("bytes", 0) - r["shown_bytes"]) // 4)
    return total


def report(s, n_files):
    print(f"{n_files} transcripts, {s['results']} tool results, {s['total_tokens']:,} tokens")
    total = s["total_tokens"] or 1
    print(f"\n{'tool':<22}{'calls':>7}{'tokens':>12}{'share':>8}{'errors':>8}")
    for name, t in list(s["tools"].items())[:12]:
        print(f"{name:<22}{t['calls']:>7}{t['tokens']:>12,}{t['share']:>7.1f}%{t['errors']:>8}")
    sh = s["shell"]
    print(f"\nimages: {s['image_blocks']} blocks, {s['image_tokens']:,} tokens "
          f"({100 * s['image_tokens'] / total:.1f}%)")
    print(f"shell: median {sh['median']}, p90 {sh['p90']}, p99 {sh['p99']}, max {sh['max']}")
    for cap, saved in sh["cap_saves"].items():
        print(f"  cap {cap:>5}: saves {saved:>10,} ({100 * saved / total:.1f}% of all)")
    print(f"  exact repeats: {sh['exact_repeat_calls']} calls")
    print(f"Read results over 40 KB, excess above the cap: {s['read_over_40kb_saves']:,} "
          f"({100 * s['read_over_40kb_saves'] / total:.1f}% of all)")


def main(argv=None, how="human"):
    ap = argparse.ArgumentParser(prog="metarouter")
    sub = ap.add_subparsers(dest="cmd", required=True)
    ing = sub.add_parser("ingest", help="measure where tool-result tokens go")
    ing.add_argument("--root", help="a Claude Code transcripts folder; reads only that")
    ing.add_argument("--from", dest="agents", help="claude,codex,gemini,opencode (default: every agent found)")
    ing.add_argument("--since", help="ISO timestamp, e.g. 2026-09-27T00:00")
    ing.add_argument("--until", help="ISO timestamp, exclusive; no offset means UTC")
    ing.add_argument("--no-save", action="store_true")
    args = ap.parse_args(argv)
    for flag in ("since", "until"):
        if getattr(args, flag) and when(getattr(args, flag)) is None:
            ap.error(f"--{flag} is not an ISO timestamp: {getattr(args, flag)}")

    from metarouter import transcripts
    try:
        agents = ["claude"] if args.root else transcripts.parse_from(args.agents) or transcripts.found()
    except ValueError as e:
        ap.error(str(e))
    n_files, calls_, results = scan(args.root or DEFAULT_ROOT, args.since, args.until) if "claude" in agents else (0, {}, {})
    others = [a for a in agents if a != "claude"]
    for i, (agent, sess) in enumerate(transcripts.sessions(others, args.since) if others else []):
        n_files += 1
        for j, (cmd, failed, out) in enumerate(sess):
            calls_[f"{agent}-{i}-{j}"] = ("Bash", {"command": cmd}, agent)
            results[f"{agent}-{i}-{j}"] = (len(out) // 4, 0, failed)
    s = summarise(calls_, results)
    s["saved_tokens"] = saved_tokens(calls.read(), args.since, args.until)
    out = None
    if not args.no_save:
        OUT_DIR.mkdir(exist_ok=True)
        out = OUT_DIR / f"ingest-{time.strftime('%Y%m%dT%H%M%S')}.json"
        out.write_text(json.dumps({"since": args.since, "transcripts": n_files, **s}, indent=1),
                       encoding="utf-8")
    warning = no_private_warning()
    if how == "json":
        print(json.dumps({"ok": True, "exit": 0, **({"warning": warning} if warning else {}),
                          "shell_read_tokens": s["shell_read_tokens"],
                          "saved_tokens": s["saved_tokens"], "out": {"transcripts": n_files,
                          "saved": out.as_posix() if out else None, **s}}))
        return
    if warning:
        print(warning, end="\n\n")
    report(s, n_files)
    if out:
        print(f"\nsaved {out}")


if __name__ == "__main__":
    main()
