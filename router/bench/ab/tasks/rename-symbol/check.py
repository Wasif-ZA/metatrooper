import sys
from pathlib import Path


def main():
    pkg_dir = Path("pkg")
    if not pkg_dir.is_dir():
        sys.exit(1)

    py_files = list(pkg_dir.glob("*.py"))
    if not py_files:
        sys.exit(1)

    for py_file in py_files:
        text = py_file.read_text(encoding="utf-8")
        if "get_usr" in text:
            sys.exit(1)

    sys.path.insert(0, str(Path.cwd()))
    try:
        import pkg

        if not hasattr(pkg, "get_user"):
            sys.exit(1)
        if pkg.get_user(1) != {"id": 1, "name": "user-1"}:
            sys.exit(1)
        if pkg.render_user(1) != "User #1: user-1":
            sys.exit(1)
        if pkg.fetch_profile(1) != "user-1":
            sys.exit(1)
    except Exception:
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
