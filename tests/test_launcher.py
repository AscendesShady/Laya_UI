"""Verify direct startup and the graceful Ctrl+C control pipe."""
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
import run

class LauncherTests(unittest.TestCase):
    def launch(self, argv=(), waits=(0,)):
        with patch.object(run.sys,"platform","win32"), patch.object(run.shutil,"which",return_value="C:\\node.exe"), patch.object(run.subprocess,"Popen") as launch:
            child=launch.return_value
            child.wait.side_effect=list(waits)
            child.poll.return_value=None
            result=run.main(argv)
        return result,launch,child

    def test_launches_node_directly_and_waits_for_exit(self):
        result,launch,_=self.launch(waits=(7,))
        self.assertEqual(result,7)
        launch.assert_called_once_with(["C:\\node.exe",str(Path(run.__file__).resolve().parent/"desktop.mjs")],
            cwd=Path(run.__file__).resolve().parent,stdin=subprocess.PIPE,text=True,creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)

    def test_ctrl_c_requests_save_dialog_and_waits_for_clean_exit(self):
        result,_,child=self.launch(waits=(KeyboardInterrupt(),0))
        self.assertEqual(result,0)
        child.stdin.write.assert_called_once_with("close\n")
        child.stdin.flush.assert_called_once()

    def test_windows_wait_remains_interruptible_after_poll_timeout(self):
        result,_,child=self.launch(waits=(subprocess.TimeoutExpired(["node"],.2),KeyboardInterrupt(),0))
        self.assertEqual(result,0)
        child.stdin.write.assert_called_once_with("close\n")
        self.assertTrue(all(call.kwargs=={"timeout":.2} for call in child.wait.call_args_list))

    def test_second_interrupt_requests_force_exit(self):
        result,_,child=self.launch(waits=(KeyboardInterrupt(),KeyboardInterrupt(),0))
        self.assertEqual(result,0)
        self.assertEqual([call.args[0] for call in child.stdin.write.call_args_list],["close\n","force-close\n"])

    def test_stop_uses_direct_node_command(self):
        result,launch,_=self.launch(("--stop",))
        self.assertEqual(result,0)
        self.assertEqual(launch.call_args.args[0][1],str(Path(run.__file__).resolve().parent/"stop-laya.mjs"))

    def test_missing_node_gives_an_actionable_error(self):
        with patch.object(run.sys,"platform","win32"),patch.object(run.shutil,"which",return_value=None),patch.object(run.subprocess,"Popen") as launch:
            self.assertEqual(run.main(),1)
            launch.assert_not_called()

if __name__ == "__main__":
    unittest.main()
