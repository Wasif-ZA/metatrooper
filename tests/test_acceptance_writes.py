import json
from pathlib import Path

from metarouter import cli, hook


def _invoke(capsys, *args):
    exit_code = cli.main(["--json", *(str(arg) for arg in args)])
    captured = capsys.readouterr()
    assert captured.err == ""
    assert captured.out.count("\n") == 1
    result = json.loads(captured.out)
    assert exit_code == 0, result
    return result


def _paths_under(root):
    return {path.resolve() for path in root.rglob("*")}


def _assert_writes_are_confined(
    lane, sandbox_root, baseline_paths, project, expected_project_paths, metarouter_home, legacy_cache
):
    project_paths = {path.relative_to(project) for path in project.rglob("*")}
    assert project_paths == expected_project_paths, (
        f"{lane} changed the project path set: "
        f"{sorted(map(str, project_paths ^ expected_project_paths))}"
    )

    if legacy_cache.exists():
        legacy_paths = [legacy_cache.resolve(), *_paths_under(legacy_cache)]
        raise AssertionError(
            f"{lane} wrote to Path.home()/.cache/metarouter: "
            f"{sorted(map(str, legacy_paths))}"
        )

    new_paths = _paths_under(sandbox_root) - baseline_paths
    escaped = sorted(str(path) for path in new_paths if not path.is_relative_to(metarouter_home))
    assert not escaped, f"{lane} wrote outside METAROUTER_HOME: {escaped}"


def test_representative_cli_lanes_write_only_under_metarouter_home(tmp_path, monkeypatch, capsys):
    metarouter_home = tmp_path / "metarouter-home"
    project = tmp_path / "project"
    project.mkdir()
    text_file = project / "notes.txt"
    json_file = project / "data.json"
    text_file.write_text("alpha needle omega\n", encoding="utf-8")
    json_file.write_text('{"item": {"value": 1}}\n', encoding="utf-8")

    legacy_cache = tmp_path / "os-home" / ".cache" / "metarouter"
    monkeypatch.setattr(hook, "CACHE", legacy_cache / "img")
    monkeypatch.setenv("METAROUTER_HOME", str(metarouter_home))
    for name in (
        "AI_AGENT",
        "CLAUDECODE",
        "METAROUTER_OUTPUT",
        "CLAUDE_CODE_SESSION_ID",
        "METAROUTER_SHELL",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(project)

    expected_project_paths = {Path("data.json"), Path("notes.txt")}
    baseline_paths = _paths_under(tmp_path)

    def invoke_and_check(lane, *args):
        result = _invoke(capsys, *args)
        _assert_writes_are_confined(
            lane,
            tmp_path,
            baseline_paths,
            project,
            expected_project_paths,
            metarouter_home,
            legacy_cache,
        )
        return result

    invoke_and_check("exec", "exec", "--", "printf acceptance")
    invoke_and_check("run find", "run", "find", "needle", ".")
    invoke_and_check("run json", "run", "json", json_file.name, ".item.value")

    invoke_and_check("run replace", "run", "replace", text_file.name, "needle", "found")
    assert text_file.read_text(encoding="utf-8") == "alpha found omega\n"
    invoke_and_check("undo", "undo")
    assert text_file.read_text(encoding="utf-8") == "alpha needle omega\n"

    invoke_and_check("run json-set", "run", "json-set", json_file.name, ".item.value", "2")
    assert json.loads(json_file.read_text(encoding="utf-8"))["item"]["value"] == 2

    invoke_and_check("search", "search", "json")
    invoke_and_check("list", "list")
    invoke_and_check("check", "check")

    home_files = [path for path in metarouter_home.rglob("*") if path.is_file()]
    assert home_files
    assert list(metarouter_home.rglob("*.log"))
    assert (metarouter_home / "calls.jsonl").is_file()
    assert list((metarouter_home / "snapshots").glob("*/manifest.json"))
