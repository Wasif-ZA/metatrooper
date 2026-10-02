import argparse
from pathlib import Path

from toolrouter.log import home

RECIPE = {
    "name": "img",
    "summary": "image info, shrink (resize) a screenshot, or diff two images",
    "args": ["info|shrink|diff", "file", "file2", "--threshold"],
    "purity": "read",
    "example": {"setup": {}, "args": ["info", "screenshot.png"], "expect_exit": 1},
}


def info(path):
    from PIL import Image
    with Image.open(path) as im:
        return {"file": str(path), "width": im.width, "height": im.height, "mode": im.mode,
                "format": im.format, "bytes": path.stat().st_size}


def shrink(path):
    from toolrouter.hook import MAX_EDGE, shrink_image
    small = shrink_image(path, cache=home() / "img")
    if small is None:
        return {"file": str(path), "shrunk": False, "why": f"already {MAX_EDGE} px or smaller on the long edge"}
    return {"file": str(path), "shrunk": True, "out": Path(small).as_posix(), **{k: v for k, v in info(small).items()
                                                                              if k in ("width", "height")}}


def diff(a, b, threshold):
    from PIL import Image, ImageChops
    with Image.open(a) as ia, Image.open(b) as ib:
        if ia.size != ib.size:
            return {"same_size": False, "a": list(ia.size), "b": list(ib.size)}
        d = ImageChops.difference(ia.convert("RGB"), ib.convert("RGB"))
    mask = d.convert("L").point(lambda v: 255 if v > threshold else 0)
    changed = mask.histogram()[255]
    total = d.width * d.height
    box = mask.getbbox()
    return {"same_size": True, "changed_pixels": changed, "changed_pct": round(100 * changed / total, 3),
            "box": list(box) if box else None}


def run(args):
    ap = argparse.ArgumentParser(prog="toolrouter run img")
    ap.add_argument("action", choices=["info", "shrink", "diff"])
    ap.add_argument("file")
    ap.add_argument("file2", nargs="?")
    ap.add_argument("--threshold", type=int, default=16, help="per-pixel difference that counts as changed")
    a = ap.parse_args(args)
    path = Path(a.file)
    if not path.is_file():
        return {"exit": 1, "out": f"no such file: {a.file}"}
    try:
        import PIL  # noqa: F401
    except ImportError:
        return {"exit": 1, "out": "img needs Pillow: pip install pillow"}
    try:
        if a.action == "info":
            return {"exit": 0, "out": info(path)}
        if a.action == "shrink":
            return {"exit": 0, "out": shrink(path)}
        if not a.file2 or not Path(a.file2).is_file():
            return {"exit": 1, "out": "diff needs a second image file"}
        return {"exit": 0, "out": diff(path, Path(a.file2), a.threshold)}
    except OSError as e:
        return {"exit": 1, "out": f"cannot read image: {e}"}
