from conftest import agent_result
import json
from pathlib import Path

import pytest

from metarouter import cli


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path, monkeypatch):
    home = tmp_path / "metarouter-home"
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.setenv("METAROUTER_HOME", str(home))
    for name in (
        "AI_AGENT",
        "CLAUDECODE",
        "METAROUTER_OUTPUT",
        "CLAUDE_CODE_SESSION_ID",
        "METAROUTER_SHELL",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(work)


def invoke(capsys, *args):
    exit_code = cli.main(["--json", *(str(arg) for arg in args)])
    captured = capsys.readouterr()
    assert captured.err == ""
    try:
        result = agent_result(captured.out)
    except json.JSONDecodeError:
        result = {"out": captured.out.rstrip("\n"), "whole": True}
    return exit_code, result


def test_replace_literal_count_limits_changes_and_reports_count(tmp_path, capsys):
    target = Path("words.txt")
    target.write_bytes(b"cat cat cat\n")

    exit_code, result = invoke(
        capsys, "run", "replace", target, "cat", "dog", "--count", "2"
    )

    assert exit_code == 0
    assert target.read_bytes() == b"dog dog cat\n"
    assert result["out"].startswith("2 replacements in ")


def test_replace_regex_uses_regular_expressions(tmp_path, capsys):
    target = Path("ids.txt")
    target.write_text("item 12, item 345\n", encoding="utf-8")

    exit_code, result = invoke(
        capsys, "run", "replace", target, r"item (\d+)", r"id[\1]", "--regex"
    )

    assert exit_code == 0
    assert target.read_text(encoding="utf-8") == "id[12], id[345]\n"
    assert "2 replacements" in result["out"]


def test_replace_old_and_new_files_support_backslashes_and_newlines(capsys):
    target = Path("paths.txt")
    old_file = Path("old.txt")
    new_file = Path("new.txt")
    target.write_bytes(b"before\nC:\\temp\\one\nsecond line\nafter\n")
    old_file.write_bytes(b"C:\\temp\\one\nsecond line")
    new_file.write_bytes(b"D:\\archive\\two\nreplacement line")

    exit_code, result = invoke(
        capsys,
        "run",
        "replace",
        target,
        "--old-file",
        old_file,
        "--new-file",
        new_file,
    )

    assert exit_code == 0
    assert target.read_bytes() == b"before\nD:\\archive\\two\nreplacement line\nafter\n"
    assert "1 replacements" in result["out"]


def test_replace_preserves_crlf_bytes(capsys):
    target = Path("windows.txt")
    target.write_bytes(b"alpha\r\nbeta alpha\r\ngamma\r\n")

    exit_code, _ = invoke(capsys, "run", "replace", target, "alpha", "omega")

    assert exit_code == 0
    assert target.read_bytes() == b"omega\r\nbeta omega\r\ngamma\r\n"


def test_replace_preserves_non_ascii_utf8(capsys):
    target = Path("unicode.txt")
    target.write_bytes("café 東京 café\n".encode("utf-8"))

    exit_code, result = invoke(capsys, "run", "replace", target, "café", "naïve")

    assert exit_code == 0
    assert target.read_bytes() == "naïve 東京 naïve\n".encode("utf-8")
    assert "2 replacements" in result["out"]


def test_replace_with_no_matches_exits_one_and_keeps_identical_bytes(capsys):
    target = Path("unchanged.txt")
    original = b"untouched\r\nbinary-adjacent\r\n"
    target.write_bytes(original)

    exit_code, result = invoke(capsys, "run", "replace", target, "missing", "new")

    assert exit_code == 1
    assert target.read_bytes() == original
    assert "0 replacements" in result["out"]
    assert "file unchanged" in result["out"]


def test_replace_snapshot_undo_without_id_restores_original_bytes(capsys):
    target = Path("undo-replace.txt")
    original = "café\r\ncat\r\n".encode("utf-8")
    target.write_bytes(original)

    changed_exit, changed = invoke(capsys, "run", "replace", target, "cat", "dog")
    undo_exit, undo = invoke(capsys, "undo")

    assert changed_exit == 0
    assert "undo: metarouter undo " in changed["out"]
    assert undo_exit == 0
    assert str(target.resolve()) in undo["out"]
    assert target.read_bytes() == original


def test_undo_with_no_snapshots_exits_one(capsys):
    exit_code, result = invoke(capsys, "undo")

    assert exit_code == 1
    assert result["ok"] is False
    assert "no snapshots yet" in result["note"]


def test_find_counts_files_and_matches_while_skipping_dirs_and_binary(capsys):
    Path("a.txt").write_text("needle one\nplain\nneedle two\n", encoding="utf-8")
    Path("b.py").write_text("needle three\n", encoding="utf-8")
    Path("binary.dat").write_bytes(b"needle\x00hidden")
    for folder in (".git", "node_modules", ".venv"):
        path = Path(folder)
        path.mkdir()
        (path / "hidden.txt").write_text("needle\n", encoding="utf-8")

    exit_code, result = invoke(capsys, "run", "find", "needle", ".", "--lines", "3")

    assert exit_code == 0
    assert result["out"] == {
        "matches": 3,
        "files": {
            "a.txt": ["1: needle one", "3: needle two"],
            "b.py": ["1: needle three"],
        },
    }
    assert "log" not in result


def test_find_defaults_to_one_matching_line_per_file(capsys):
    Path("many.txt").write_text("needle one\nneedle two\nneedle three\n", encoding="utf-8")

    exit_code, result = invoke(capsys, "run", "find", "needle", ".")

    assert exit_code == 0
    assert result["out"]["files"]["many.txt"] == ["1: needle one", "+2 more"]


def test_find_glob_and_ignore_case(capsys):
    Path("one.py").write_text("Needle\nNEEDLE\n", encoding="utf-8")
    Path("two.txt").write_text("needle\n", encoding="utf-8")
    Path("three.py").write_text("nothing\n", encoding="utf-8")

    exit_code, result = invoke(
        capsys, "run", "find", "needle", ".", "--glob", "*.py", "-i", "--lines", "3"
    )

    assert exit_code == 0
    assert result["out"] == {
        "matches": 2,
        "files": {"one.py": ["1: Needle", "2: NEEDLE"]},
    }
    assert "log" not in result


def test_find_takes_named_files_and_shows_their_lines(capsys):
    Path("sub").mkdir()
    Path("sub/a.py").write_text("needle one\nplain\nneedle two\n", encoding="utf-8")
    Path("b.txt").write_text("needle three\n", encoding="utf-8")
    Path("c.txt").write_text("needle skipped\n", encoding="utf-8")

    exit_code, result = invoke(capsys, "run", "find", "needle", "sub/a.py", "b.txt")

    assert exit_code == 0
    assert result["out"] == {
        "matches": 3,
        "files": {"sub/a.py": ["1: needle one", "3: needle two"], "b.txt": ["1: needle three"]},
    }

    exit_code, result = invoke(capsys, "run", "find", "needle", "gone.txt")
    assert exit_code == 1
    assert "gone.txt" in result["out"]


def test_find_no_matches_exits_one(capsys):
    Path("plain.txt").write_text("haystack\n", encoding="utf-8")

    exit_code, result = invoke(capsys, "run", "find", "needle", ".")

    assert exit_code == 1
    assert result["out"] == {"matches": 0, "files": {}}
    assert "log" not in result


def test_find_sorts_files_by_match_count_then_name(capsys):
    Path("z.txt").write_text("needle\n", encoding="utf-8")
    Path("b.txt").write_text("needle\nneedle\n", encoding="utf-8")
    Path("a.txt").write_text("needle\n", encoding="utf-8")

    exit_code, result = invoke(capsys, "run", "find", "needle", ".")

    assert exit_code == 0
    assert list(result["out"]["files"]) == ["b.txt", "a.txt", "z.txt"]
    assert result["out"]["matches"] == 4


def test_find_adds_more_as_last_line_and_names_log_when_lines_are_hidden(capsys):
    Path("many.txt").write_text("needle one\nneedle two\nneedle three\n", encoding="utf-8")

    exit_code, result = invoke(
        capsys, "run", "find", "needle", ".", "--lines", "2"
    )

    assert exit_code == 0
    assert result["out"] == {
        "matches": 3,
        "files": {"many.txt": ["1: needle one", "2: needle two", "+1 more"]},
    }
    assert Path(result["log"]).is_file()


def test_find_names_log_when_a_matching_line_is_clipped(capsys):
    Path("wide.txt").write_text("needle " + ("x" * 250) + "\n", encoding="utf-8")

    exit_code, result = invoke(capsys, "run", "find", "needle", ".")

    assert exit_code == 0
    assert result["out"]["files"]["wide.txt"] == ["1: " + "needle " + ("x" * 193)]
    assert Path(result["log"]).is_file()


def test_find_reports_more_files_after_first_thirty(capsys):
    for index in range(32):
        Path(f"file-{index:02d}.txt").write_text("needle\n", encoding="utf-8")

    exit_code, result = invoke(capsys, "run", "find", "needle", ".")

    assert exit_code == 0
    assert result["out"]["matches"] == 32
    assert len(result["out"]["files"]) == 30
    assert result["out"]["more_files"] == 2
    assert Path(result["log"]).is_file()


def test_find_bad_regex_exits_two(capsys):
    Path("plain.txt").write_text("anything\n", encoding="utf-8")

    exit_code, result = invoke(capsys, "run", "find", "[", ".")

    assert exit_code == 2
    assert result["out"].startswith("bad regex:")
