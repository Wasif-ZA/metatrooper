import json
import pytest
from pathlib import Path
from toolrouter.ingest import result_cost, scan, summarise, main


def test_result_cost():
    s = "abcdefgh"
    assert result_cost(s) == (len(s) // 4, 0)

    t1, t2 = "12345678", "abcd"
    assert result_cost([{"type": "text", "text": t1}, {"type": "text", "text": t2}]) == (
        len(t1) // 4 + len(t2) // 4,
        0,
    )

    assert result_cost([{"type": "image"}, {"type": "image"}]) == (0, 2)

    mixed_text = "hello world!"
    assert result_cost([{"type": "text", "text": mixed_text}, {"type": "image"}]) == (
        len(mixed_text) // 4,
        1,
    )

    assert result_cost(None) == (0, 0)


def test_duplicate_result_counted_once(tmp_path):
    p = tmp_path / "proj" / "session.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    text1 = "first result text"
    text2 = "second duplicate result text is much longer"
    lines = [
        json.dumps({
            "timestamp": "2026-09-27T12:00:00",
            "message": {"content": [{"type": "tool_use", "id": "u1", "name": "Bash", "input": {"command": "ls"}}]},
        }),
        json.dumps({
            "timestamp": "2026-09-27T12:00:01",
            "message": {"content": [{"type": "tool_result", "tool_use_id": "u1", "content": text1, "is_error": False}]},
        }),
        json.dumps({
            "timestamp": "2026-09-27T12:00:02",
            "message": {"content": [{"type": "tool_result", "tool_use_id": "u1", "content": text2, "is_error": False}]},
        }),
    ]
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")

    n_files, calls, results = scan(tmp_path)
    assert len(results) == 1
    assert "u1" in results
    assert results["u1"] == (len(text1) // 4, 0, False)


def test_tool_use_and_result_in_different_files(tmp_path):
    f1 = tmp_path / "proj" / "calls.jsonl"
    f2 = tmp_path / "proj" / "results.jsonl"
    f1.parent.mkdir(parents=True, exist_ok=True)
    text = "result across files"
    f1.write_text(
        json.dumps({
            "timestamp": "2026-09-27T12:00:00",
            "message": {"content": [{"type": "tool_use", "id": "u1", "name": "Bash", "input": {"command": "pwd"}}]},
        }) + "\n",
        encoding="utf-8",
    )
    f2.write_text(
        json.dumps({
            "timestamp": "2026-09-27T12:00:05",
            "message": {"content": [{"type": "tool_result", "tool_use_id": "u1", "content": text, "is_error": False}]},
        }) + "\n",
        encoding="utf-8",
    )

    n_files, calls, results = scan(tmp_path)
    assert n_files == 2
    assert "u1" in calls
    assert "u1" in results
    assert results["u1"] == (len(text) // 4, 0, False)


def test_since_filter(tmp_path):
    p = tmp_path / "proj" / "session.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    old_text = "old result that should be filtered out"
    new_text = "new result that should be kept"
    lines = [
        json.dumps({
            "timestamp": "2026-09-27T10:00:00",
            "message": {"content": [{"type": "tool_use", "id": "old_u", "name": "Bash", "input": {"command": "date"}}]},
        }),
        json.dumps({
            "timestamp": "2026-09-27T10:00:01",
            "message": {"content": [{"type": "tool_result", "tool_use_id": "old_u", "content": old_text, "is_error": False}]},
        }),
        json.dumps({
            "timestamp": "2026-09-27T14:00:00",
            "message": {"content": [{"type": "tool_use", "id": "new_u", "name": "Bash", "input": {"command": "date"}}]},
        }),
        json.dumps({
            "timestamp": "2026-09-27T14:00:01",
            "message": {"content": [{"type": "tool_result", "tool_use_id": "new_u", "content": new_text, "is_error": False}]},
        }),
    ]
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")

    n_files, calls, results = scan(tmp_path, since="2026-09-27T12:00:00")
    assert "old_u" not in calls
    assert "old_u" not in results
    assert "new_u" in calls
    assert "new_u" in results
    assert results["new_u"] == (len(new_text) // 4, 0, False)


def test_malformed_json_line_skipped(tmp_path):
    p = tmp_path / "proj" / "session.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    text = "valid result text"
    lines = [
        "not a json line",
        "{broken json",
        json.dumps({
            "timestamp": "2026-09-27T12:00:00",
            "message": {"content": [{"type": "tool_use", "id": "u1", "name": "Bash", "input": {"command": "ls"}}]},
        }),
        '{"timestamp": invalid',
        json.dumps({
            "timestamp": "2026-09-27T12:00:01",
            "message": {"content": [{"type": "tool_result", "tool_use_id": "u1", "content": text, "is_error": False}]},
        }),
    ]
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")

    n_files, calls, results = scan(tmp_path)
    assert len(calls) == 1
    assert len(results) == 1
    assert results["u1"] == (len(text) // 4, 0, False)


def test_mcp_grouping(tmp_path):
    p = tmp_path / "proj" / "session.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    t1 = "mcp tool result 1"
    t2 = "mcp tool result 2"
    t3 = "regular tool result"
    lines = [
        json.dumps({
            "timestamp": "2026-09-27T12:00:00",
            "message": {
                "content": [
                    {"type": "tool_use", "id": "u1", "name": "mcp__read_file", "input": {}},
                    {"type": "tool_result", "tool_use_id": "u1", "content": t1, "is_error": False},
                    {"type": "tool_use", "id": "u2", "name": "mcp__list_dir", "input": {}},
                    {"type": "tool_result", "tool_use_id": "u2", "content": t2, "is_error": False},
                    {"type": "tool_use", "id": "u3", "name": "custom_tool", "input": {}},
                    {"type": "tool_result", "tool_use_id": "u3", "content": t3, "is_error": False},
                ]
            },
        })
    ]
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")

    n_files, calls, results = scan(tmp_path)
    s = summarise(calls, results)
    assert "mcp" in s["tools"]
    assert "mcp__read_file" not in s["tools"]
    assert "mcp__list_dir" not in s["tools"]
    assert s["tools"]["mcp"]["calls"] == 2
    assert s["tools"]["mcp"]["tokens"] == len(t1) // 4 + len(t2) // 4
    assert s["tools"]["custom_tool"]["calls"] == 1
    assert s["tools"]["custom_tool"]["tokens"] == len(t3) // 4


def test_bash_cap_saves_400(tmp_path):
    p = tmp_path / "proj" / "session.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    t1 = "a" * (550 * 4)
    t2 = "b" * (300 * 4)
    t3 = "c" * (700 * 4)
    lines = [
        json.dumps({
            "timestamp": "2026-09-27T12:00:00",
            "message": {
                "content": [
                    {"type": "tool_use", "id": "u1", "name": "Bash", "input": {"command": "cmd1"}},
                    {"type": "tool_result", "tool_use_id": "u1", "content": t1, "is_error": False},
                    {"type": "tool_use", "id": "u2", "name": "Bash", "input": {"command": "cmd2"}},
                    {"type": "tool_result", "tool_use_id": "u2", "content": t2, "is_error": False},
                    {"type": "tool_use", "id": "u3", "name": "Bash", "input": {"command": "cmd3"}},
                    {"type": "tool_result", "tool_use_id": "u3", "content": t3, "is_error": False},
                ]
            },
        })
    ]
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")

    n_files, calls, results = scan(tmp_path)
    s = summarise(calls, results)
    expected_saves = (len(t1) // 4 - 400) + (len(t3) // 4 - 400)
    assert s["shell"]["cap_saves"][400] == expected_saves


def test_exact_repeat_calls(tmp_path):
    p1 = tmp_path / "proj1" / "session.jsonl"
    p2 = tmp_path / "proj2" / "session.jsonl"
    p1.parent.mkdir(parents=True, exist_ok=True)
    p2.parent.mkdir(parents=True, exist_ok=True)

    lines_p1 = [
        json.dumps({
            "timestamp": "2026-09-27T12:00:00",
            "message": {
                "content": [
                    {"type": "tool_use", "id": "u1", "name": "Bash", "input": {"command": "git status"}},
                    {"type": "tool_result", "tool_use_id": "u1", "content": "res1", "is_error": False},
                    {"type": "tool_use", "id": "u2", "name": "Bash", "input": {"command": "git status"}},
                    {"type": "tool_result", "tool_use_id": "u2", "content": "res2", "is_error": False},
                    {"type": "tool_use", "id": "u3", "name": "Bash", "input": {"command": "git status"}},
                    {"type": "tool_result", "tool_use_id": "u3", "content": "res3", "is_error": False},
                    {"type": "tool_use", "id": "u4", "name": "Bash", "input": {"command": "ls -l"}},
                    {"type": "tool_result", "tool_use_id": "u4", "content": "res4", "is_error": False},
                ]
            },
        })
    ]
    lines_p2 = [
        json.dumps({
            "timestamp": "2026-09-27T12:00:00",
            "message": {
                "content": [
                    {"type": "tool_use", "id": "u5", "name": "Bash", "input": {"command": "git status"}},
                    {"type": "tool_result", "tool_use_id": "u5", "content": "res5", "is_error": False},
                    {"type": "tool_use", "id": "u6", "name": "Bash", "input": {"command": "git status"}},
                    {"type": "tool_result", "tool_use_id": "u6", "content": "res6", "is_error": False},
                    {"type": "tool_use", "id": "u7", "name": "Read", "input": {"command": "git status"}},
                    {"type": "tool_result", "tool_use_id": "u7", "content": "res7", "is_error": False},
                    {"type": "tool_use", "id": "u8", "name": "Read", "input": {"command": "git status"}},
                    {"type": "tool_result", "tool_use_id": "u8", "content": "res8", "is_error": False},
                ]
            },
        })
    ]
    p1.write_text("\n".join(lines_p1) + "\n", encoding="utf-8")
    p2.write_text("\n".join(lines_p2) + "\n", encoding="utf-8")

    n_files, calls, results = scan(tmp_path)
    s = summarise(calls, results)
    assert s["shell"]["exact_repeat_calls"] == (3 - 1) + (2 - 1)


def test_read_over_40kb_saves(tmp_path):
    p = tmp_path / "proj" / "session.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    big_text = "x" * (12000 * 4)
    small_text = "y" * (5000 * 4)
    image_read_text = "z" * (12000 * 4)
    bash_big_text = "w" * (15000 * 4)

    lines = [
        json.dumps({
            "timestamp": "2026-09-27T12:00:00",
            "message": {
                "content": [
                    {"type": "tool_use", "id": "u1", "name": "Read", "input": {}},
                    {"type": "tool_result", "tool_use_id": "u1", "content": big_text, "is_error": False},
                    {"type": "tool_use", "id": "u2", "name": "Read", "input": {}},
                    {"type": "tool_result", "tool_use_id": "u2", "content": small_text, "is_error": False},
                    {"type": "tool_use", "id": "u3", "name": "Read", "input": {}},
                    {
                        "type": "tool_result",
                        "tool_use_id": "u3",
                        "content": [{"type": "text", "text": image_read_text}, {"type": "image"}],
                        "is_error": False,
                    },
                    {"type": "tool_use", "id": "u4", "name": "Bash", "input": {}},
                    {"type": "tool_result", "tool_use_id": "u4", "content": bash_big_text, "is_error": False},
                ]
            },
        })
    ]
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")

    n_files, calls, results = scan(tmp_path)
    s = summarise(calls, results)
    assert s["read_over_40kb_saves"] == len(big_text) // 4 - 10000


def test_main(tmp_path, capsys):
    p = tmp_path / "proj" / "session.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    text = "hello world token test"
    lines = [
        json.dumps({
            "timestamp": "2026-09-27T12:00:00",
            "message": {
                "content": [
                    {"type": "tool_use", "id": "u1", "name": "Bash", "input": {"command": "ls"}},
                    {"type": "tool_result", "tool_use_id": "u1", "content": text, "is_error": False},
                ]
            },
        })
    ]
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")

    main(["ingest", "--root", str(tmp_path), "--no-save"])
    captured = capsys.readouterr()
    expected_tokens = len(text) // 4
    assert f"{expected_tokens:,} tokens" in captured.out
