import argparse
import json
import math
import time
from collections import Counter, defaultdict
from pathlib import Path

IMAGE_TOKENS = 1500
CAPS = (400, 800, 2000, 4000)
BIG_READ_TOKENS = 10_000  # about 40 KB at four bytes per token
DEFAULT_ROOT = Path.home() / ".claude" / "projects"
OUT_DIR = Path.home() / ".callrouter"


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


def blocks(line, since):
    try:
        entry = json.loads(line)
    except json.JSONDecodeError:
        return []
    if not isinstance(entry, dict):
        return []
    if since and entry.get("timestamp", "") < since:
        return []
    content = (entry.get("message") or {}).get("content")
    return content if isinstance(content, list) else []


def scan(root, since=None):
    """Two passes: map tool_use_id to its call, then attribute each result to it."""
    files = sorted(Path(root).rglob("*.jsonl"))
    calls = {}
    for f in files:
        with f.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                for b in blocks(line, since):
                    if b.get("type") == "tool_use" and "id" in b:
                        calls[b["id"]] = (b.get("name", "?"), b.get("input") or {}, f.parent.name)
    results = {}
    for f in files:
        with f.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                for b in blocks(line, since):
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
    }


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
    ap = argparse.ArgumentParser(prog="callrouter")
    sub = ap.add_subparsers(dest="cmd", required=True)
    ing = sub.add_parser("ingest", help="measure where tool-result tokens go")
    ing.add_argument("--root", default=str(DEFAULT_ROOT))
    ing.add_argument("--since", help="ISO timestamp, e.g. 2026-09-27T00:00")
    ing.add_argument("--no-save", action="store_true")
    args = ap.parse_args(argv)

    n_files, calls, results = scan(args.root, args.since)
    s = summarise(calls, results)
    out = None
    if not args.no_save:
        OUT_DIR.mkdir(exist_ok=True)
        out = OUT_DIR / f"ingest-{time.strftime('%Y%m%dT%H%M%S')}.json"
        out.write_text(json.dumps({"since": args.since, "transcripts": n_files, **s}, indent=1),
                       encoding="utf-8")
    if how == "json":
        print(json.dumps({"ok": True, "lane": "ingest", "transcripts": n_files,
                          "saved": out.as_posix() if out else None, **s}))
        return
    report(s, n_files)
    if out:
        print(f"\nsaved {out}")


if __name__ == "__main__":
    main()
