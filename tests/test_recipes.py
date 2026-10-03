import json
import re
from pathlib import Path

import pytest
from PIL import Image

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
        result = json.loads(captured.out)
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


def test_json_set_snapshot_id_from_output_restores_original_bytes(capsys):
    target = Path("undo-json.json")
    original = b'{\r\n  "caf\xc3\xa9": 1,\r\n  "tail": true\r\n}\r\n'
    target.write_bytes(original)

    changed_exit, changed = invoke(capsys, "run", "json-set", target, ".café", "2")
    match = re.search(r"metarouter undo ([^)]+)", changed["out"])
    assert match is not None
    target.write_bytes(b"deliberately changed after snapshot")
    undo_exit, undo = invoke(capsys, "undo", match.group(1))

    assert changed_exit == 0
    assert undo_exit == 0
    assert str(target.resolve()) in undo["out"]
    assert target.read_bytes() == original


def test_undo_with_no_snapshots_exits_one(capsys):
    exit_code, result = invoke(capsys, "undo")

    assert exit_code == 1
    assert result["ok"] is False
    assert "no snapshots yet" in result["note"]


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        (".a.b[1]", {"leaf": 20}),
        (".a.b[-1]", {"leaf": 30}),
        ('["key.with.dot"]', ["x", "y"]),
        (".", {"a": {"b": [{"leaf": 10}, {"leaf": 20}, {"leaf": 30}]}, "key.with.dot": ["x", "y"]}),
    ],
    ids=["nested-index", "negative-index", "quoted-key", "root"],
)
def test_json_paths_and_structured_results_are_real_json(path, expected, capsys):
    Path("data.json").write_text(
        json.dumps(
            {
                "a": {"b": [{"leaf": 10}, {"leaf": 20}, {"leaf": 30}]},
                "key.with.dot": ["x", "y"],
            }
        ),
        encoding="utf-8",
    )

    exit_code, result = invoke(capsys, "run", "json", "data.json", path)

    assert exit_code == 0
    assert result["out"] == expected
    assert isinstance(result["out"], type(expected))


def test_json_missing_key_names_the_key(capsys):
    Path("data.json").write_text('{"present": 1}', encoding="utf-8")

    exit_code, result = invoke(capsys, "run", "json", "data.json", ".absent")

    assert exit_code == 1
    assert "absent" in result["out"]


@pytest.mark.parametrize(
    ("payload", "path", "expected"),
    [({"b": 1, "a": 2}, ".", ["b", "a"]), ([10, 20, 30], ".", {"len": 3})],
    ids=["object-keys", "list-length"],
)
def test_json_keys(payload, path, expected, capsys):
    Path("data.json").write_text(json.dumps(payload), encoding="utf-8")

    exit_code, result = invoke(capsys, "run", "json", "data.json", path, "--keys")

    assert exit_code == 0
    assert result["out"] == expected


def test_json_bad_file_exits_one(capsys):
    Path("bad.json").write_text('{"broken": ]', encoding="utf-8")

    exit_code, result = invoke(capsys, "run", "json", "bad.json", ".")

    assert exit_code == 1
    assert "Expecting value" in result["out"]


@pytest.mark.parametrize(
    ("value_args", "expected"),
    [
        (("{\"nested\":[1,2]}",), {"nested": [1, 2]}),
        (("123", "--string"), "123"),
    ],
    ids=["valid-json-value", "forced-string"],
)
def test_json_set_parses_json_unless_string_is_forced(value_args, expected, capsys):
    target = Path("set.json")
    target.write_text('{"value": null}', encoding="utf-8")

    exit_code, _ = invoke(capsys, "run", "json-set", target, ".value", *value_args)

    assert exit_code == 0
    assert json.loads(target.read_text(encoding="utf-8"))["value"] == expected


def test_json_set_preserves_key_order_and_indentation_style(capsys):
    target = Path("pretty.json")
    target.write_text(
        '{\n  "z": 0,\n  "a": {\n    "b": 1\n  },\n  "tail": true\n}\n',
        encoding="utf-8",
    )

    exit_code, _ = invoke(capsys, "run", "json-set", target, ".a.b", "2")

    assert exit_code == 0
    assert target.read_text(encoding="utf-8") == (
        '{\n  "z": 0,\n  "a": {\n    "b": 2\n  },\n  "tail": true\n}\n'
    )


def test_json_set_out_of_range_index_leaves_file_byte_identical(capsys):
    target = Path("list.json")
    original = b'{\r\n  "items": [1, 2]\r\n}\r\n'
    target.write_bytes(original)

    exit_code, result = invoke(capsys, "run", "json-set", target, ".items[2]", "9")

    assert exit_code == 1
    assert "index 2 is outside a list of 2" in result["out"]
    assert target.read_bytes() == original


def test_img_info_reports_actual_dimensions(capsys):
    image = Path("info.png")
    Image.new("RGB", (37, 23), "navy").save(image)

    exit_code, result = invoke(capsys, "run", "img", "info", image)

    assert exit_code == 0
    assert result["out"]["width"] == 37
    assert result["out"]["height"] == 23


def test_img_shrink_uses_784_long_edge_and_metarouter_home(tmp_path, capsys):
    image = Path("large.png")
    Image.new("RGB", (2000, 1000), "purple").save(image)

    exit_code, result = invoke(capsys, "run", "img", "shrink", image)
    output = Path(result["out"]["out"])

    assert exit_code == 0
    assert result["out"]["shrunk"] is True
    assert output.is_relative_to(tmp_path / "metarouter-home")
    with Image.open(output) as shrunk:
        assert shrunk.size == (784, 392)


def test_img_shrink_small_image_reports_not_shrunk(capsys):
    image = Path("small.png")
    Image.new("RGB", (320, 200), "green").save(image)

    exit_code, result = invoke(capsys, "run", "img", "shrink", image)

    assert exit_code == 0
    assert result["out"]["shrunk"] is False


def test_img_diff_identical_images_reports_zero_changed(capsys):
    first = Path("first.png")
    second = Path("second.png")
    Image.new("RGB", (20, 15), "white").save(first)
    Image.new("RGB", (20, 15), "white").save(second)

    exit_code, result = invoke(capsys, "run", "img", "diff", first, second)

    assert exit_code == 0
    assert result["out"] == {
        "same_size": True,
        "changed_pixels": 0,
        "changed_pct": 0.0,
        "box": None,
    }


def test_img_diff_reports_exact_painted_pixel_count_and_box(capsys):
    first = Path("base.png")
    second = Path("painted.png")
    Image.new("RGB", (20, 15), "white").save(first)
    painted = Image.new("RGB", (20, 15), "white")
    painted.paste("black", (3, 4, 10, 10))
    painted.save(second)

    exit_code, result = invoke(capsys, "run", "img", "diff", first, second)

    assert exit_code == 0
    assert result["out"]["same_size"] is True
    assert result["out"]["changed_pixels"] == 7 * 6
    assert result["out"]["box"] == [3, 4, 10, 10]
    assert result["out"]["changed_pct"] == 14.0


def test_img_diff_different_sizes_reports_same_size_false(capsys):
    Image.new("RGB", (10, 10), "white").save("a.png")
    Image.new("RGB", (11, 10), "white").save("b.png")

    exit_code, result = invoke(capsys, "run", "img", "diff", "a.png", "b.png")

    assert exit_code == 0
    assert result["out"] == {"same_size": False, "a": [10, 10], "b": [11, 10]}


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
