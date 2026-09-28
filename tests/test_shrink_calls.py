import json
import multiprocessing
import os
from pathlib import Path

import pytest

from callrouter import calls
from callrouter.shrink import shrink


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("CALLROUTER_HOME", str(tmp_path / "callrouter-home"))
    for name in (
        "AI_AGENT",
        "CLAUDECODE",
        "CALLROUTER_OUTPUT",
        "CLAUDE_CODE_SESSION_ID",
        "CALLROUTER_SHELL",
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
    from callrouter import cli

    command = r'printf "%s" 731946 "ultravioletgiraffe" "C:\zebraarchive.csv"'

    exit_code = cli.main(["--json", "exec", "--", command])

    json.loads(capsys.readouterr().out)
    call_log = Path(os.environ["CALLROUTER_HOME"]) / "calls.jsonl"
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


def test_long_output_keeps_first_40_error_lines_and_counts_the_rest():
    expected_kept = [f"error: unique-{index:02d}" for index in range(40)]
    extra_errors = [f"error: unique-{index:02d}" for index in range(40, 45)]
    text = "padding\n" + ("ordinary output\n" * 150) + "\n".join(expected_kept + extra_errors)
    assert len(text) > 2000

    result = shrink(text)

    assert result["out"] is None
    assert result["errors"] == expected_kept
    assert result["more_errors"] == 5
    assert not any(line in result["errors"] for line in extra_errors)


def test_long_json_is_replaced_by_shape_with_list_lengths():
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

    shaped = json.loads(result["out"])
    assert shaped["records"]["len"] == 10
    assert len(shaped["records"]["first"]) == 3
    assert shaped["empty"] == {"len": 0, "first": []}
    assert result["errors"] == []
    assert result["tail"] == []


def _append_records(home, worker, start):
    os.environ["CALLROUTER_HOME"] = home
    for name in ("AI_AGENT", "CLAUDECODE", "CALLROUTER_OUTPUT", "CLAUDE_CODE_SESSION_ID"):
        os.environ.pop(name, None)
    if not start.wait(10):
        raise RuntimeError("append workers did not receive the start signal")
    for index in range(1000):
        calls.append({"worker": worker, "index": index})


def test_two_processes_append_2000_valid_json_lines(tmp_path):
    context = multiprocessing.get_context("spawn")
    start = context.Event()
    home = str(tmp_path / "callrouter-home")
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
