import hashlib
import subprocess
import sys
from pathlib import Path


def main():
    test_path = Path("tests/test_calc.py")
    if not test_path.is_file():
        sys.exit(1)

    normalized_content = test_path.read_text(encoding="utf-8").replace("\r\n", "\n").strip()
    expected_content = "from mypackage.calc import get_range\n\n\ndef test_get_range():\n    assert get_range(5) == [1, 2, 3, 4, 5]"

    content_hash = hashlib.sha256(normalized_content.encode("utf-8")).hexdigest()
    expected_hash = hashlib.sha256(expected_content.encode("utf-8")).hexdigest()

    if content_hash != expected_hash:
        sys.exit(1)

    proc = subprocess.run([sys.executable, "-m", "pytest", "-q"], capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
