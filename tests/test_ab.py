import json
import subprocess
import sys

from metarouter import ab, cli

FAKE = r'''
import json, os, pathlib, sys
task = sys.stdin.read()
armed = "metarouter:start" in (pathlib.Path("CLAUDE.md").read_text() if pathlib.Path("CLAUDE.md").exists() else "")
if armed:
    pathlib.Path("done.txt").write_text(task)
if os.environ.get("FAKE_CRASH"):
    sys.exit(1)
print(json.dumps({"type": "result", "is_error": False, "num_turns": 3 if armed else 7, "total_cost_usd": 0.01,
                  "usage": {"input_tokens": 100, "output_tokens": 20, "cache_creation_input_tokens": 5,
                            "cache_read_input_tokens": 50}}))
'''


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    for args in (["init", "-q"], ["config", "user.email", "t@t"], ["config", "user.name", "t"]):
        subprocess.run(["git", "-C", str(repo), *args], check=True)
    (repo / "a.txt").write_text("x\n")
    subprocess.run(["git", "-C", str(repo), "add", "a.txt"], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "init"], check=True)
    return repo


def run_ab(tmp_path, monkeypatch, capsys, runs="2"):
    monkeypatch.setenv("METAROUTER_HOME", str(tmp_path / "home"))
    repo = make_repo(tmp_path)
    fake = tmp_path / "fake_agent.py"
    fake.write_text(FAKE)
    seen = tmp_path / "seen.txt"
    check = f'pwd >> "{seen.as_posix()}"; test -f done.txt'
    code = cli.main(["--json", "ab", "--task", "make done.txt", "--check", check, "--repo", str(repo),
                     "--runs", runs, "--agent-cmd", f'"{sys.executable}" "{fake.as_posix()}"'])
    return code, json.loads(capsys.readouterr().out), repo, seen


def worktrees(repo):
    out = subprocess.run(["git", "-C", str(repo), "worktree", "list", "--porcelain"], capture_output=True, text=True)
    return [ln for ln in out.stdout.splitlines() if ln.startswith("worktree ")]


def test_ab_runs_both_arms_checks_each_tree_and_removes_worktrees(tmp_path, monkeypatch, capsys):
    code, r, repo, seen = run_ab(tmp_path, monkeypatch, capsys)
    assert code == 0 and r["ok"]
    a, b = r["out"]["A (metarouter block)"], r["out"]["B (no block, empty home)"]
    assert (a["pass_rate"], b["pass_rate"]) == (1.0, 0.0)
    assert (a["median_turns"], b["median_turns"]) == (3, 7)
    assert a["tokens_per_pass"] == 175 and b["tokens_per_pass"] is None
    assert r["out"]["A minus B"]["pass_rate"] == 1.0
    assert "too few runs to call a difference" in r["note"]
    assert len(set(seen.read_text().split())) == 4
    assert len(worktrees(repo)) == 1
    assert not (repo / "done.txt").exists() and not (repo / "CLAUDE.md").exists()
    assert subprocess.run(["git", "-C", str(repo), "status", "--porcelain"], capture_output=True, text=True).stdout == ""
    reports = list((tmp_path / "home" / "ab").glob("*.json"))
    assert len(reports) == 1 and len(json.loads(reports[0].read_text())["rows"]) == 4


def test_ab_removes_worktrees_when_agent_fails(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FAKE_CRASH", "1")
    code, r, repo, seen = run_ab(tmp_path, monkeypatch, capsys, runs="1")
    assert r["out"]["A (metarouter block)"]["median_turns"] is None
    assert len(worktrees(repo)) == 1


def test_ab_removes_worktree_when_check_cannot_start(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("METAROUTER_SHELL", str(tmp_path / "no-such-shell"))
    code, r, repo, seen = run_ab(tmp_path, monkeypatch, capsys, runs="1")
    assert code == 1 and "crashed" in r["note"]
    assert len(worktrees(repo)) == 1


def test_set_block_replaces_and_strips():
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as d:
        tree = Path(d)
        (tree / "CLAUDE.md").write_text("# mine\n")
        ab.set_block(tree, "CLAUDE.md", True)
        ab.set_block(tree, "CLAUDE.md", True)
        assert (tree / "CLAUDE.md").read_text().count(ab.START) == 1
        ab.set_block(tree, "CLAUDE.md", False)
        assert ab.START not in (tree / "CLAUDE.md").read_text()


def test_parse_codex_events():
    lines = [{"type": "thread.started"}, {"type": "item.completed", "item": {"type": "command_execution"}},
             {"type": "item.completed", "item": {"type": "agent_message"}},
             {"type": "turn.completed", "usage": {"input_tokens": 300, "cached_input_tokens": 200, "output_tokens": 40}}]
    got = ab.parse_codex("\n".join(json.dumps(x) for x in lines))
    assert got == {"turns": 2, "tokens": 340, "cost": None, "error": None}


def test_parse_claude_pretty_printed():
    text = json.dumps({"num_turns": 4, "total_cost_usd": 0.2, "usage": {"input_tokens": 10, "output_tokens": 5}}, indent=2)
    assert ab.parse_claude(text) == {"turns": 4, "tokens": 15, "cost": 0.2, "error": None}
