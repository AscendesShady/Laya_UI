"""Run the Laya app window. Closing that window stops its UI server."""

from pathlib import Path
import argparse
import subprocess
import sys
import shutil


def main(argv=()) -> int:
    parser = argparse.ArgumentParser(description="Start Laya or stop its processes.")
    parser.add_argument("--stop", action="store_true", help="Force-stop this Laya app and its launcher; unsaved work is discarded.")
    args = parser.parse_args(argv)
    project_dir = Path(__file__).resolve().parent
    if sys.platform != "win32":
        print("This launcher requires Windows. Use node desktop.mjs on other platforms.", file=sys.stderr)
        return 1
    script = project_dir / ("stop-laya.mjs" if args.stop else "desktop.mjs")
    if not script.is_file():
        print(f"{script.name} is missing from the project folder.", file=sys.stderr)
        return 1
    node = shutil.which("node")
    if not node:
        print("Node.js 22.3 or newer is required. Install it, then run Laya again.", file=sys.stderr)
        return 1
    try:
        # Isolate the child console group so Ctrl+C reaches this launcher once,
        # then ask the app to close through a pipe, preserving its save dialog.
        child = subprocess.Popen([node, str(script)], cwd=project_dir,
                                 stdin=subprocess.PIPE, text=True,
                                 creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
        interrupts = 0
        while True:
            try:
                return child.wait(timeout=0.2)
            except subprocess.TimeoutExpired:
                continue
            except KeyboardInterrupt:
                interrupts += 1
                command = "close" if interrupts == 1 else "force-close"
                print("Close Laya using the save dialog." if interrupts == 1 else "Stopping Laya and discarding unsaved work.", flush=True)
                if child.poll() is None and child.stdin:
                    try:
                        child.stdin.write(command + "\n")
                        child.stdin.flush()
                    except (BrokenPipeError, OSError):
                        pass
    except OSError as error:
        print(f"Could not launch Laya: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
