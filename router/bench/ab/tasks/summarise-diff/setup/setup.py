import subprocess
from pathlib import Path


def main():
    subprocess.run(["git", "init"], check=True)
    subprocess.run(["git", "config", "user.name", "Bench User"], check=True)
    subprocess.run(["git", "config", "user.email", "bench@example.com"], check=True)
    subprocess.run(["git", "add", "."], check=True)
    subprocess.run(["git", "commit", "-m", "Initial commit"], check=True)

    alpha_file = Path("alpha.py")
    beta_file = Path("beta.py")

    alpha_content = alpha_file.read_text(encoding="utf-8") + "\n# updated\n"
    beta_content = beta_file.read_text(encoding="utf-8") + "\n# updated\n"

    alpha_file.write_text(alpha_content, encoding="utf-8")
    beta_file.write_text(beta_content, encoding="utf-8")


if __name__ == "__main__":
    main()
