import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from callrouter import hints


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("CALLROUTER_HOME", str(tmp_path / "callrouter-home"))
    for name in (
        "AI_AGENT",
        "CLAUDECODE",
        "CALLROUTER_OUTPUT",
        "CLAUDE_CODE_SESSION_ID",
    ):
        monkeypatch.delenv(name, raising=False)


@pytest.mark.parametrize(
    ("command", "near_miss", "expected_text"),
    [
        (
            "agy ask summarize",
            "agy ask summarize --add-dir synthetic",
            "Add --add-dir <folder>",
        ),
        (
            "curl http://127.0.0.1:11434/v1/chat/completions",
            "curl http://127.0.0.1:11434/api/generate",
            "/api/generate",
        ),
        (
            "taskkill /IM node.exe",
            "taskkill /PID 12345",
            "Kill the one pid",
        ),
        (
            "git clean -xfd",
            "git clean -fd",
            "deletes ignored files",
        ),
        (
            "date +%s",
            "dateutil --version",
            "reads the clock as UTC",
        ),
        (
            "sleep 60",
            "sleep 9",
            "Long foreground sleeps",
        ),
    ],
    ids=["agy", "ollama", "taskkill", "git-clean", "date", "sleep"],
)
def test_each_seed_before_hint_matches_but_not_a_near_miss(
    command, near_miss, expected_text
):
    assert expected_text in hints.match(command)
    assert hints.match(near_miss) is None


@pytest.mark.parametrize(
    ("output", "near_miss", "expected_text"),
    [
        (
            "UnicodeDecodeError: 'charmap' codec can't decode byte",
            "UnicodeError without a codec failure",
            'encoding="utf-8"',
        ),
        (
            "bash: jq: command not found",
            "jq was found and completed",
            "callrouter run json",
        ),
        (
            "Python was not found; run without arguments to install",
            "Python is not found in this documentation",
            "Microsoft Store stub",
        ),
        (
            "ModuleNotFoundError: No module named 'synthetic_pkg'",
            "ImportError: synthetic_pkg was unavailable",
            "not installed for this interpreter",
        ),
    ],
    ids=["encoding", "jq", "store-python", "missing-module"],
)
def test_each_seed_failure_hint_matches_but_not_a_near_miss(
    output, near_miss, expected_text
):
    assert expected_text in hints.match("synthetic command", output, failed=True)
    assert hints.match("synthetic command", near_miss, failed=True) is None


def test_failure_hint_does_not_fire_on_successful_call():
    output = "ModuleNotFoundError: No module named 'synthetic_pkg'"

    assert hints.match("synthetic command", output, failed=False) is None


def test_user_hint_overrides_seed_with_the_same_id(monkeypatch):
    home = Path(os.environ["CALLROUTER_HOME"])
    home.mkdir(parents=True)
    (home / "hints.json").write_text(
        json.dumps(
            [
                {
                    "id": "cp1252",
                    "when": "fail",
                    "match": "SyntheticCodecFailure",
                    "hint": "use the synthetic override",
                }
            ]
        ),
        encoding="utf-8",
    )

    assert (
        hints.match(
            "synthetic command",
            "UnicodeDecodeError: old seed should be replaced",
            failed=True,
        )
        is None
    )
    assert (
        hints.match(
            "synthetic command", "SyntheticCodecFailure happened", failed=True
        )
        == "use the synthetic override"
    )


def failure_record(when, *, exit_code=1):
    return {
        "time": when.isoformat(),
        "recipe": "synthetic-engine",
        "shape": "ignored shape",
        "exit": exit_code,
        "log": "synthetic.log",
    }


def test_breaker_warns_only_after_three_consecutive_failures_within_an_hour():
    start = datetime(2026, 9, 28, 12, 0, tzinfo=timezone.utc)
    rows = [failure_record(start + timedelta(minutes=n)) for n in (0, 10, 20)]

    assert hints.breaker(rows[:2], rows[1]) is None
    warning = hints.breaker(rows, rows[-1])
    assert "failed 3 times in a row" in warning
    assert "synthetic.log" in warning

    spread_out = [
        failure_record(start),
        failure_record(start + timedelta(minutes=31)),
        failure_record(start + timedelta(minutes=61)),
    ]
    assert hints.breaker(spread_out, spread_out[-1]) is None


def test_breaker_resets_after_a_success_between_failures():
    start = datetime(2026, 9, 28, 12, 0, tzinfo=timezone.utc)
    rows = [
        failure_record(start),
        failure_record(start + timedelta(minutes=1)),
        failure_record(start + timedelta(minutes=2), exit_code=0),
        failure_record(start + timedelta(minutes=3)),
        failure_record(start + timedelta(minutes=4)),
    ]

    assert hints.breaker(rows, rows[-1]) is None

    rows.append(failure_record(start + timedelta(minutes=5)))
    assert "failed 3 times in a row" in hints.breaker(rows, rows[-1])
