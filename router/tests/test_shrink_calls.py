import json
import multiprocessing
import os
from pathlib import Path

import pytest

from metarouter import calls
from metarouter.shrink import errors, json_shape, shrink, want


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("METAROUTER_HOME", str(tmp_path / "metarouter-home"))
    for name in (
        "AI_AGENT",
        "CLAUDECODE",
        "METAROUTER_OUTPUT",
        "CLAUDE_CODE_SESSION_ID",
        "METAROUTER_SHELL",
    ):
        monkeypatch.delenv(name, raising=False)


@pytest.mark.parametrize(
    ("command", "forbidden"),
    [
        ('tool --message "quoted text"', ["quoted text"]),
        ("tool --message 'single'", ["single"]),
        ("tool --year 2025", ["2025"]),
        (r"tool C:\x\y", [r"C:\x\y"]),
        ("tool /c/Users/example/private.csv", ["/c/Users/example/private.csv"]),
        ("tool file.csv", ["file.csv"]),
    ],
    ids=["double-quoted", "single-quoted", "number", "windows-path", "msys-path", "file"],
)
def test_shape_removes_quoted_strings_numbers_and_paths(command, forbidden):
    shaped = calls.shape(command)

    for value in forbidden:
        assert value not in shaped


def test_run_call_log_contains_shape_not_raw_command(capsys):
    from metarouter import cli

    command = r'printf "%s" 731946 "ultravioletgiraffe" "C:\zebraarchive.csv"'

    exit_code = cli.main(["--json", "exec", "--", command])

    assert capsys.readouterr().out.rstrip("\n")
    call_log = Path(os.environ["METAROUTER_HOME"]) / "calls.jsonl"
    lines = call_log.read_text(encoding="utf-8").splitlines()
    assert exit_code == 0
    assert len(lines) == 1
    record = json.loads(lines[0])
    assert record["shape"] == "printf S N S S"
    assert "ultravioletgiraffe" not in lines[0]
    assert "731946" not in lines[0]
    assert "zebraarchive" not in lines[0]


def test_short_output_at_limit_is_returned_whole():
    text = "α" * 2000

    result = shrink(text)

    assert result == {"out": text, "errors": [], "more_errors": 0, "tail": []}


def test_long_failed_output_keeps_errors_but_no_success_path_tail():
    expected_kept = [f"error {index:02d}: unique" for index in range(40)]
    extra_errors = [f"error {index:02d}: unique" for index in range(40, 45)]
    text = "padding\n" + ("ordinary output\n" * 150) + "\n".join(expected_kept + extra_errors)
    assert len(text) > 2000

    result = shrink(text)

    assert result["out"] is None
    assert len(result["errors"]) == 1
    assert "(x45)" in result["errors"][0]
    assert result["more_errors"] == 0
    assert not any(line in result["errors"] for line in extra_errors)


def test_long_json_is_returned_as_shaped_object_with_list_lengths():
    document = {
        "records": [
            {"id": index, "payload": f"record-{index}-" + ("x" * 300)}
            for index in range(10)
        ],
        "empty": [],
    }
    text = json.dumps(document)
    assert len(text) > 2000

    result = shrink(text)

    shaped = result["out"]
    assert shaped["records"]["len"] == 10
    assert len(shaped["records"]["first"]) == 3
    assert shaped["empty"] == {"len": 0, "first": []}
    assert result["errors"] == []
    assert result["tail"] == []


def test_long_success_output_collapses_runs_then_keeps_head_and_tail():
    lines = [f"run {i} " + "x" * 60 for i in range(40)]
    result = shrink("\n".join(lines), failed=False)

    assert result["errors"] == []
    assert result["tail"] == []
    assert lines[0] in result["out"]
    assert lines[-1] in result["out"]
    assert "... 38 more like these" in result["out"]


def test_json_shape_clips_long_dictionary_keys():
    key = "k" * 100

    shaped = json_shape({key: "value"})

    assert next(iter(shaped)) == key[:80] + "..."


def test_error_grouping_replaces_digits_but_keeps_other_text_distinct():
    grouped, _ = errors(["error: item 12", "error: item 98", "error: other 12"])

    assert grouped == ["error: item 12 (x2)", "error: other 12"]


def test_traceback_retains_only_last_five_file_frames():
    frames = [f'  File "frame-{i}.py", line {i}' for i in range(7)]
    grouped, _ = errors(["Traceback (most recent call last):", *frames, "ValueError: bad"])

    frame_lines = [line for line in grouped if 'File "' in line]
    assert len(frame_lines) == 5
    assert all(f'frame-{i}.py' in frame_lines[i - 2] for i in range(2, 7))


def test_failed_tail_does_not_repeat_lines_already_in_errors():
    output = "error: boom\nordinary detail\n" * 300

    result = shrink(output)

    assert all(line not in result["tail"] for line in result["errors"])


def test_want_returns_relevant_chunks_within_budget_and_keeps_best_chunk():
    text = "\n\n".join(
        ["# needle\n" + ("needle detail " * 150) for _ in range(4)]
        + ["# unrelated\n" + ("other detail " * 150)]
    )

    result = want(text, "needle")

    assert result is not None
    assert "lines " in result and "needle" in result
    assert len(result) <= 2000
    assert result.count("lines ") <= 3


@pytest.mark.parametrize(
    ("keys", "expected"),
    [
        (["a", "b", "c"], "{a,b,c}"),
        ([f"key{index}" for index in range(15)], "{" + ",".join(f"key{index}" for index in range(12)) + ",+3}"),
    ],
    ids=["all-keys", "first-twelve-plus-remainder"],
)
def test_json_shape_names_object_keys_at_depth_two(keys, expected):
    value = {"outer": {"inner": {key: key for key in keys}}}

    shaped = json_shape(value)

    assert shaped["outer"]["inner"] == expected


def _append_records(home, worker, start):
    os.environ["METAROUTER_HOME"] = home
    for name in ("AI_AGENT", "CLAUDECODE", "METAROUTER_OUTPUT", "CLAUDE_CODE_SESSION_ID"):
        os.environ.pop(name, None)
    if not start.wait(10):
        raise RuntimeError("append workers did not receive the start signal")
    for index in range(1000):
        calls.append({"worker": worker, "index": index})


def test_two_processes_append_2000_valid_json_lines(tmp_path):
    context = multiprocessing.get_context("spawn")
    start = context.Event()
    home = str(tmp_path / "metarouter-home")
    processes = [
        context.Process(target=_append_records, args=(home, worker, start))
        for worker in ("left", "right")
    ]

    try:
        for process in processes:
            process.start()
        start.set()
        for process in processes:
            process.join(30)
        exit_codes = [process.exitcode for process in processes]
    finally:
        for process in processes:
            if process.is_alive():
                process.terminate()
                process.join(5)

    assert exit_codes == [0, 0]
    lines = (Path(home) / "calls.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2000
    records = [json.loads(line) for line in lines]
    assert {(row["worker"], row["index"]) for row in records} == {
        (worker, index) for worker in ("left", "right") for index in range(1000)
    }
