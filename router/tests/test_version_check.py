import re
import shutil
import subprocess
from pathlib import Path

import pytest


if shutil.which("node") is None:
    pytest.skip("node not installed", allow_module_level=True)


@pytest.fixture
def version_tree(tmp_path):
    root = Path(__file__).resolve().parents[2]
    for name in ("tests/version-check.mjs", "package.json", "router/pyproject.toml"):
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / name, target)
    return tmp_path


def test_version_check_passes_with_matching_versions(version_tree):
    result = subprocess.run(["node", "tests/version-check.mjs"], cwd=version_tree,
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "PASS" in result.stdout


def test_version_check_rejects_pyproject_version_mismatch(version_tree):
    pyproject = version_tree / "router" / "pyproject.toml"
    text, count = re.subn(r'^version\s*=\s*"[^"]+"', 'version = "9.9.9"',
                          pyproject.read_text(encoding="utf-8"), count=1, flags=re.MULTILINE)
    assert count == 1
    pyproject.write_text(text, encoding="utf-8")

    result = subprocess.run(["node", "tests/version-check.mjs"], cwd=version_tree,
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "pyproject" in result.stdout
