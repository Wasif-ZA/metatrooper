import json
import os
import sqlite3
from pathlib import Path

import pytest

from metarouter import calls, cli, hints, learn, transcripts
from metarouter import recipes as store

FIX = Path(__file__).parent / "fixtures" / "agents"


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("METAROUTER_HOME", str(tmp_path / "home"))
    for name in ("AI_AGENT", "CLAUDECODE", "METAROUTER_OUTPUT", "CLAUDE_CODE_SESSION_ID"):
        monkeypatch.delenv(name, raising=False)
    roots = {a: tmp_path / "absent" / a for a in transcripts.READERS}
    monkeypatch.setattr(transcripts, "ROOTS", roots)
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.chdir(work)
    return roots


def configure(**cfg):
    home = Path(os.environ["METAROUTER_HOME"])
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.json").write_text(json.dumps(cfg), encoding="utf-8")


def flags(reader, root):
    return [[(c, f) for c, f, _ in s] for s in reader(root) if s]


def invoke(capsys, *args):
    code = cli.main(["--json", *map(str, args)])
    return code, json.loads(capsys.readouterr().out)


def test_claude_reader_reads_bash_and_powershell():
    assert flags(transcripts.claude, FIX / "claude") == [[("doohickey run", False), ("doohickey stop", True)]]


def test_codex_reader_reads_command_events_and_legacy_shell_calls():
    assert flags(transcripts.codex, FIX / "codex") == [
        [("widget build", False), ("widget --bad flag", True)],
        [("gizmo list", False), ("gizmo remove ghost", True)],
    ]
    legacy = [s for s in transcripts.codex(FIX / "codex") if s][1]
    assert legacy[0][2] == "alpha\nbeta"


def test_gemini_reader_reads_antigravity_run_command():
    assert flags(transcripts.gemini, FIX / "gemini") == [
        [("sprocket check", False), ("sprocket spin --fast", True), ("sprocket wipe", True)]]


def opencode_db(root, parts, directory="/work/open"):
    root.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(root / "opencode.db")
    con.execute("create table session (id text primary key, directory text not null)")
    con.execute("create table part (id text primary key, message_id text, session_id text, "
                "time_created integer, time_updated integer, data text)")
    con.execute("insert into session values ('s1', ?)", (directory,))
    for i, data in enumerate(parts):
        con.execute("insert into part values (?, 'm1', 's1', ?, ?, ?)", (f"p{i}", 1000 + i, 1000 + i, json.dumps(data)))
    con.commit()
    con.close()


def bash_part(cmd, status, exit_code, output):
    return {"type": "tool", "tool": "bash", "callID": "c", "state": {
        "status": status, "input": {"command": cmd, "description": "x"}, "output": output,
        "metadata": {"exit": exit_code, "output": output}}}


def test_opencode_reader_reads_bash_tool_parts(tmp_path):
    root = tmp_path / "opencode"
    opencode_db(root, [{"type": "text", "text": "hi"}, bash_part("gadget up", "completed", 0, "up"),
                       bash_part("gadget down", "completed", 4, "fail"), bash_part("gadget x", "error", None, "")])
    assert flags(transcripts.opencode, root) == [[("gadget up", False), ("gadget down", True), ("gadget x", True)]]
    db = root / "opencode.db"
    before = db.read_bytes()
    list(transcripts.opencode(root))
    assert db.read_bytes() == before


def test_opencode_text_only_or_private_gives_nothing(tmp_path):
    opencode_db(tmp_path / "a", [{"type": "text", "text": "hi"}])
    assert flags(transcripts.opencode, tmp_path / "a") == []
    configure(private=["secret-client"])
    opencode_db(tmp_path / "b", [bash_part("gadget up", "completed", 0, "up")], directory="/work/secret-client")
    assert flags(transcripts.opencode, tmp_path / "b") == []


def test_codex_reader_skips_private_sessions(tmp_path):
    configure(private=["secret-client"])
    src = (FIX / "codex" / "2026" / "10" / "08" / "rollout-2026-10-08T11-00-00-legacy.jsonl").read_text(encoding="utf-8")
    (tmp_path / "c").mkdir()
    (tmp_path / "c" / "rollout-x.jsonl").write_text(src.replace("/work/open", "/work/secret-client"), encoding="utf-8")
    assert flags(transcripts.codex, tmp_path / "c") == []


def test_claude_reader_keeps_since_as_epoch_seconds(tmp_path):
    root = tmp_path / "claude"
    root.mkdir()
    f = root / "old.jsonl"
    f.write_text((FIX / "claude" / "proj" / "session.jsonl").read_text(encoding="utf-8"), encoding="utf-8")
    os.utime(f, (1000, 1000))
    assert flags(transcripts.claude, root) and not list(learn.sessions(root, 2000))


def test_learn_from_codex_and_gemini(capsys, isolated):
    isolated["codex"], isolated["gemini"] = FIX / "codex", FIX / "gemini"
    code, r = invoke(capsys, "learn", "--from", "codex,gemini")
    assert code == 0
    assert (r["out"]["transcripts"], r["out"]["shell_calls"]) == (3, 7)
    code, r = invoke(capsys, "learn", "--from", "cursor")
    assert code != 0 and "unknown agent cursor" in r["note"]


def test_learn_defaults_to_every_agent_found(capsys, isolated):
    isolated["codex"], isolated["claude"] = FIX / "codex", FIX / "claude"
    _, r = invoke(capsys, "learn")
    assert (r["out"]["transcripts"], r["out"]["shell_calls"]) == (3, 6)


def test_ingest_from_codex_counts_its_shell_calls(capsys, isolated):
    isolated["codex"] = FIX / "codex"
    assert cli.main(["--json", "ingest", "--from", "codex", "--no-save"]) == 0
    out = json.loads(capsys.readouterr().out)["out"]
    assert out["transcripts"] == 2 and out["shell"]["calls"] == 4


def write_claude(path, cmds):
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for i, (cmd, failed, out) in enumerate(cmds):
        rows.append({"cwd": "/work/open", "message": {"content": [
            {"type": "tool_use", "id": f"u{i}", "name": "Bash", "input": {"command": cmd}}]}})
        rows.append({"cwd": "/work/open", "message": {"content": [
            {"type": "tool_result", "tool_use_id": f"u{i}", "content": out, "is_error": failed}]}})
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")


def fail_then_fix(root):
    pair = [("widget push --retries 3", True, "rejected"), ("widget push --retries 3 --force-with-care", False, "ok")]
    write_claude(root / "a.jsonl", pair * 2)
    write_claude(root / "b.jsonl", pair)


def test_three_fail_then_fix_pairs_give_a_before_hint_that_matches(tmp_path):
    fail_then_fix(tmp_path / "t")
    learn.learn(tmp_path / "t")
    cands = json.loads((learn.cand_dir() / "candidates.json").read_text(encoding="utf-8"))
    before = [c for c in cands if c["type"] == "hint" and c["hint"]["when"] == "before"]
    assert len(before) == 1 and before[0]["count"] == 3 and before[0]["sessions"] == 2
    assert not (Path(os.environ["METAROUTER_HOME"]) / "hints.json").exists()
    learn.save_hint(before[0]["hint"])
    text = hints.match("widget push --retries 9")
    assert text == "this shape failed 3 times; this worked: widget push --retries N --force-with-care"
    assert hints.match("widget push --retries 3 --force-with-care") is None
    assert hints.match("widget status") is None


def test_auto_mode_saves_the_hint_as_learned_and_stats_counts_it(tmp_path, capsys):
    store.set_mode("auto")
    fail_then_fix(tmp_path / "t")
    summary = learn.learn(tmp_path / "t")
    saved = json.loads((Path(os.environ["METAROUTER_HOME"]) / "hints.json").read_text(encoding="utf-8"))
    assert [h["source"] for h in saved] == ["learned"] and saved[0]["id"] in summary["added"]
    assert summary["hint_candidates"] == 0
    calls.append({"time": "2026-10-08T10:00:00+11:00", "project": "p", "agent": "a", "lane": "exec",
                  "shape": "widget push --to origin", "exit": 1, "hinted": True})
    _, r = invoke(capsys, "stats")
    assert r["out"]["hint_sources"]["learned"] == 1 and r["out"]["hint_sources"]["seed"] == len(hints.SEED)
    assert r["out"]["hints"].startswith("1 shown")


def test_one_session_is_not_enough_for_auto_save(tmp_path):
    store.set_mode("auto")
    pair = [("widget push --retries 3", True, "rejected"), ("widget push --retries 3 --force-with-care", False, "ok")]
    write_claude(tmp_path / "t" / "a.jsonl", pair * 3)
    learn.learn(tmp_path / "t")
    assert not (Path(os.environ["METAROUTER_HOME"]) / "hints.json").exists()


def test_adoption_share_and_missed_recipes(capsys, isolated, tmp_path):
    isolated["claude"] = tmp_path / "claude"
    cmds = ['metarouter exec -- "pytest -q"', "cd app && metarouter run json a.json .v", "metarouter list",
            "git status", "git status", "git log -5", "ls", "pytest -q", "widget build"]
    write_claude(tmp_path / "claude" / "p" / "s.jsonl", [(c, False, "") for c in cmds])
    store.save("git-status", "git status")
    a = transcripts.adoption(7)
    assert (a["shell_calls"], a["through_metarouter"], a["share"]) == (9, 3, "33%")
    assert a["missed_recipes"] == [{"shape": "git status", "recipe": "git-status", "count": 2}]
    _, r = invoke(capsys, "stats", "--adoption", "--days", "7")
    assert r["out"]["share"] == "33%"


def test_adoption_counts_inline_python_a_seed_recipe_covers(isolated, tmp_path):
    isolated["claude"] = tmp_path / "claude"
    cmds = ["python -c \"import json; print(json.load(open('a.json'))['v'])\""] * 3
    write_claude(tmp_path / "claude" / "p" / "s.jsonl", [(c, False, "") for c in cmds])
    a = transcripts.adoption(7)
    assert a["missed_recipes"] == [{"shape": "inline python: json read", "recipe": "json", "count": 3}]


def test_codex_reader_skips_a_session_whose_patch_touches_a_private_path(tmp_path):
    configure(private=["secret-client"])
    src = (FIX / "codex" / "2026" / "10" / "08" / "rollout-2026-10-08T11-00-00-legacy.jsonl").read_text(encoding="utf-8")
    patch = {"timestamp": "2026-10-08T00:00:00Z", "type": "response_item",
             "payload": {"type": "function_call", "name": "apply_patch", "call_id": "p1",
                         "arguments": json.dumps({"input": "*** Update File: /work/secret-client/a.py"})}}
    (tmp_path / "c").mkdir()
    (tmp_path / "c" / "rollout-x.jsonl").write_text(src.rstrip("\n") + "\n" + json.dumps(patch) + "\n", encoding="utf-8")
    assert flags(transcripts.codex, tmp_path / "c") == []


def test_gemini_reader_skips_a_session_that_reads_a_private_file(tmp_path):
    configure(private=["secret-client"])
    src = next((FIX / "gemini").rglob("transcript.jsonl"))
    dest = tmp_path / "g" / src.relative_to(FIX / "gemini")
    dest.parent.mkdir(parents=True)
    view = {"type": "PLANNER_RESPONSE", "created_at": "2026-10-08T00:00:00Z",
            "tool_calls": [{"name": "view_file", "args": {"AbsolutePath": "/work/secret-client/notes.md"}}]}
    dest.write_text(json.dumps(view) + "\n" + src.read_text(encoding="utf-8"), encoding="utf-8")
    assert flags(transcripts.gemini, tmp_path / "g") == []
