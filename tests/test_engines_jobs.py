import json
import os
import threading
from pathlib import Path

import pytest

from toolrouter import cli, jobs
from toolrouter.recipes import engines


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path, monkeypatch):
    home = tmp_path / "toolrouter-home"
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.setenv("TOOLROUTER_HOME", str(home))
    for name in (
        "AI_AGENT",
        "CLAUDECODE",
        "TOOLROUTER_OUTPUT",
        "CLAUDE_CODE_SESSION_ID",
        "TOOLROUTER_CODEX_COMPANION",
        "TOOLROUTER_VAULT",
        "TOOLROUTER_SHELL",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(work)


def invoke(capsys, *args):
    exit_code = cli.main(["--json", *(str(arg) for arg in args)])
    captured = capsys.readouterr()
    assert captured.err == ""
    return exit_code, json.loads(captured.out)


def write_fake_vault(tmp_path, monkeypatch, *, local_body=None, agy_body=None):
    scripts = tmp_path / "fake-vault" / "meta" / "scripts"
    scripts.mkdir(parents=True)
    (scripts / "local.sh").write_text(
        local_body or "printf '%s\\n' 'synthetic local answer'\n", encoding="utf-8"
    )
    (scripts / "agy-run.sh").write_text(
        agy_body or "printf '%s\\n' 'synthetic gemini answer'\n", encoding="utf-8"
    )
    monkeypatch.setenv("TOOLROUTER_VAULT", str(tmp_path / "fake-vault"))
    return scripts


def write_fake_codex(tmp_path, monkeypatch):
    script = tmp_path / "fake-codex-companion.mjs"
    script.write_text(
        "console.log(JSON.stringify({answer: 'synthetic codex answer'}));\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("TOOLROUTER_CODEX_COMPANION", str(script))
    return script


def test_engine_prompt_is_one_argument_and_cannot_execute_shell_syntax(
    tmp_path, monkeypatch, capsys
):
    write_fake_vault(
        tmp_path,
        monkeypatch,
        local_body="printf '%s\\n' \"$#\"\nprintf '<%s>\\n' \"$@\"\n",
    )
    prompt = "keep this; touch injected-one; $(touch injected-two)"

    exit_code, result = invoke(capsys, "run", "local", prompt)

    assert exit_code == 0
    assert result["out"].splitlines() == [
        "3",
        "<ask>",
        "<gemma4:12b>",
        f"<{prompt}>",
    ]
    assert not Path("injected-one").exists()
    assert not Path("injected-two").exists()


def test_take_does_not_consume_a_following_flag_as_its_value():
    values, remaining = engines.take(
        ["--model", "--write", "synthetic prompt"], "--model"
    )

    assert values == []
    assert remaining == ["--model", "--write", "synthetic prompt"]


@pytest.mark.parametrize("directory_flag", [None, "--dir", "--add-dir"])
def test_gemini_requires_a_directory_for_file_naming_prompts(
    directory_flag, tmp_path, monkeypatch
):
    write_fake_vault(tmp_path, monkeypatch)
    args = ["summarize report.pdf"]
    if directory_flag:
        args += [directory_flag, "synthetic-folder"]

    if directory_flag is None:
        with pytest.raises(ValueError, match="no --add-dir or --dir"):
            engines.argv({"engine": "gemini"}, args, "synthetic-bash")
    else:
        argv = engines.argv({"engine": "gemini"}, args, "synthetic-bash")
        assert directory_flag in argv
        assert "synthetic-folder" in argv


def test_codex_accepts_a_prompt_that_starts_with_dashes(tmp_path, monkeypatch):
    companion = write_fake_codex(tmp_path, monkeypatch)

    argv = engines.argv(
        {"engine": "codex"}, ["--this-is-the-prompt"], "synthetic-bash"
    )

    assert argv == ["node", str(companion), "task", "--this-is-the-prompt"]


def test_local_lane_extract_routes_directly_to_extract(tmp_path, monkeypatch):
    scripts = write_fake_vault(tmp_path, monkeypatch)

    argv = engines.argv(
        {"engine": "local"},
        ["--lane", "extract", "synthetic payload"],
        "synthetic-bash",
    )

    assert argv == [
        "synthetic-bash",
        str(scripts / "local.sh"),
        "extract",
        "synthetic payload",
    ]


def test_prompt_file_is_read_as_utf8(tmp_path, monkeypatch):
    write_fake_vault(tmp_path, monkeypatch)
    prompt_file = Path("prompt.txt")
    prompt_file.write_bytes("naïve café 東京".encode("utf-8"))

    argv = engines.argv(
        {"engine": "local"}, ["--prompt-file", str(prompt_file)], "synthetic-bash"
    )

    assert argv[-1] == "naïve café 東京"


def test_agy_footer_is_removed_from_answer_but_preserved_in_log(
    tmp_path, monkeypatch, capsys
):
    footer = "agy-run: synthetic status footer"
    write_fake_vault(
        tmp_path,
        monkeypatch,
        agy_body=(
            "printf '%s\\n' 'synthetic verdict'\n"
            "printf '%s\\n' '------------------------'\n"
            f"printf '%s\\n' '{footer}'\n"
        ),
    )

    exit_code, result = invoke(capsys, "run", "gemini", "synthetic question")

    assert exit_code == 0
    assert result["out"] == "synthetic verdict"
    raw_log = Path(result["log"]).read_text(encoding="utf-8")
    assert footer in raw_log
    assert footer not in result["out"]


def test_engine_failure_includes_stderr_even_when_stdout_is_not_empty(
    tmp_path, monkeypatch, capsys
):
    write_fake_vault(
        tmp_path,
        monkeypatch,
        local_body=(
            "printf '%s\\n' 'partial stdout'\n"
            "printf '%s\\n' 'synthetic stderr detail' >&2\n"
            "exit 7\n"
        ),
    )

    exit_code, result = invoke(capsys, "run", "local", "synthetic prompt")

    assert exit_code == 7
    assert result["ok"] is False
    assert "partial stdout" in result["out"]
    assert "synthetic stderr detail" in result["out"]
    assert "synthetic stderr detail" in Path(result["log"]).read_text(encoding="utf-8")


def test_engine_json_answer_is_a_json_object(tmp_path, monkeypatch, capsys):
    write_fake_vault(
        tmp_path,
        monkeypatch,
        local_body="printf '%s\\n' '{\"verdict\":\"accept\",\"score\":2}'\n",
    )

    exit_code, result = invoke(capsys, "run", "local", "synthetic prompt")

    assert exit_code == 0
    assert result["out"] == {"verdict": "accept", "score": 2}
    assert isinstance(result["out"], dict)


def test_background_engine_returns_a_job_id(tmp_path, monkeypatch, capsys):
    write_fake_vault(tmp_path, monkeypatch)

    exit_code, result = invoke(
        capsys, "run", "local", "synthetic background prompt", "--background"
    )

    assert exit_code == 0
    assert result["ok"] is True
    assert result["exit"] == 0
    assert result["out"]["job"]
    assert result["out"]["collect"].endswith(
        f"jobs {result['out']['job']} --wait"
    )
    assert jobs.wait(result["out"]["job"], timeout=15)["status"] == "done"


def test_both_wait_argument_orders_work_from_a_different_cwd(
    tmp_path, monkeypatch, capsys
):
    write_fake_vault(
        tmp_path,
        monkeypatch,
        local_body="printf '%s\\n' '{\"answer\":\"job complete\"}'\n",
    )
    _, started = invoke(
        capsys, "run", "local", "synthetic job prompt", "--background"
    )
    jid = started["out"]["job"]
    other = tmp_path / "other-cwd"
    other.mkdir()
    monkeypatch.chdir(other)

    prefix_exit, prefix = invoke(capsys, "jobs", "--wait", jid)
    suffix_exit, suffix = invoke(capsys, "jobs", jid, "--wait")

    assert prefix_exit == suffix_exit == 0
    assert prefix["out"] == suffix["out"] == {"answer": "job complete"}


def test_collected_job_has_the_same_result_fields_as_foreground(
    tmp_path, monkeypatch, capsys
):
    write_fake_vault(
        tmp_path,
        monkeypatch,
        local_body="printf '%s\\n' '{\"answer\":\"same shape\"}'\n",
    )
    _, foreground = invoke(capsys, "run", "local", "synthetic foreground prompt")
    _, started = invoke(
        capsys, "run", "local", "synthetic background prompt", "--background"
    )
    _, collected = invoke(capsys, "jobs", started["out"]["job"], "--wait")

    assert set(collected) == set(foreground)
    defaults = {"errors": [], "tail": [], "hint": None, "breaker": None, "marker": None}
    for field in ("ok", "exit", "out", "errors", "tail", "hint", "breaker", "marker"):
        default = defaults.get(field)
        assert collected.get(field, default) == foreground.get(field, default)
    assert isinstance(collected["log"], str)
    assert Path(collected["log"]).is_file()


def test_killed_runner_without_a_result_is_lost(tmp_path, monkeypatch):
    job_folder = Path(os.environ["TOOLROUTER_HOME"]) / "jobs"
    job_folder.mkdir(parents=True)
    jid = "synthetic-killed"
    (job_folder / f"{jid}.json").write_text(
        json.dumps(
            {
                "id": jid,
                "label": "synthetic",
                "cwd": str(Path.cwd()),
                "started": "2026-09-28T12:00:00+10:00",
                "pid": 424242,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(jobs, "alive", lambda _pid: False)

    result = jobs.status(jid)

    assert result["status"] == "lost"


def test_result_written_just_after_process_exit_is_done_not_lost(
    tmp_path, monkeypatch
):
    job_folder = Path(os.environ["TOOLROUTER_HOME"]) / "jobs"
    job_folder.mkdir(parents=True)
    jid = "synthetic-race"
    (job_folder / f"{jid}.json").write_text(
        json.dumps(
            {
                "id": jid,
                "label": "synthetic",
                "cwd": str(Path.cwd()),
                "started": "2026-09-28T12:00:00+10:00",
                "pid": 434343,
            }
        ),
        encoding="utf-8",
    )
    result_path = job_folder / f"{jid}.result.json"

    def write_result_and_exit(_pid):
        result_path.write_text(
            json.dumps({"ok": True, "lane": "run", "exit": 0, "out": "late"}),
            encoding="utf-8",
        )
        return False

    monkeypatch.setattr(jobs, "alive", write_result_and_exit)

    result = jobs.status(jid)

    assert result["status"] == "done"
    assert result["result"]["out"] == "late"
