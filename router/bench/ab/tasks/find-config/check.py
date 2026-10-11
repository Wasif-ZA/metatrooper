import sys
from pathlib import Path


def main():
    target = Path("answer.txt")
    if not target.is_file():
        sys.exit(1)

    content = target.read_text(encoding="utf-8").strip()
    normalized = content.replace("\\", "/").strip().lstrip("./")
    expected = "services/billing/worker.conf"

    if normalized == expected:
        sys.exit(0)
    sys.exit(1)


if __name__ == "__main__":
    main()
