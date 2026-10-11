from pathlib import Path


def main():
    lines = [f"[2026-10-02 12:00:{i % 60:02d}] worker-{i % 4}: status ok\n" for i in range(1, 5001)]
    lines[3481] = "2026-10-02 14:22:18.104 [worker-4] ERROR db: connection refused\n"
    Path("app.log").write_text("".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
