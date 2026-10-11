import sys
from pathlib import Path


def main():
    target = Path("answer.txt")
    if not target.is_file():
        sys.exit(1)

    content = target.read_text(encoding="utf-8").strip()
    if content == "3482":
        sys.exit(0)
    sys.exit(1)


if __name__ == "__main__":
    main()
