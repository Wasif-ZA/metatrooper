"""Needle survival and size for metarouter's shrinker on the recorded Bash corpus.

Uses the corpus loader, needle rules and matching rule from headroom_bench.py. Prints
aggregates only, never command or output text.

    python bench/shrink_bench.py --limit 0
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from headroom_bench import load_corpus, needles, survived, tok  # noqa: E402
from metarouter.shrink import clean, shrink  # noqa: E402


def seen_by_agent(text, failed):
    s = shrink(clean(text), failed=failed)
    out = s["out"] if isinstance(s["out"], str) or s["out"] is None else json.dumps(s["out"], ensure_ascii=False)
    return "\n".join([out or "", *s["errors"], *s["tail"]])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="0 = whole corpus")
    ap.add_argument("--min-tokens", type=int, default=250)
    args = ap.parse_args()

    corpus = load_corpus(args.min_tokens, args.limit)
    orig_tok = out_tok = total = kept = 0
    by_kind = {}
    for r in corpus:
        orig = r["output"]
        shown = seen_by_agent(orig, r["failed"])
        orig_tok += tok(orig)
        out_tok += tok(shown)
        for kind, n in needles(orig):
            ok = survived(n, shown)
            total += 1
            kept += ok
            k = by_kind.setdefault(kind, [0, 0])
            k[0] += ok
            k[1] += 1
    print(json.dumps({
        "outputs": len(corpus),
        "tokens_in": orig_tok,
        "tokens_out": out_tok,
        "reduction_pct": round(100 * (1 - out_tok / orig_tok), 1) if orig_tok else 0,
        "needles": total,
        "survival_pct": round(100 * kept / total, 2) if total else 100.0,
        "by_kind": {k: f"{a}/{b}" for k, (a, b) in by_kind.items()},
    }, indent=1))


if __name__ == "__main__":
    main()
