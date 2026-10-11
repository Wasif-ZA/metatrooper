import json
import sys
from pathlib import Path


def main():
    target = Path("settings.json")
    if not target.is_file():
        sys.exit(1)

    try:
        with open(target, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        sys.exit(1)

    if not isinstance(data, dict):
        sys.exit(1)

    if data.get("level") != "debug":
        sys.exit(1)

    if data.get("name") != "service" or data.get("version") != "1.0.0" or data.get("port") != 8080:
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
