"""Verify that Python starts the managed window and waits for it to exit."""
from pathlib import Path
import unittest
from unittest.mock import patch
import run

class LauncherTests(unittest.TestCase):
    def test_launches_managed_command_and_propagates_exit_code(self):
        with patch.object(run.sys,"platform","win32"), patch.object(run.subprocess,"call",return_value=0) as launch:
            self.assertEqual(run.main(),0)
        launch.assert_called_once_with(["cmd.exe","/d","/c",".\\Start-Laya.cmd"],cwd=Path(run.__file__).resolve().parent)

    def test_ctrl_c_exits_cleanly(self):
        with patch.object(run.sys,"platform","win32"), patch.object(run.subprocess,"call",side_effect=KeyboardInterrupt):
            self.assertEqual(run.main(),130)

    def test_stop_uses_only_the_project_stop_command(self):
        with patch.object(run.sys,"platform","win32"), patch.object(run.subprocess,"call",return_value=0) as launch:
            self.assertEqual(run.main(["--stop"]),0)
        launch.assert_called_once_with(["cmd.exe","/d","/c",".\\Stop-Laya.cmd"],cwd=Path(run.__file__).resolve().parent)

if __name__ == "__main__":
    unittest.main()
