import argparse
import base64
import io
from pathlib import Path

from callrouter.ingest import DEFAULT_ROOT, blocks

MAX_EDGE = 1568  # Claude's long-edge cap before tokenising an image
PREVIEW_CHARS = 2000  # inline preview Claude Code keeps when Bash output spills
SPILL_NOTE_TOKENS = 30
LIMIT_MIN_BYTES = 12_000


def image_tokens(w, h, edge):
    scale = min(1.0, edge / max(w, h))
    return max(1, int(w * scale) * int(h * scale) // 750)


def image_size(block):
    from PIL import Image

    data = (block.get("source") or {}).get("data")
    if not data:
        return None
    try:
        with Image.open(io.BytesIO(base64.b64decode(data))) as im:
            return im.size
    except Exception:
        return None


def texts(content):
    if isinstance(content, str):
        return [content]
    return [b.get("text", "") for b in content or [] if b.get("type") == "text"]


def images(content):
    if isinstance(content, str):
        return []
    return [b for b in content or [] if b.get("type") == "image"]


def load(root, since=None):
    """Per result: (tool, input, text_chars, line_lengths or None, image sizes)."""
    files = sorted(Path(root).rglob("*.jsonl"))
    calls, rows = {}, {}
    for f in files:
        with f.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                for b in blocks(line, since):
                    if b.get("type") == "tool_use" and "id" in b:
                        calls[b["id"]] = (b.get("name", "?"), b.get("input") or {})
    for f in files:
        with f.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                for b in blocks(line, since):
                    tid = b.get("tool_use_id")
                    if b.get("type") != "tool_result" or tid not in calls or tid in rows:
                        continue
                    name, inp = calls[tid]
                    body = "".join(texts(b.get("content")))
                    lines = [len(x) + 1 for x in body.split("\n")] if name == "Read" else None
                    sizes = [image_size(i) or (1568, 882) for i in images(b.get("content"))]
                    rows[tid] = (name, inp, len(body), lines, sizes)
    return rows


def simulate(rows, shell_chars, edge, line_limit, reread):
    before = after = 0
    parts = {"shell": 0, "image": 0, "read": 0}
    for name, inp, chars, lines, sizes in rows.values():
        text = chars // 4
        img_before = sum(image_tokens(w, h, MAX_EDGE) for w, h in sizes)
        img_after = sum(image_tokens(w, h, edge) for w, h in sizes)
        new_text = text
        if name == "Bash" and shell_chars and chars > shell_chars:
            new_text = min(chars, PREVIEW_CHARS) // 4 + SPILL_NOTE_TOKENS
            new_text += int(reread * (text - new_text))
            parts["shell"] += text - new_text
        elif (name == "Read" and line_limit and lines and not sizes
              and chars >= LIMIT_MIN_BYTES and len(lines) > line_limit
              and "limit" not in inp and "offset" not in inp):
            new_text = sum(lines[:line_limit]) // 4
            new_text += int(reread * (text - new_text))
            parts["read"] += text - new_text
        parts["image"] += img_before - img_after
        before += text + img_before
        after += new_text + img_after
    return before, after, parts


def main(argv=None):
    ap = argparse.ArgumentParser(prog="callrouter-simulate")
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    ap.add_argument("--since")
    ap.add_argument("--shell-chars", type=int, nargs="+", default=[2000])
    ap.add_argument("--edge", type=int, nargs="+", default=[784])
    ap.add_argument("--lines", type=int, nargs="+", default=[300])
    ap.add_argument("--reread", type=float, nargs="+", default=[0.0, 0.25])
    args = ap.parse_args(argv)

    rows = load(args.root, args.since)
    print(f"{len(rows)} tool results replayed")
    print(f"{'shell':>6}{'edge':>6}{'lines':>6}{'reread':>7}{'before':>12}{'after':>12}"
          f"{'cut':>7}{'shell':>7}{'image':>7}{'read':>7}")
    for s in args.shell_chars:
        for e in args.edge:
            for n in args.lines:
                for r in args.reread:
                    b, a, p = simulate(rows, s, e, n, r)
                    share = {k: 100 * v / b for k, v in p.items()}
                    print(f"{s:>6}{e:>6}{n:>6}{r:>7.2f}{b:>12,}{a:>12,}{100 * (b - a) / b:>6.1f}%"
                          f"{share['shell']:>6.1f}%{share['image']:>6.1f}%{share['read']:>6.1f}%")


if __name__ == "__main__":
    main()
