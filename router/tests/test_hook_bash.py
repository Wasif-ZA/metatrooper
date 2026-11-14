import io
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from metarouter import cli, hook

ROUTER = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def isolated_home(tmp_path, monkeypatch):
    monkeypatch.setenv("METAROUTER_HOME", str(tmp_path / "isolated-home"))


def wrapped(cmd, **extra):
    out = hook.wrap_bash({"command": cmd, **extra}, "")
    return out and out["command"]


def is_heredoc_of(emitted, cmd):
    head, _, rest = emitted.partition("\n")
    tag = head.removeprefix("metarouter exec --stdin <<'").removesuffix("'")
    return head.startswith("metarouter exec --stdin <<'MR_") and rest == f"{cmd}\n{tag}"


def run_like_bash_tool(emitted, tmp_path, as_file=False):
    """Run the hook's command string the way Claude Code's Bash tool does: bash -c, stdin from /dev/null.
    as_file runs it from a script file instead, since Windows cuts a native bash -c argument near 8 KB."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    shim = bin_dir / "metarouter"
    shim.write_bytes(f'#!/bin/bash\nexec "{Path(sys.executable).as_posix()}" -m metarouter.cli "$@"\n'.encode())
    shim.chmod(0o755)
    home = tmp_path / "home"
    env = {**os.environ, "METAROUTER_HOME": str(home), "PYTHONPATH": str(ROUTER)}
    env.pop("METAROUTER_SHELL", None)
    script = f'export PATH="$(cygpath -u "{bin_dir.as_posix()}" 2>/dev/null || echo "{bin_dir.as_posix()}"):$PATH"\n{emitted}'
    if as_file:
        (tmp_path / "run.sh").write_bytes(script.encode())
        argv = [cli.bash(), str(tmp_path / "run.sh")]
    else:
        argv = [cli.bash(), "-c", script]
    r = subprocess.run(argv, env=env, capture_output=True, stdin=subprocess.DEVNULL)
    return r, home


def test_commands_with_a_safety_before_hint_are_wrapped_even_when_not_big():
    for cmd in ["date +%s", "sleep 60", "taskkill //IM node.exe //F", "curl http://127.0.0.1:11434/v1/chat/completions",
                "agy ask summarize", "curl https://r.jina.ai/https://x.com", "git clean -xfd"]:
        assert is_heredoc_of(wrapped(cmd), cmd), cmd
    for cmd in ["git clean -fd", "MR_RAW=1 date", "echo date-ish"]:
        assert wrapped(cmd) is None, cmd


def test_big_output_commands_are_wrapped_with_the_command_text_in_view():
    for cmd in ["pytest -q", "cd src && npm test", "git diff 'a b' \"c\"", "git log --oneline", "gh api repos/x",
                "npm run build", "npx tsc --noEmit", "cargo test", "go test ./...", "node --test",
                "rm -rf build; date"]:
        assert is_heredoc_of(wrapped(cmd), cmd), cmd


def test_hook_writes_no_temp_files(monkeypatch, tmp_path):
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    wrapped("pytest -q")
    assert not list(tmp_path.iterdir())


def test_git_and_gh_global_options_before_the_subcommand_are_matched():
    for cmd in ["git -C src diff", "git --no-pager log -5", "gh -R a/b api repos/x", "gh --repo a/b api x"]:
        assert is_heredoc_of(wrapped(cmd), cmd), cmd
    for cmd in ["git -C src diff && git -C src push", "git --no-pager log && git --no-pager commit -m x"]:
        assert wrapped(cmd) is None, cmd


def test_commands_that_stay_raw():
    for cmd in ["cd src", "export A=1", "source .venv/bin/activate", "MR_RAW=1 pytest", "metarouter list",
                "git add a.txt", "git push origin main", "cd x && git commit -m hi", "rm -rf build", "",
                "ls -la", "echo hi", "cat a.txt", "grep -n x y", "git status", "python script.py"]:
        assert wrapped(cmd) is None, cmd
    assert wrapped("npm run dev", run_in_background=True) is None


def test_private_commands_stay_raw(monkeypatch):
    monkeypatch.setattr("metarouter.log.config", lambda: {"private": ["secretproj"]})
    assert wrapped("pytest secretproj/tests") is None
    assert hook.wrap_bash({"command": "pytest"}, "C:/work/secretproj") is None


def test_hook_output_keeps_other_fields_and_sets_no_permission_decision(monkeypatch):
    monkeypatch.setenv("METAROUTER_HOOK", "")
    event = {"tool_name": "Bash", "cwd": "", "tool_input": {"command": "pytest", "description": "list", "timeout": 5}}
    r = subprocess.run([sys.executable, "-m", "metarouter.hook"], input=json.dumps(event), capture_output=True, text=True)
    out = json.loads(r.stdout)["hookSpecificOutput"]
    assert "permissionDecision" not in out
    updated = out["updatedInput"]
    assert is_heredoc_of(updated.pop("command"), "pytest")
    assert updated == {"description": "list", "timeout": 5}


@pytest.mark.parametrize(("size", "as_file"), [(7000, False), (20000, True)], ids=["bash-c-7k", "script-20k"])
def test_big_command_round_trips_byte_exact(size, as_file, tmp_path, monkeypatch):
    monkeypatch.setattr(hook, "BIG", hook.re.compile(""))
    line = "it's \\\\server\\\\share caf\u00e9 \u2019q\u2019 \"dq\" $HOME $(date) `x` 'a''b' \u4e2d\nEOF\n"
    if not as_file:
        line = line.replace("\\\\", "/")  # a native bash -c argument also turns \\ into \ before the hook runs
    payload = (line * 400).encode()[:size].decode("utf-8", "ignore")
    emitted = wrapped("cat <<'END_OF_PAYLOAD'\n" + payload + "\nEND_OF_PAYLOAD")
    assert "\n" + payload + "\n" in emitted
    r, home = run_like_bash_tool(emitted, tmp_path, as_file)
    assert r.returncode == 0, r.stderr
    logs = list(home.rglob("*.log"))
    assert len(logs) == 1
    assert logs[0].read_bytes() == (payload + "\n").encode()
    assert json.loads((home / "calls.jsonl").read_text(encoding="utf-8"))["shape"].startswith("cat ")


def test_a_command_holding_the_first_delimiter_still_works(tmp_path, monkeypatch):
    tags = iter(["aaaa", "bbbb"])
    monkeypatch.setattr(hook.secrets, "token_hex", lambda _n: next(tags))
    emitted = hook.heredoc("cat <<'MR_aaaa'\nheld\nMR_aaaa")
    assert "<<'MR_bbbb'" in emitted
    r, _ = run_like_bash_tool(emitted, tmp_path)
    assert r.returncode == 0, r.stderr
    assert r.stdout.decode().strip() == "held"


def test_exit_codes_pass_through(tmp_path):
    r, _ = run_like_bash_tool(hook.heredoc("printf before; exit 7"), tmp_path)
    assert r.returncode == 7
    assert "before" in r.stdout.decode()


def stdin_of(monkeypatch, text):
    monkeypatch.setattr(sys, "stdin", SimpleNamespace(buffer=io.BytesIO(text)))


def test_stdin_cleanup_error_does_not_change_the_result(tmp_path, monkeypatch):
    stdin_of(monkeypatch, b"printf failing; exit 4\n")

    def locked(self, missing_ok=False):
        raise PermissionError("in use")

    monkeypatch.setattr(Path, "unlink", locked)
    r = cli.exec_lane(["--stdin"])
    assert r.exit == 4 and r.out == "failing"


def test_stdin_script_is_deleted_after_it_runs(tmp_path, monkeypatch):
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    stdin_of(monkeypatch, b"printf ok\n")
    r = cli.exec_lane(["--no-trunc", "--stdin"])
    assert r.out == "ok"
    assert not list(tmp_path.glob("metarouter-*.sh"))


def test_file_flag_inside_a_command_is_not_run_or_deleted(tmp_path, monkeypatch):
    pats = tmp_path / "pats.txt"
    pats.write_text("echo ran-as-$((1+1))")
    monkeypatch.chdir(tmp_path)

    r = cli.exec_lane(["grep", "--file", "pats.txt", "pats.txt"])

    assert "ran-as-2" not in str(r.out)
    assert pats.exists()


def script_file(tmp_path, monkeypatch, text="printf ran-it"):
    monkeypatch.delenv("METAROUTER_SHELL", raising=False)
    path = tmp_path / "user.sh"
    path.write_text(text)
    return path


def test_plain_file_flag_runs_the_script_but_never_deletes_it(tmp_path, monkeypatch):
    path = script_file(tmp_path, monkeypatch)
    r = cli.exec_lane(["--no-trunc", "--file", str(path)])
    assert r.out == "ran-it"
    assert path.exists()


@pytest.mark.parametrize("flag", ["--file", "--stdin"])
def test_script_without_bash_says_bash_is_required(flag, tmp_path, monkeypatch):
    path = script_file(tmp_path, monkeypatch)
    stdin_of(monkeypatch, b"printf x\n")
    monkeypatch.setattr(cli, "bash", lambda: None)
    r = cli.exec_lane([flag, str(path)] if flag == "--file" else [flag])
    assert r.exit == 127 and "bash required" in r.note
