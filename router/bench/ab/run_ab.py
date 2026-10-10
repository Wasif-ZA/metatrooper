import argparse
import json
import os
from pathlib import Path
import shutil
import statistics
import subprocess
import sys
import tempfile
import time


README_BLOCK = """## Tools
Run shell commands through metarouter.
- Look for a saved recipe first: `metarouter search <words>`, then `metarouter run <recipe> ...`.
- Anything else: `metarouter exec -- "<command>"`. Read the short result; it names the full log.
- A command that worked and will be needed again: `metarouter add <name> -- '<command, {1} for arguments>'`.
- If metarouter is missing or errors, run the plain command."""


def build_prompt(task_dir, arm):
    task_content = (task_dir / "task.md").read_text(encoding="utf-8").strip()
    if arm == "plain":
        return task_content
    if arm in ("metarouter", "metarouter-memory"):
        return f"{README_BLOCK}\n\n{task_content}"
    raise ValueError(f"Unknown arm: {arm}")


def arm_env(arm, run_dir):
    """Both arms get a Codex home with only auth and config, so no personal AGENTS.md leaks in.
    The metarouter arm also gets an empty METAROUTER_HOME: a fresh install, no learned recipes."""
    real = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    home = run_dir / "codex-home"
    home.mkdir(parents=True, exist_ok=True)
    for name in ("auth.json", "config.toml"):
        if (real / name).is_file():
            shutil.copy2(real / name, home / name)
    env = {**os.environ, "CODEX_HOME": str(home)}
    if arm != "plain":
        (run_dir / "metarouter-home").mkdir(exist_ok=True)
        env["METAROUTER_HOME"] = str(run_dir / "metarouter-home")
    return env


def find_token_usage(node):
    found = {}

    def walk(curr):
        if isinstance(curr, dict):
            for k, v in curr.items():
                if k in ("input_tokens", "output_tokens", "total_tokens"):
                    if isinstance(v, (int, float)):
                        found[k] = int(v)
                walk(v)
        elif isinstance(curr, list):
            for item in curr:
                walk(item)

    walk(node)
    return found if found else None


def extract_last_token_usage(stdout_text):
    last_tokens = None
    for line in stdout_text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except Exception:
            continue
        tokens = find_token_usage(event)
        if tokens is not None:
            last_tokens = tokens
    return last_tokens


def last_error(stdout_text):
    error = None
    for line in stdout_text.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if event.get("type") == "turn.failed":
            error = (event.get("error") or {}).get("message")
    return error


def get_total_tokens(tokens):
    if not tokens:
        return None
    if isinstance(tokens, dict):
        if "total_tokens" in tokens:
            return tokens["total_tokens"]
        inp = tokens.get("input_tokens")
        out = tokens.get("output_tokens")
        if inp is not None or out is not None:
            return (inp or 0) + (out or 0)
    elif isinstance(tokens, (int, float)):
        return int(tokens)
    return None


def token_part(tokens, key):
    return tokens.get(key) or 0 if isinstance(tokens, dict) else 0


def print_summary_table(rows, arms):
    headers = ["arm", "pass", "median total tokens", "tokens per pass", "uncached in", "cached in", "out"]
    table_data = []
    for arm in arms:
        arm_rows = [r for r in rows if r.get("arm") == arm]
        pass_count = sum(1 for r in arm_rows if r.get("pass"))
        pass_str = f"{pass_count}/{len(arm_rows)}"
        totals = [t for t in (get_total_tokens(r.get("tokens")) for r in arm_rows) if t is not None]
        med_str = f"{statistics.median(totals):.0f}" if totals else "null"
        per_pass = f"{sum(totals) / pass_count:.0f}" if pass_count and totals else "null"
        cached = sum(token_part(r.get("tokens"), "cached_input_tokens") for r in arm_rows)
        uncached = sum(token_part(r.get("tokens"), "input_tokens") for r in arm_rows) - cached
        out = sum(token_part(r.get("tokens"), "output_tokens") for r in arm_rows)
        table_data.append((arm, pass_str, med_str, per_pass, str(uncached), str(cached), str(out)))

    col_widths = [len(h) for h in headers]
    for row in table_data:
        for i, val in enumerate(row):
            col_widths[i] = max(col_widths[i], len(str(val)))

    header_line = "  ".join(f"{h:<{col_widths[i]}}" for i, h in enumerate(headers))
    separator = "  ".join("-" * col_widths[i] for i in range(len(headers)))
    print()
    print(header_line)
    print(separator)
    for row in table_data:
        print("  ".join(f"{str(val):<{col_widths[i]}}" for i, val in enumerate(row)))


def run_setup_script(task_dir, temp_dir):
    script = temp_dir / "setup.py"
    if not script.is_file():
        script = task_dir / "setup.py"
    if script.is_file():
        subprocess.run(
            [sys.executable, str(script)],
            cwd=str(temp_dir),
            capture_output=True,
            check=True,
        )


def run_self_test(task_names, tasks_dir):
    all_ok = True
    for task_name in task_names:
        task_dir = tasks_dir / task_name
        temp_dir = Path(tempfile.mkdtemp(prefix=f"selftest_{task_name}_"))
        try:
            setup_dir = task_dir / "setup"
            if setup_dir.is_dir():
                shutil.copytree(setup_dir, temp_dir, dirs_exist_ok=True)
            run_setup_script(task_dir, temp_dir)
            check_script = task_dir / "check.py"
            proc = subprocess.run(
                [sys.executable, str(check_script)],
                cwd=str(temp_dir),
                capture_output=True,
                text=True,
            )
            if proc.returncode != 0:
                print(f"{task_name}: PASS (unsolved check failed as expected, exit {proc.returncode})")
            else:
                print(f"{task_name}: FAIL (unsolved check unexpectedly passed, exit 0)")
                all_ok = False
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
    return 0 if all_ok else 1


def run_dry_run(task_names, tasks_dir, arms):
    for task_name in task_names:
        task_dir = tasks_dir / task_name
        for arm in arms:
            prompt = build_prompt(task_dir, arm)
            print(f"Task: {task_name}")
            print(f"Arm: {arm}")
            print(f"Folder: {task_dir / 'setup'}")
            print("Prompt:")
            print(prompt)
            print("-" * 40)
    return 0


def codex_session(codex_path, prompt, work, env, extra_dir):
    """Run one codex exec in `work`. Return (stdout, exit code, seconds)."""
    cmd = [codex_path, "exec", "--skip-git-repo-check", "--json", "--sandbox", "workspace-write",
           "-c", 'windows.sandbox="unelevated"', "-C", str(work),
           *(["--add-dir", str(extra_dir)] if extra_dir else []), "-"]
    start_time = time.monotonic()
    try:
        proc = subprocess.run(cmd, input=prompt, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, timeout=600, encoding="utf-8")
        return proc.stdout or "", proc.returncode, time.monotonic() - start_time
    except subprocess.TimeoutExpired as exc:
        raw_out = exc.stdout or ""
        return (raw_out.decode("utf-8", errors="replace") if isinstance(raw_out, bytes) else raw_out), 124, 600.0


def fresh_work(task_dir, work):
    work.mkdir()
    if (task_dir / "setup").is_dir():
        shutil.copytree(task_dir / "setup", work, dirs_exist_ok=True)
    run_setup_script(task_dir, work)


def run_evaluation(task_names, tasks_dir, arms, out_path, repeats=1):
    """Arms: plain, metarouter (fresh install), metarouter-memory (session 2 after a session 1
    on the same task with the same metarouter home, so recipes saved in session 1 can be reused)."""
    codex_path = shutil.which("codex")
    if not codex_path:
        print("Error: codex executable not found", file=sys.stderr)
        return 1

    out_file = Path(out_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)

    results = []
    runs = [(t, a, n) for n in range(1, repeats + 1) for t in task_names for a in arms]
    for task_name, arm, n in runs:
        task_dir = tasks_dir / task_name
        run_dir = Path(tempfile.mkdtemp(prefix=f"bench_{task_name}_{arm}_{n}_"))
        work = run_dir / "work"
        passed = False
        try:
            prompt = build_prompt(task_dir, arm)
            env = arm_env(arm, run_dir)
            extra = run_dir / "metarouter-home" if arm != "plain" else None
            row = {"task": task_name, "arm": arm, "run": n}
            if arm == "metarouter-memory":
                fresh_work(task_dir, run_dir / "warmup")
                warm_out, _, _ = codex_session(codex_path, prompt, run_dir / "warmup", env, extra)
                row["warmup_tokens"] = extract_last_token_usage(warm_out)
            fresh_work(task_dir, work)
            stdout_text, exit_code, elapsed = codex_session(codex_path, prompt, work, env, extra)
            Path(f"{out_path}.{task_name}.{arm}.{n}.jsonl").write_text(stdout_text, encoding="utf-8")
            check_proc = subprocess.run([sys.executable, str(task_dir / "check.py")], cwd=str(work),
                                        capture_output=True, text=True)
            passed = check_proc.returncode == 0
            row.update({"pass": passed, "tokens": extract_last_token_usage(stdout_text),
                        "seconds": round(elapsed, 2), "exit": exit_code})
            error = last_error(stdout_text)
            if error:
                row["error"] = error
            results.append(row)
            with open(out_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(row) + "\n")
        finally:
            shutil.rmtree(run_dir / "codex-home", ignore_errors=True)
            if passed:
                shutil.rmtree(run_dir, ignore_errors=True)
            else:
                print(f"{task_name}/{arm}/{n} failed; kept {run_dir}", file=sys.stderr)

    print_summary_table(results, arms)
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="A/B evaluation harness for metarouter")
    parser.add_argument("--tasks", default=None, help="Comma-separated list of tasks")
    parser.add_argument("--arms", default="plain,metarouter,metarouter-memory", help="Comma-separated list of arms")
    parser.add_argument("--dry-run", action="store_true", help="Print prompts and folders without running codex")
    parser.add_argument("--self-test", action="store_true", help="Test checks on unsolved setups")
    parser.add_argument("--out", default=None, help="Output JSONL file path")
    parser.add_argument("--repeats", type=int, default=3, help="Runs per task and arm")
    args = parser.parse_args(argv)

    bench_ab_dir = Path(__file__).resolve().parent
    tasks_dir = bench_ab_dir / "tasks"
    default_tasks = [
        "find-config",
        "fix-json",
        "failing-test",
        "log-needle",
        "rename-symbol",
        "summarise-diff",
    ]

    if args.tasks:
        task_names = [t.strip() for t in args.tasks.split(",") if t.strip()]
    else:
        task_names = [t for t in default_tasks if (tasks_dir / t).is_dir()]

    arms = [a.strip() for a in args.arms.split(",") if a.strip()]

    if args.self_test:
        return run_self_test(task_names, tasks_dir)

    if args.dry_run:
        return run_dry_run(task_names, tasks_dir, arms)

    out_path = args.out if args.out else str(bench_ab_dir / "results.jsonl")
    return run_evaluation(task_names, tasks_dir, arms, out_path, args.repeats)


if __name__ == "__main__":
    sys.exit(main())
