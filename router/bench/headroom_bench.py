"""Benchmark Headroom's compressor against dumb truncation on real recorded tool output.

Answers one question: does Headroom save enough tokens on this workload, without
eating the answer, to make building metarouter unnecessary?

Corpus is real Bash tool_results pulled from local Claude Code transcripts. Nothing
leaves the machine: headroom.compress() is a library call with no network path.

Usage:
    python bench/headroom_bench.py --limit 60
    python bench/headroom_bench.py --limit 0 --json out.json    # whole corpus
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import statistics
import sys
import time

TRANSCRIPTS = os.path.expanduser("~/.claude/projects")

# Patterns worth preserving. If compression drops these, the agent has to re-run
# the command and the saving is negative.
NEEDLE_PATTERNS = [
    (r"(?m)^.*Traceback \(most recent call last\).*$", "traceback"),
    (r"(?m)^.*(?:command not found|No such file or directory).*$", "missing"),
    (r"(?m)^.*(?:^|\s)(?:fatal|error|ERROR|FAILED|Exception):.*$", "error"),
    (r"(?m)^.*Exit code \d+.*$", "exitcode"),
]


def tok(s: str) -> int:
    """Cheap token estimate. Consistent across arms, which is what matters here."""
    return len(s) // 4


def blocks(msg):
    c = msg.get("content")
    return [b for b in c if isinstance(b, dict)] if isinstance(c, list) else []


def load_corpus(min_tokens: int, limit: int):
    """Real (command, output) pairs from Bash tool results, largest first."""
    files = glob.glob(os.path.join(TRANSCRIPTS, "**", "*.jsonl"), recursive=True)
    names, inputs = {}, {}
    for f in files:
        for line in open(f, encoding="utf-8", errors="replace"):
            try:
                d = json.loads(line)
            except Exception:
                continue
            m = d.get("message")
            if isinstance(m, dict):
                for b in blocks(m):
                    if b.get("type") == "tool_use":
                        names[b.get("id")] = b.get("name")
                        inputs[b.get("id")] = b.get("input", {})

    seen, out = set(), []
    for f in files:
        for line in open(f, encoding="utf-8", errors="replace"):
            try:
                d = json.loads(line)
            except Exception:
                continue
            m = d.get("message")
            if not isinstance(m, dict):
                continue
            for b in blocks(m):
                if b.get("type") != "tool_result":
                    continue
                tid = b.get("tool_use_id")
                if tid in seen or names.get(tid) != "Bash":
                    continue
                seen.add(tid)
                c = b.get("content")
                s = c if isinstance(c, str) else json.dumps(c)
                if tok(s) < min_tokens:
                    continue
                out.append({
                    "id": tid,
                    "cmd": str(inputs.get(tid, {}).get("command", ""))[:200],
                    "output": s,
                    "tokens": tok(s),
                    "failed": bool(b.get("is_error")),
                })
    out.sort(key=lambda r: -r["tokens"])
    return out[:limit] if limit else out


def needles(text: str):
    """Lines that must survive compression, plus the final line, which is often the answer."""
    found = []
    for pat, kind in NEEDLE_PATTERNS:
        for m in re.findall(pat, text):
            line = m.strip()
            if 8 <= len(line) <= 300:
                found.append((kind, line))
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if lines and 8 <= len(lines[-1]) <= 300:
        found.append(("lastline", lines[-1]))
    # dedupe, preserve order
    seen, uniq = set(), []
    for k, v in found:
        if v not in seen:
            seen.add(v)
            uniq.append((k, v))
    return uniq


def survived(needle: str, text: str) -> bool:
    """Exact substring, else a generous token-overlap fallback for reflowed text."""
    if needle in text:
        return True
    words = [w for w in re.split(r"\W+", needle) if len(w) > 3]
    if not words:
        return False
    hits = sum(1 for w in words if w in text)
    return hits / len(words) >= 0.8


def truncate(text: str, budget_tokens: int) -> str:
    """The baseline metarouter would ship: keep the head and the tail, drop the middle."""
    if tok(text) <= budget_tokens:
        return text
    budget = budget_tokens * 4
    head = int(budget * 0.4)
    tail = budget - head
    return f"{text[:head]}\n... [{tok(text) - budget_tokens} tokens elided] ...\n{text[-tail:]}"


ERROR_LINE = re.compile(
    r"(?i)(traceback|command not found|no such file|^\s*fatal:|^\s*error[: ]|"
    r"exception|failed|exit code [1-9])")


def smart_cap(text: str, budget_tokens: int) -> str:
    """Cap, but never drop a line that looks like an error.

    Borrowed from Headroom's `router:protected:error_output`, which fired on 108 of
    1,028 recorded outputs. Error lines are both the most likely to matter and a
    tiny share of the bytes, so protecting them is nearly free.
    """
    if tok(text) <= budget_tokens:
        return text
    lines = text.splitlines()
    errs = [ln for ln in lines if ERROR_LINE.search(ln)]
    err_blob = "\n".join(errs[:40])
    remaining = budget_tokens - tok(err_blob)
    if remaining < budget_tokens // 4:      # errors ate the budget, keep them and stop
        return err_blob
    body = truncate(text, remaining)
    return f"{body}\n--- preserved error lines ---\n{err_blob}" if errs else body


def as_messages(output: str):
    """Anthropic-shaped conversation carrying one tool result."""
    return [
        {"role": "user", "content": "run the command"},
        {"role": "assistant", "content": [
            {"type": "tool_use", "id": "toolu_bench", "name": "Bash",
             "input": {"command": "x"}},
        ]},
        {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_bench", "content": output},
        ]},
    ]


def extract_tool_result(messages) -> str:
    """Only the tool_result payload.

    Comparing the whole returned conversation against the bare input output is not
    apples to apples: the scaffold messages and the serialised tool_use block add
    tokens the original never had, which swamps the saving on smaller items and
    makes a working compressor look like a no-op.
    """
    parts = []
    for m in messages:
        c = m.get("content")
        if not isinstance(c, list):
            continue
        for b in c:
            if isinstance(b, dict) and b.get("type") == "tool_result":
                tc = b.get("content")
                if isinstance(tc, str):
                    parts.append(tc)
                elif isinstance(tc, list):
                    for p in tc:
                        if isinstance(p, dict):
                            parts.append(p.get("text") or json.dumps(p))
                        else:
                            parts.append(str(p))
                else:
                    parts.append(json.dumps(tc))
    return "\n".join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=60, help="0 = whole corpus")
    ap.add_argument("--min-tokens", type=int, default=250,
                    help="Headroom's own floor is 250")
    ap.add_argument("--cap", type=int, default=400,
                    help="fixed cap for the metarouter arm")
    ap.add_argument("--json", type=str, default="")
    args = ap.parse_args()

    try:
        from headroom import compress
        from headroom.compress import CompressConfig
    except ImportError:
        print("headroom-ai not importable. Install: uv tool install headroom-ai")
        return 2

    corpus = load_corpus(args.min_tokens, args.limit)
    if not corpus:
        print("empty corpus")
        return 1
    print(f"corpus: {len(corpus)} Bash outputs >= {args.min_tokens} tok, "
          f"{sum(r['tokens'] for r in corpus):,} tokens total\n")

    # Defaults would no-op this benchmark: tool results ride on user messages, and
    # the last 4 messages are protected.
    cfg = CompressConfig(
        compress_user_messages=True,
        protect_recent=0,
        min_tokens_to_compress=args.min_tokens,
    )

    rows, errors = [], 0
    t0 = time.time()
    for i, r in enumerate(corpus, 1):
        orig = r["output"]
        nds = needles(orig)
        try:
            res = compress(as_messages(orig), model="claude-sonnet-4-5-20250929",
                           config=cfg)
            hr_text = extract_tool_result(res.messages)
            hr_tok = tok(hr_text)
        except Exception as e:
            errors += 1
            if errors <= 3:
                print(f"  compress() failed on #{i}: {type(e).__name__}: {e}")
            continue

        # Arm 2: truncation sized to whatever Headroom produced. Equal-budget
        # quality check. When Headroom no-ops this arm no-ops too, by construction.
        tr_text = truncate(orig, max(hr_tok, 1))
        # Arm 3: the fixed cap metarouter would actually ship. This is the arm that
        # decides the project, because it saves regardless of what any router thinks.
        cap_text = truncate(orig, args.cap)
        smart_text = smart_cap(orig, args.cap)
        rows.append({
            "tokens_in": r["tokens"],
            "hr_tokens": hr_tok,
            "hr_self_before": res.tokens_before,
            "hr_self_after": res.tokens_after,
            "transforms": ",".join(res.transforms_applied) or "none",
            "tr_tokens": tok(tr_text),
            "cap_tokens": tok(cap_text),
            "smart_tokens": tok(smart_text),
            "needles": len(nds),
            "hr_kept": sum(1 for _, n in nds if survived(n, hr_text)),
            "tr_kept": sum(1 for _, n in nds if survived(n, tr_text)),
            "cap_kept": sum(1 for _, n in nds if survived(n, cap_text)),
            "smart_kept": sum(1 for _, n in nds if survived(n, smart_text)),
            "cmd": r["cmd"][:60],
        })
        if i % 20 == 0:
            print(f"  ...{i}/{len(corpus)}")

    if not rows:
        print(f"\nNo rows produced. compress() failed {errors} times.")
        return 1

    el = time.time() - t0
    tin = sum(r["tokens_in"] for r in rows)
    hr = sum(r["hr_tokens"] for r in rows)
    tr = sum(r["tr_tokens"] for r in rows)
    cap = sum(r["cap_tokens"] for r in rows)
    nd = sum(r["needles"] for r in rows)
    hrk = sum(r["hr_kept"] for r in rows)
    trk = sum(r["tr_kept"] for r in rows)
    capk = sum(r["cap_kept"] for r in rows)
    sm = sum(r["smart_tokens"] for r in rows)
    smk = sum(r["smart_kept"] for r in rows)

    print(f"\n{'':24}{'tokens out':>12}{'saved':>12}{'reduction':>11}")
    print(f"{'original':24}{tin:>12,}{'-':>12}{'-':>11}")
    print(f"{'headroom':24}{hr:>12,}{tin-hr:>12,}{100*(tin-hr)/tin:>10.1f}%")
    print(f"{'truncate (same size)':24}{tr:>12,}{tin-tr:>12,}{100*(tin-tr)/tin:>10.1f}%")
    print(f"{'fixed cap ' + str(args.cap) + ' tok':24}{cap:>12,}{tin-cap:>12,}"
          f"{100*(tin-cap)/tin:>10.1f}%")
    print(f"{'smart cap ' + str(args.cap) + ' tok':24}{sm:>12,}{tin-sm:>12,}"
          f"{100*(tin-sm)/tin:>10.1f}%")

    print(f"\nneedle survival ({nd} needles across {len(rows)} outputs)")
    if nd:
        print(f"  headroom      : {hrk}/{nd}  ({100*hrk/nd:.1f}%)")
        print(f"  truncate      : {trk}/{nd}  ({100*trk/nd:.1f}%)")
        print(f"  fixed cap {args.cap:<4}: {capk}/{nd}  ({100*capk/nd:.1f}%)")
        print(f"  smart cap {args.cap:<4}: {smk}/{nd}  ({100*smk/nd:.1f}%)")
    else:
        print("  no needles found in corpus")

    import collections
    tf = collections.Counter(r["transforms"] for r in rows)
    print("\ntransforms applied")
    for k, v in tf.most_common(6):
        print(f"  {v:>4}x  {k}")

    unchanged = sum(1 for r in rows if r["hr_tokens"] >= r["tokens_in"])
    print(f"\noutputs headroom did not shrink: {unchanged}/{len(rows)} "
          f"({100*unchanged/len(rows):.0f}%)")
    print(f"errors: {errors}   elapsed: {el:.1f}s   "
          f"({el/max(len(rows),1)*1000:.0f} ms per output)")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({"rows": rows, "totals": {
                "tokens_in": tin, "headroom": hr, "truncate": tr,
                "needles": nd, "hr_kept": hrk, "tr_kept": trk,
                "errors": errors, "elapsed_s": el}}, fh, indent=2)
        print(f"wrote {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
