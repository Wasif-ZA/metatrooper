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


def load_agents_instructions():
    agents_path = Path.home() / ".codex" / "AGENTS.md"
    if agents_path.is_file():
        return agents_path.read_text(encoding="utf-8").strip()
    return ""


def build_prompt(task_dir, arm):
    task_path = task_dir / "task.md"
    task_content = task_path.read_text(encoding="utf-8").strip()
    if arm == "plain":
        return task_content
    if arm == "metarouter":
        instructions = load_agents_instructions()
        if instructions:
            return f"{instructions}\n\n{task_content}"
        return task_content
    raise ValueError(f"Unknown arm: {arm}")


def arm_env(arm):
    if arm != "plain":
        return None
    real = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    home = Path(tempfile.gettempdir()) / "metarouter-ab-plain-codex-home"
    home.mkdir(exist_ok=True)
    for name in ("auth.json", "config.toml"):
        if (real / name).is_file():
            shutil.copy2(real / name, home / name)
    return {**os.environ, "CODEX_HOME": str(home)}


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


def print_summary_table(rows, arms):
    headers = ["arm", "pass", "median total tokens"]
    table_data = []
    for arm in arms:
        arm_rows = [r for r in rows if r.get("arm") == arm]
        pass_count = sum(1 for r in arm_rows if r.get("pass"))
        total_count = len(arm_rows)
        pass_str = f"{pass_count}/{total_count}"
        totals = []
        for r in arm_rows:
            tot = get_total_tokens(r.get("tokens"))
            if tot is not None:
                totals.append(tot)
        if totals:
            med = statistics.median(totals)
            med_str = f"{med:.0f}" if isinstance(med, float) and med.is_integer() else f"{med}"
        else:
            med_str = "null"
        table_data.append((arm, pass_str, med_str))

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


def run_evaluation(task_names, tasks_dir, arms, out_path):
    codex_path = shutil.which("codex")
    if not codex_path:
        print("Error: codex executable not found", file=sys.stderr)
        return 1

    out_file = Path(out_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)

    results = []
    for task_name in task_names:
        task_dir = tasks_dir / task_name
        for arm in arms:
            temp_dir = Path(tempfile.mkdtemp(prefix=f"bench_{task_name}_{arm}_"))
            passed = False
            try:
                setup_dir = task_dir / "setup"
                if setup_dir.is_dir():
                    shutil.copytree(setup_dir, temp_dir, dirs_exist_ok=True)
                run_setup_script(task_dir, temp_dir)

                prompt = build_prompt(task_dir, arm)
                cmd = [
                    codex_path,
                    "exec",
                    "--skip-git-repo-check",
                    "--json",
                    "--sandbox",
                    "workspace-write",
                    "-C",
                    str(temp_dir),
                    "-",
                ]

                start_time = time.monotonic()
                try:
                    proc = subprocess.run(
                        cmd,
                        input=prompt,
                        env=arm_env(arm),
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                        timeout=600,
                        encoding="utf-8",
                    )
                    elapsed = time.monotonic() - start_time
                    exit_code = proc.returncode
                    stdout_text = proc.stdout or ""
                except subprocess.TimeoutExpired as exc:
                    elapsed = 600.0
                    exit_code = 124
                    raw_out = exc.stdout or ""
                    stdout_text = raw_out.decode("utf-8", errors="replace") if isinstance(raw_out, bytes) else raw_out

                tokens = extract_last_token_usage(stdout_text)
                Path(f"{out_path}.{task_name}.{arm}.jsonl").write_text(stdout_text, encoding="utf-8")

                check_script = task_dir / "check.py"
                check_proc = subprocess.run(
                    [sys.executable, str(check_script)],
                    cwd=str(temp_dir),
                    capture_output=True,
                    text=True,
                )
                passed = (check_proc.returncode == 0)

                row = {
                    "task": task_name,
                    "arm": arm,
                    "pass": passed,
                    "tokens": tokens,
                    "seconds": round(elapsed, 2),
                    "exit": exit_code,
                }
                results.append(row)

                with open(out_file, "a", encoding="utf-8") as f:
                    f.write(json.dumps(row) + "\n")
            finally:
                if passed:
                    shutil.rmtree(temp_dir, ignore_errors=True)
                else:
                    print(f"{task_name}/{arm} failed; kept {temp_dir}", file=sys.stderr)

    print_summary_table(results, arms)
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="A/B evaluation harness for metarouter")
    parser.add_argument("--tasks", default=None, help="Comma-separated list of tasks")
    parser.add_argument("--arms", default="plain,metarouter", help="Comma-separated list of arms")
    parser.add_argument("--dry-run", action="store_true", help="Print prompts and folders without running codex")
    parser.add_argument("--self-test", action="store_true", help="Test checks on unsolved setups")
    parser.add_argument("--out", default=None, help="Output JSONL file path")
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
    return run_evaluation(task_names, tasks_dir, arms, out_path)


if __name__ == "__main__":
    sys.exit(main())
