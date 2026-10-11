import json
import os
from pathlib import Path

import pytest

from metarouter import cli, learn


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
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(work)


def invoke(capsys, *args):
    exit_code = cli.main(["--json", *(str(arg) for arg in args)])
    captured = capsys.readouterr()
    assert captured.err == ""
    return exit_code, json.loads(captured.out), captured.out


def write_transcript(root, calls, name="session.jsonl"):
    root.mkdir(parents=True, exist_ok=True)
    blocks = []
    for index, (command, failed, output) in enumerate(calls, 1):
        tool_id = f"tool-{index}"
        blocks.append(
            {
                "type": "tool_use",
                "id": tool_id,
                "name": "Bash",
                "input": {"command": command},
            }
        )
        blocks.append(
            {
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": output,
                "is_error": failed,
            }
        )
    path = root / name
    path.write_text(json.dumps({"message": {"content": blocks}}) + "\n", encoding="utf-8")
    return path


def eligible_calls(binary="widget"):
    return [
        (f'{binary} convert "synthetic-{n}"', n == 5, "ordinary failure" if n == 5 else "ok")
        for n in range(1, 6)
    ]


def test_learn_root_groups_inline_python_into_named_groups(tmp_path, capsys):
    transcripts = tmp_path / "synthetic-transcripts"
    write_transcript(
        transcripts,
        [
            (
                'python -c "from PIL import Image; Image.open(\'synthetic.png\')"',
                False,
                "ok",
            )
        ],
    )

    exit_code, result, _ = invoke(capsys, "learn", "--root", transcripts)

    assert exit_code == 0
    assert result["out"]["transcripts"] == 1
    assert result["out"]["shell_calls"] == 1
    assert result["out"]["inline_python_groups"] == [
        {"group": "image", "scripts": 1, "recipe": "img"}
    ]


def test_recipe_candidates_require_five_uses_and_eighty_percent_success(
    tmp_path, monkeypatch, capsys
):
    transcripts = tmp_path / "synthetic-transcripts"
    calls = eligible_calls("widget")
    calls += [
        (f'shorty build "synthetic-{n}"', False, "ok") for n in range(1, 5)
    ]
    calls += [
        (
            f'flaky build "synthetic-{n}"',
            n > 3,
            "ordinary failure" if n > 3 else "ok",
        )
        for n in range(1, 6)
    ]
    write_transcript(transcripts, calls)

    exit_code, result, _ = invoke(capsys, "learn", "--root", transcripts)

    assert exit_code == 0
    assert result["out"]["recipe_candidates"] == 1
    candidates = json.loads(
        (
            Path(os.environ["METAROUTER_HOME"])
            / "candidates"
            / "candidates.json"
        ).read_text(encoding="utf-8")
    )
    recipes = [candidate for candidate in candidates if candidate["type"] == "recipe"]
    assert [(candidate["name"], candidate["body"], candidate["uses"], candidate["success"]) for candidate in recipes] == [
        ("widget-convert", "widget convert {1}", 5, 0.8)
    ]


def test_fail_then_fix_pair_creates_a_hint_candidate(tmp_path, monkeypatch, capsys):
    transcripts = tmp_path / "synthetic-transcripts"
    write_transcript(
        transcripts,
        [
            ('widget --bad "synthetic"', True, "ValueError: synthetic failure"),
            ('widget --good "synthetic"', False, "fixed"),
        ],
    )

    exit_code, result, _ = invoke(capsys, "learn", "--root", transcripts)

    assert exit_code == 0
    assert result["out"]["hint_candidates"] == 1
    candidates = json.loads(
        (
            Path(os.environ["METAROUTER_HOME"])
            / "candidates"
            / "candidates.json"
        ).read_text(encoding="utf-8")
    )
    hint = next(candidate for candidate in candidates if candidate["type"] == "hint")
    assert hint["binary"] == "widget"
    assert hint["error"] == "ValueError"
    assert hint["failed_shape"] == "widget --bad S"
    assert hint["fixed_shape"] == "widget --good S"
    assert hint["hint"]["match"] == "ValueError"


def test_learn_writes_candidates_only_under_metarouter_home(
    tmp_path, monkeypatch, capsys
):
    transcripts = tmp_path / "synthetic-transcripts"
    transcript = write_transcript(transcripts, eligible_calls())
    original_transcript = transcript.read_bytes()
    work = Path.cwd()

    exit_code, _, _ = invoke(capsys, "learn", "--root", transcripts)

    home = Path(os.environ["METAROUTER_HOME"])
    candidate_file = home / "candidates" / "candidates.json"
    assert exit_code == 0
    assert candidate_file.is_file()
    assert candidate_file.resolve().is_relative_to(home.resolve())
    assert transcript.read_bytes() == original_transcript
    assert not (transcripts / "candidates").exists()
    assert not (work / "candidates").exists()


def test_learn_printed_result_contains_no_command_text(tmp_path, capsys):
    transcripts = tmp_path / "synthetic-transcripts"
    secret_marker = "COMMAND_TEXT_MUST_NOT_LEAK_7f31"
    write_transcript(
        transcripts,
        [
            (f'widget convert "{secret_marker}-{n}"', False, "ok")
            for n in range(5)
        ],
    )

    exit_code, result, printed = invoke(capsys, "learn", "--root", transcripts)

    assert exit_code == 0
    assert result["out"]["recipe_candidates"] == 1
    assert secret_marker not in printed
    assert "widget convert" not in printed


@pytest.mark.parametrize("agent_variable", ["AI_AGENT", "CLAUDECODE"])
def test_learn_review_refuses_when_an_agent_variable_is_set(
    agent_variable, monkeypatch, capsys
):
    monkeypatch.setenv(agent_variable, "1")

    exit_code, result, _ = invoke(capsys, "learn", "--review")

    assert exit_code == 2
    assert result["ok"] is False
    assert "for a person" in result["note"]


def test_review_yes_creates_a_recipe_with_mocked_input(
    tmp_path, monkeypatch
):
    transcripts = tmp_path / "synthetic-transcripts"
    write_transcript(transcripts, eligible_calls())
    summary = learn.learn(transcripts)
    assert summary["recipe_candidates"] == 1

    reviewed = learn.review(ask=lambda _prompt: "y", show=lambda _line: None)

    recipe_path = (
        Path(os.environ["METAROUTER_HOME"])
        / "recipes"
        / "widget-convert.json"
    )
    assert reviewed == {"approved": 1, "rejected": 0, "left": 0}
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    assert recipe["body"] == "widget convert {1}"
    assert recipe["source"] == "learned"


def test_review_no_records_rejection_and_the_next_learn_skips_it(
    tmp_path, monkeypatch
):
    transcripts = tmp_path / "synthetic-transcripts"
    write_transcript(transcripts, eligible_calls())
    first = learn.learn(transcripts)
    assert first["recipe_candidates"] == 1

    reviewed = learn.review(ask=lambda _prompt: "n", show=lambda _line: None)
    second = learn.learn(transcripts)

    rejected_path = (
        Path(os.environ["METAROUTER_HOME"])
        / "candidates"
        / "rejected.json"
    )
    assert reviewed == {"approved": 0, "rejected": 1, "left": 0}
    assert len(json.loads(rejected_path.read_text(encoding="utf-8"))) == 1
    assert second["recipe_candidates"] == 0
