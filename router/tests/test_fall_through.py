from conftest import agent_result
import json
import os
from pathlib import Path
import shlex
import re
import subprocess
import sys

import pytest

from metarouter import cli, jobs, mcp


@pytest.fixture(autouse=True)
def isolated_repo(tmp_path, monkeypatch):
    root = tmp_path / "repo with spaces"
    root.mkdir()
    subprocess.run(["git", "init", str(root)], check=True, capture_output=True)
    monkeypatch.chdir(root)
    monkeypatch.setenv("METAROUTER_HOME", str(tmp_path / "metarouter-home"))
    monkeypatch.setenv("METAROUTER_MODE", "auto")
    for name in (
        "AI_AGENT", "CLAUDECODE", "METAROUTER_OUTPUT",
        "CLAUDE_CODE_SESSION_ID", "METAROUTER_SHELL",
    ):
        monkeypatch.delenv(name, raising=False)
    return root


def write_script(root, relative, body="print('repo-script-ran')\n"):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    return path


@pytest.mark.parametrize("directory", ["scripts", "meta/scripts", "bin", ""])
@pytest.mark.parametrize("name", ["mr-probe", "mr-probe.py"])
def test_run_discovers_script_by_stem_or_filename_from_git_root(
    isolated_repo, monkeypatch, directory, name
):
    write_script(isolated_repo, Path(directory) / "mr-probe.py")
    nested = isolated_repo / "work" / "nested"
    nested.mkdir(parents=True)
    monkeypatch.chdir(nested)

    result = cli.run_lane([name])

    assert result.ok is True
    assert result.exit == 0
    assert result.lane == "exec"
    assert result.out.strip() == "repo-script-ran"


def test_repo_scripts_lists_supported_files_in_directory_order(isolated_repo, monkeypatch):
    expected = []
    for directory in ("scripts", "meta/scripts", "bin", ""):
        for extension in (".sh", ".py", ".js", ".cjs", ".mjs", ".ps1"):
            expected.append(write_script(isolated_repo, Path(directory) / f"probe{extension}"))
        write_script(isolated_repo, Path(directory) / "ignored.txt")
        (isolated_repo / directory / "directory.py").mkdir()
    nested = isolated_repo / "nested"
    nested.mkdir()
    write_script(nested, "excluded.py")
    monkeypatch.chdir(nested)

    assert cli.repo_scripts() == [
        path for directory in ("scripts", "meta/scripts", "bin", "")
        for path in sorted(p for p in expected if p.parent == isolated_repo / directory)
    ]


def test_repo_scripts_without_git_root_is_empty(tmp_path, monkeypatch):
    outside = tmp_path / "outside"
    outside.mkdir()
    write_script(outside, "scripts/mr-probe.py")
    monkeypatch.chdir(outside)

    assert cli.repo_scripts() == []


@pytest.mark.parametrize("first", [0, 1, 2, 3])
def test_find_script_prefers_scripts_then_meta_then_bin_then_root(isolated_repo, monkeypatch, first):
    directories = ("scripts", "meta/scripts", "bin", "")
    paths = [write_script(isolated_repo, Path(d) / "mr-probe.py") for d in directories[first:]]

    nested = isolated_repo / "work"
    nested.mkdir()
    monkeypatch.chdir(nested)

    assert cli.find_script("mr-probe") == paths[0]
    assert cli.find_script("mr-probe.py") == paths[0]


def test_direct_path_wins_over_same_stem_in_scripts(isolated_repo):
    write_script(isolated_repo, "scripts/mr-probe.py", "print('wrong-script')\n")
    write_script(isolated_repo, "meta/scripts/mr-probe.py", "print('direct-script')\n")

    assert cli.find_script("meta/scripts/mr-probe.py") == (isolated_repo / "meta/scripts/mr-probe.py").resolve()
    result = cli.run_lane(["meta/scripts/mr-probe.py"])

    assert result.ok is True
    assert result.exit == 0
    assert result.lane == "exec"
    assert result.out.strip() == "direct-script"


@pytest.mark.parametrize(
    ("extension", "runner"),
    [
        (".sh", ["/test/bash"]),
        (".py", [Path(sys.executable).as_posix()]),
        (".js", ["node"]),
        (".cjs", ["node"]),
        (".mjs", ["node"]),
        (".ps1", ["/test/pwsh", "-NoProfile", "-File"]),
    ],
)
def test_script_command_selects_runner_and_preserves_args(extension, runner, monkeypatch):
    monkeypatch.setattr(cli, "bash", lambda: "/test/bash")
    monkeypatch.setattr(cli, "powershell", lambda: "/test/pwsh")
    args = ["two words", "--flag", "a'b"]

    assert cli.script_command(Path(f"meta/scripts/probe{extension}"), args) == [
        *runner, f"meta/scripts/probe{extension}", *args,
    ]


def test_python_script_receives_args_and_current_interpreter(isolated_repo, capsys):
    write_script(
        isolated_repo, "scripts/mr-probe.py",
        "import json, sys\nprint(json.dumps([sys.executable, sys.argv[1:]]))\n",
    )
    args = ["two words", "--flag", "a'b"]

    exit_code = cli.main(["--json", "run", "mr-probe", *args])

    captured = capsys.readouterr()
    result = agent_result(captured.out)
    assert captured.err == ""
    assert exit_code == 0
    assert result["ok"] is True
    interpreter, received = json.loads(result["out"])
    assert Path(interpreter).resolve() == Path(sys.executable).resolve()
    assert received == args


def test_repo_script_does_not_shadow_path_cli(isolated_repo, monkeypatch):
    executable = Path(sys.executable)
    write_script(isolated_repo, f"scripts/{executable.stem}.py", "print('wrong-script')\n")
    monkeypatch.setenv("PATH", str(executable.parent) + os.pathsep + os.environ.get("PATH", ""))
    args = ["-c", "print('path-cli-ran')"]

    assert cli.fall_through(executable.stem, args) == [executable.stem, *args]
    result = cli.run_lane([executable.stem, *args])

    assert result.ok is True
    assert result.exit == 0
    assert result.lane == "exec"
    assert result.out.strip() == "path-cli-ran"


def test_path_cli_falls_through_to_exec(isolated_repo, monkeypatch):
    executable = Path(sys.executable)
    monkeypatch.setenv("PATH", str(executable.parent) + os.pathsep + os.environ.get("PATH", ""))
    args = ["-c", "print('path-cli-ran')"]

    assert cli.fall_through(executable.name, args) == [executable.name, *args]
    result = cli.run_lane([executable.name, *args])

    assert result.ok is True
    assert result.exit == 0
    assert result.lane == "exec"
    assert result.out.strip() == "path-cli-ran"


@pytest.mark.parametrize("target", ["script", "path-cli"])
def test_learn_mode_keeps_no_recipe_result(isolated_repo, monkeypatch, target):
    if target == "script":
        write_script(isolated_repo, "scripts/mr-probe.py")
        name, args = "mr-probe", []
    else:
        executable = Path(sys.executable)
        monkeypatch.setenv("PATH", str(executable.parent) + os.pathsep + os.environ.get("PATH", ""))
        name, args = executable.name, ["-c", "print('path-cli-ran')"]
    assert cli.run_lane([name, *args]).lane == "exec"
    monkeypatch.setenv("METAROUTER_MODE", "learn")

    assert cli.fall_through(name, args) is None
    result = cli.run_lane([name, *args])

    assert result.ok is False
    assert result.exit == 2
    assert result.lane == "run"
    assert f'no recipe "{name}"' in result.note


def test_unknown_name_keeps_no_recipe_result(isolated_repo):
    name = "mr-missing-command-93741"

    assert cli.fall_through(name, ["argument"]) is None
    result = cli.run_lane([name, "argument"])

    assert result.ok is False
    assert result.exit == 2
    assert result.lane == "run"
    assert f'no recipe "{name}"' in result.note


def test_real_recipe_wins_over_repo_script(isolated_repo):
    write_script(isolated_repo, "scripts/mr-probe.py")
    recipe_script = write_script(isolated_repo, "recipe.py", "print('recipe-ran')\n")
    assert cli.run_lane(["mr-probe"]).out.strip() == "repo-script-ran"
    command = shlex.join([Path(sys.executable).as_posix(), recipe_script.as_posix()])
    if cli.is_powershell(cli.shell()):
        command = "& " + command
    cli.store.save("mr-probe", command)

    result = cli.run_lane(["mr-probe"])

    assert result.ok is True
    assert result.exit == 0
    assert result.lane == "run"
    assert result.recipe == "mr-probe"
    assert result.out.strip() == "recipe-ran"


def test_search_lists_matching_repo_script_only_in_auto_mode(isolated_repo, monkeypatch, capsys):
    write_script(isolated_repo, "meta/scripts/mr-probe.py")
    write_script(isolated_repo, "scripts/unrelated.py")
    monkeypatch.setattr(mcp, "catalog_lines", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(mcp, "cached_tools", lambda: {})
    monkeypatch.setattr(cli, "path_bins", lambda: [])

    assert cli.main(["--json", "search", "MR-PROBE"]) == 0
    result = agent_result(capsys.readouterr().out)
    assert result["ok"] is True
    assert result["out"] == "metarouter run ./meta/scripts/mr-probe.py    repo script"
    monkeypatch.setenv("METAROUTER_MODE", "learn")
    result = cli.search_lane(["mr-probe"])
    assert result.ok is False
    assert result.exit == 1


def test_policy_refuses_fall_through_before_script_executes(isolated_repo):
    marker = isolated_repo / "executed.txt"
    write_script(
        isolated_repo, "scripts/mr-probe.py",
        "from pathlib import Path\nPath('executed.txt').write_text('ran')\n",
    )
    policy_file = isolated_repo / ".metarouter" / "policy.json"
    policy_file.parent.mkdir()
    policy_file.write_text(json.dumps({"refuse": ["mr-probe"]}), encoding="utf-8")

    result = cli.run_lane(["mr-probe"])

    assert result.ok is False
    assert result.exit == 3
    assert result.lane == "exec"
    assert "refused by" in result.note
    assert policy_file.as_posix() in result.note
    assert not marker.exists()


@pytest.fixture
def forced_powershell(monkeypatch):
    executable = cli.powershell()
    if not executable:
        pytest.skip("PowerShell is not available")
    monkeypatch.setenv("METAROUTER_SHELL", executable)
    assert cli.is_powershell(cli.shell())
    return executable


@pytest.mark.parametrize("background", [False, True])
def test_anchored_policy_refuses_fall_through_on_powershell(
    isolated_repo, monkeypatch, forced_powershell, background
):
    marker = isolated_repo / "executed.txt"
    write_script(
        isolated_repo, "scripts/mr-probe.py",
        "from pathlib import Path\nPath('executed.txt').write_text('ran')\n",
    )
    pattern = "^" + re.escape(shlex.quote(Path(sys.executable).as_posix())) + " "
    policy_file = isolated_repo / ".metarouter" / "policy.json"
    policy_file.parent.mkdir()
    policy_file.write_text(json.dumps({"refuse": [pattern]}), encoding="utf-8")

    def unexpected_execution(*args, **kwargs):
        pytest.fail("refused fall-through must not execute or start a job")

    monkeypatch.setattr(cli, "exec_lane", unexpected_execution)
    monkeypatch.setattr(jobs, "start", unexpected_execution)
    result = cli.run_lane(["mr-probe", *(["--background"] if background else [])])

    assert result.ok is False
    assert result.exit == 3
    assert result.lane == "exec"
    assert "refused by" in result.note
    assert policy_file.as_posix() in result.note
    assert pattern in result.note
    assert not marker.exists()


@pytest.mark.parametrize("target", ["script", "path-cli"])
def test_apostrophe_argument_arrives_intact_on_powershell(
    isolated_repo, monkeypatch, forced_powershell, target
):
    body = "import json, sys\nprint(json.dumps(sys.argv[1:]))\n"
    args = ["a'b", "two words", "it's a 'quoted' argument"]
    if target == "script":
        write_script(isolated_repo, "scripts/mr-probe.py", body)
        command = ["mr-probe", *args]
    else:
        executable = Path(sys.executable)
        monkeypatch.setenv("PATH", str(executable.parent) + os.pathsep + os.environ.get("PATH", ""))
        command = [executable.name, "-c", body, *args]

    result = cli.run_lane(command)

    assert result.ok is True
    assert result.exit == 0
    assert result.lane == "exec"
    assert json.loads(result.out) == args


@pytest.mark.parametrize("target", ["script", "path-cli"])
def test_background_fall_through_returns_job(isolated_repo, monkeypatch, target):
    marker = isolated_repo / "executed.txt"
    body = "from pathlib import Path\nPath('executed.txt').write_text('ran')\n"
    if target == "script":
        write_script(isolated_repo, "scripts/mr-probe.py", body)
        name, args = "mr-probe", ["two words", "a'b"]
    else:
        executable = Path(sys.executable)
        monkeypatch.setenv("PATH", str(executable.parent) + os.pathsep + os.environ.get("PATH", ""))
        name, args = executable.name, ["-c", body]
    started = []

    def start(argv, *, label):
        started.append((argv, label))
        return "job-probe-123"

    monkeypatch.setattr(jobs, "start", start)
    result = cli.run_lane([name, "--background", *args])

    assert result.ok is True
    assert result.exit == 0
    assert result.lane == "jobs"
    assert result.out == {
        "job": "job-probe-123",
        "collect": "metarouter jobs job-probe-123 --wait",
    }
    assert started == [(["run", name, *args], name)]
    assert not marker.exists()


@pytest.mark.parametrize("name_kind", ["parent", "absolute", "missing-directory"])
def test_find_script_refuses_outside_repo_and_invalid_directory_paths(
    isolated_repo, name_kind
):
    write_script(isolated_repo, "scripts/probe.py")
    outside = write_script(isolated_repo.parent, "probe.py")
    name = {
        "parent": "../probe.py",
        "absolute": str(outside.resolve()),
        "missing-directory": "missing/probe.py",
    }[name_kind]

    assert cli.find_script(name) is None


def test_find_script_resolves_explicit_path_against_cwd_then_repo_root(
    isolated_repo, monkeypatch
):
    script = write_script(isolated_repo, "scripts/probe.py")
    root_script = write_script(isolated_repo, "probe.py")
    cwd_script = write_script(isolated_repo, "work/probe.py")
    monkeypatch.chdir(cwd_script.parent)

    assert cli.find_script("probe.py") == script
    assert cli.find_script("./probe.py") == cwd_script.resolve()
    cwd_script.unlink()
    assert cli.find_script("./probe.py") == root_script.resolve()


@pytest.mark.parametrize("stem", ["probe", "probe with spaces"])
def test_search_command_runs_the_named_file_when_stems_collide(
    isolated_repo, monkeypatch, stem
):
    if not cli.shutil.which("node"):
        pytest.skip("Node.js is not available")
    python_path = write_script(isolated_repo, f"scripts/{stem}.py", "print('python-probe')\n")
    js_path = write_script(isolated_repo, f"bin/{stem}.js", "console.log('javascript-probe');\n")
    monkeypatch.setattr(mcp, "catalog_lines", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(mcp, "cached_tools", lambda: {})
    monkeypatch.setattr(cli, "path_bins", lambda: [])

    result = cli.search_lane(["probe"])

    assert result.ok is True
    expected = {python_path: "python-probe", js_path: "javascript-probe"}
    script_lines = [line for line in result.out.splitlines() if line.endswith("    repo script")]
    assert script_lines == [
        f"metarouter run {cli.quote_any('./' + path.relative_to(isolated_repo).as_posix())}    repo script"
        for path in expected
    ]
    for line, (path, output) in zip(script_lines, expected.items()):
        command, label = line.rsplit("    ", 1)
        argv = shlex.split(command)
        assert label == "repo script"
        assert argv[:2] == ["metarouter", "run"]
        assert cli.find_script(argv[2]) == path.resolve()
        executed = cli.run_lane(argv[2:])
        assert executed.ok is True
        assert executed.exit == 0
        assert executed.lane == "exec"
        assert executed.out.strip() == output


@pytest.mark.parametrize("separator", ["/", "\\"])
def test_explicit_path_never_looks_up_path_cli(isolated_repo, monkeypatch, separator):
    path = write_script(isolated_repo, "scripts/mr-probe.py")

    def unexpected_lookup(name):
        pytest.fail("explicit paths must not be looked up on PATH")

    monkeypatch.setattr(cli.shutil, "which", unexpected_lookup)
    monkeypatch.setattr(cli, "bash", lambda: None)
    monkeypatch.setattr(cli, "powershell", lambda: None)
    name = separator.join(["scripts", "mr-probe.py"])
    expected = (
        [Path(sys.executable).as_posix(), path.resolve().as_posix(), "argument"]
        if separator == "/" or os.name == "nt" else None
    )

    assert cli.fall_through(name, ["argument"]) == expected


def test_absolute_executable_outside_repo_does_not_fall_through(isolated_repo, monkeypatch):
    executable = Path(sys.executable).resolve()
    assert not executable.is_relative_to(isolated_repo)
    monkeypatch.setenv("PATH", str(executable.parent) + os.pathsep + os.environ.get("PATH", ""))
    assert cli.shutil.which(executable.name)

    assert cli.fall_through(str(executable), ["-c", "print('must-not-run')"]) is None


@pytest.mark.parametrize("relative", ["./unsupported.txt", "./directory.py"])
def test_explicit_path_requires_a_file_with_script_extension(isolated_repo, relative):
    write_script(isolated_repo, "unsupported.txt")
    (isolated_repo / "directory.py").mkdir()

    assert cli.find_script(relative) is None
    assert cli.fall_through(relative, []) is None


def test_repo_scripts_skips_symlink_target_outside_repo(isolated_repo):
    outside = write_script(isolated_repo.parent, "outside.py")
    inside = write_script(isolated_repo, "scripts/inside.py")
    link = isolated_repo / "scripts" / "outside.py"
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError) as error:
        pytest.skip(f"Symlinks are unsupported: {error}")

    assert cli.repo_scripts() == [inside]
    assert cli.find_script("outside") is None
    assert cli.find_script("./scripts/outside.py") is None
    assert cli.fall_through("./scripts/outside.py", []) is None


def test_duplicate_policy_warning_appears_once_on_powershell(isolated_repo, forced_powershell):
    write_script(isolated_repo, "scripts/mr-probe.py")
    policy_file = isolated_repo / ".metarouter" / "policy.json"
    policy_file.parent.mkdir()
    policy_file.write_text(json.dumps({"warn": ["mr-probe", "mr-probe"]}), encoding="utf-8")

    result = cli.run_lane(["mr-probe"])

    assert result.ok is True
    assert result.exit == 0
    assert result.out.strip() == "repo-script-ran"
    warning = f"warned by {policy_file.as_posix()}: mr-probe"
    assert result.note == warning


def test_add_note_drops_duplicates_and_preserves_note_order(isolated_repo):
    result = cli.Result(ok=True, lane="exec", note="existing; warning; warning")

    assert cli.add_note(result, "warning", None, "new", "new", "existing") is result
    assert result.note == "existing; warning; new"


@pytest.mark.parametrize("shell_name", ["default", "powershell"])
def test_complex_arguments_reach_fall_through_unchanged(
    isolated_repo, monkeypatch, shell_name
):
    if shell_name == "powershell":
        executable = cli.powershell()
        if not executable:
            pytest.skip("PowerShell is not available")
        monkeypatch.setenv("METAROUTER_SHELL", executable)

    body = "import json, sys\nprint(json.dumps(sys.argv[1:]))\n"
    args = ['', 'a"b', '"two words"', "it's"]

    write_script(isolated_repo, "scripts/mr-probe.py", body)
    script_result = cli.run_lane(["mr-probe", *args])
    assert script_result.ok is True
    assert script_result.exit == 0
    assert script_result.lane == "exec"
    assert json.loads(script_result.out) == args

    executable_path = Path(sys.executable)
    monkeypatch.setenv("PATH", str(executable_path.parent) + os.pathsep + os.environ.get("PATH", ""))
    cli_result = cli.run_lane([executable_path.name, "-c", body, *args])
    assert cli_result.ok is True
    assert cli_result.exit == 0
    assert cli_result.lane == "exec"
    assert json.loads(cli_result.out) == args


def test_search_quotes_apostrophe_script_path_for_bash_and_powershell(
    isolated_repo, monkeypatch
):
    write_script(isolated_repo, "scripts/it's probe.py")
    monkeypatch.setattr(mcp, "catalog_lines", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(mcp, "cached_tools", lambda: {})
    monkeypatch.setattr(cli, "path_bins", lambda: [])

    result = cli.search_lane(["probe"])

    assert result.ok is True
    script_lines = [line for line in result.out.splitlines() if line.endswith("    repo script")]
    assert len(script_lines) == 1
    command, label = script_lines[0].rsplit("    ", 1)
    argv = shlex.split(command)
    assert label == "repo script"
    assert argv[:2] == ["metarouter", "run"]
    assert argv[2] == "./scripts/it's probe.py"
    assert len(argv) == 3

    quoted_path = command[len("metarouter run "):]
    assert quoted_path == '"./scripts/it\'s probe.py"'

    pwsh = cli.powershell()
    if pwsh:
        proc = subprocess.run(
            [pwsh, "-NoProfile", "-Command", f"& {{ echo $args.Count }} {quoted_path}"],
            capture_output=True,
            text=True,
            check=True,
        )
        assert proc.stdout.strip() == "1"

    assert cli.quote_any("scripts/probe.py") == "scripts/probe.py"
    assert cli.quote_any("scripts/probe with spaces.py") == '"scripts/probe with spaces.py"'
    assert cli.quote_any("scripts/it's probe.py") == '"scripts/it\'s probe.py"'
    assert cli.quote_any("scripts/$probe.py") == "'scripts/$probe.py'"
    assert cli.quote_any("probe.py") == "probe.py"
    assert cli.quote_any("probe with space.py") == '"probe with space.py"'
    assert cli.quote_any("it's probe.py") == '"it\'s probe.py"'
    assert cli.quote_any("$probe.py") == "'$probe.py'"


def test_fall_through_returns_127_when_run_argv_raises_os_error(
    isolated_repo, monkeypatch
):
    write_script(isolated_repo, "scripts/mr-probe.py")

    def broken_run_argv(argv):
        raise OSError("failed to start")

    monkeypatch.setattr(cli, "run_argv", broken_run_argv)
    result = cli.run_lane(["mr-probe"])

    assert result.ok is False
    assert result.exit == 127
    assert result.lane == "exec"
    assert "could not start" in result.note
    assert Path(sys.executable).as_posix() in result.note

    executable = Path(sys.executable)
    monkeypatch.setenv("PATH", str(executable.parent) + os.pathsep + os.environ.get("PATH", ""))
    cli_result = cli.run_lane([executable.name, "-c", "print(1)"])
    assert cli_result.ok is False
    assert cli_result.exit == 127
    assert cli_result.lane == "exec"
    assert f"could not start {executable.name}" in cli_result.note


def test_jobs_run_stores_successful_result_for_fall_through_and_seed_recipe(isolated_repo):
    write_script(isolated_repo, "scripts/mr-probe.py", "print('repo-script-ran')\n")
    jobs.folder().mkdir(parents=True, exist_ok=True)

    jobs._run("job-probe-fallthrough", ["run", "mr-probe"])

    stored_fallthrough = json.loads(
        (jobs.folder() / "job-probe-fallthrough.result.json").read_text(encoding="utf-8")
    )
    assert stored_fallthrough["ok"] is True
    assert stored_fallthrough["job"] == "job-probe-fallthrough"
    assert stored_fallthrough["out"].strip() == "repo-script-ran"

    demo = isolated_repo / "demo.json"
    demo.write_text(json.dumps({"msg": "hello"}), encoding="utf-8")

    jobs._run("job-probe-seed", ["run", "json", demo.name, ".msg"])

    stored_seed = json.loads(
        (jobs.folder() / "job-probe-seed.result.json").read_text(encoding="utf-8")
    )
    assert stored_seed["ok"] is True
    assert stored_seed["job"] == "job-probe-seed"
    assert stored_seed["out"] == "hello"


def test_render_json_text_ok_false_emits_valid_json_for_whole_string_result():
    result = cli.Result(ok=True, lane="exec", out="repo-script-ran", whole=True)

    rendered_json = cli.render(result, "json", text_ok=False)
    parsed = json.loads(rendered_json)
    assert parsed["ok"] is True
    assert parsed["out"] == "repo-script-ran"

    rendered_plain = cli.render(result, "json")
    assert rendered_plain == "repo-script-ran"
    with pytest.raises(json.JSONDecodeError):
        json.loads(rendered_plain)


def test_anchored_policy_refuses_fall_through_by_script_name(isolated_repo, capsys):
    marker = isolated_repo / "executed.txt"
    write_script(
        isolated_repo, "scripts/mr-probe.py",
        "from pathlib import Path\nPath('executed.txt').write_text('ran')\n",
    )
    policy_file = isolated_repo / ".metarouter" / "policy.json"
    policy_file.parent.mkdir()
    policy_file.write_text(json.dumps({"refuse": ["^mr-probe"]}), encoding="utf-8")

    result = cli.run_lane(["mr-probe"])

    assert result.ok is False
    assert result.exit == 3
    assert result.lane == "exec"
    assert "refused by" in result.note
    assert policy_file.as_posix() in result.note
    assert "^mr-probe" in result.note
    assert not marker.exists()

    assert cli.main(["run", "mr-probe"]) == 3
    assert not marker.exists()


def test_fall_through_preserves_yes_argument_for_script(isolated_repo, capsys, monkeypatch):
    write_script(
        isolated_repo, "scripts/mr-probe.py",
        "import json, sys\nprint(json.dumps(sys.argv[1:]))\n",
    )

    result = cli.run_lane(["mr-probe", "--yes", "x"])
    assert result.ok is True
    assert result.exit == 0
    assert result.lane == "exec"
    assert json.loads(result.out) == ["--yes", "x"]

    exit_code = cli.main(["--json", "run", "mr-probe", "--yes", "x"])
    captured = capsys.readouterr()
    agent_res = agent_result(captured.out)
    assert exit_code == 0
    assert agent_res["ok"] is True
    assert json.loads(agent_res["out"]) == ["--yes", "x"]

    started = []
    monkeypatch.setattr(jobs, "start", lambda argv, *, label: started.append((argv, label)) or "job-probe-yes")
    bg_result = cli.run_lane(["mr-probe", "--background", "--yes", "x"])
    assert bg_result.ok is True
    assert bg_result.exit == 0
    assert bg_result.lane == "jobs"
    assert bg_result.out == {
        "job": "job-probe-yes",
        "collect": "metarouter jobs job-probe-yes --wait",
    }
    assert started == [(["run", "mr-probe", "--yes", "x"], "mr-probe")]

