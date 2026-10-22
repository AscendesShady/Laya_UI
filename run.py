"""Run the Laya app window. Closing that window stops its UI server."""

from pathlib import Path
import argparse
import subprocess
import sys


def main(argv=()) -> int:
    parser = argparse.ArgumentParser(description="Start Laya or stop its processes.")
    parser.add_argument("--stop", action="store_true", help="Force-stop this Laya app and its launcher; unsaved work is discarded.")
    args = parser.parse_args(argv)
    project_dir = Path(__file__).resolve().parent
    if sys.platform != "win32":
        print("This launcher requires Windows. Use node desktop.mjs on other platforms.", file=sys.stderr)
        return 1
    command = "Stop-Laya.cmd" if args.stop else "Start-Laya.cmd"
    if not (project_dir / command).is_file():
        print(f"{command} is missing from the project folder.", file=sys.stderr)
        return 1
    try:
        return subprocess.call(["cmd.exe", "/d", "/c", f".\\{command}"], cwd=project_dir)
    except KeyboardInterrupt:
        return 130
    except OSError as error:
        print(f"Could not launch Laya: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
