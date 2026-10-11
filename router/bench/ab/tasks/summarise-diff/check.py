import sys
from pathlib import Path


def main():
    target = Path("answer.txt")
    if not target.is_file():
        sys.exit(1)

    lines = [
        line.strip().replace("\\", "/")
        for line in target.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    expected = {"alpha.py", "beta.py"}

    if set(lines) == expected and len(lines) == 2:
        sys.exit(0)
    sys.exit(1)


if __name__ == "__main__":
    main()
