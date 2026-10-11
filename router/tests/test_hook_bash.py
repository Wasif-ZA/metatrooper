import json
import subprocess
import sys

from metarouter import hook


def wrapped(cmd, **extra):
    out = hook.wrap_bash({"command": cmd, **extra}, "")
    return out and out["command"]


def test_plain_commands_run_through_metarouter_exec():
    assert wrapped("ls -la") == "metarouter exec -- 'ls -la'"
    assert wrapped("cd src && npm test") == "metarouter exec -- 'cd src && npm test'"


def test_single_quotes_survive_the_wrap():
    cmd = wrapped("echo 'a b' \"c\"")
    r = subprocess.run(["bash", "-c", cmd.replace("metarouter exec -- ", "printf %s ")], capture_output=True, text=True)
    assert r.stdout == "echo 'a b' \"c\""


def test_commands_that_stay_raw():
    for cmd in ["cd src", "export A=1", "source .venv/bin/activate", "MR_RAW=1 pytest", "metarouter list",
                "git add a.txt", "git push origin main", "cd x && git commit -m hi", "rm -rf build", ""]:
        assert wrapped(cmd) is None, cmd
    assert wrapped("npm run dev", run_in_background=True) is None


def test_private_commands_stay_raw(monkeypatch):
    monkeypatch.setattr("metarouter.log.config", lambda: {"private": ["secretproj"]})
    assert wrapped("cat secretproj/data.csv") is None
    assert hook.wrap_bash({"command": "ls"}, "C:/work/secretproj") is None


def test_hook_output_keeps_other_fields_and_sets_no_permission_decision(monkeypatch):
    monkeypatch.setenv("METAROUTER_HOOK", "")
    event = {"tool_name": "Bash", "cwd": "", "tool_input": {"command": "ls", "description": "list", "timeout": 5}}
    r = subprocess.run([sys.executable, "-m", "metarouter.hook"], input=json.dumps(event), capture_output=True, text=True)
    out = json.loads(r.stdout)["hookSpecificOutput"]
    assert "permissionDecision" not in out
    assert out["updatedInput"] == {"command": "metarouter exec -- 'ls'", "description": "list", "timeout": 5}
