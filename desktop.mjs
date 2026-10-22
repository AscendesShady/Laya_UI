import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
try {
  const { default: executable } = await import('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [path.join(root, 'desktop-main.cjs')], {cwd: root, env, stdio: 'inherit', windowsHide: true});
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(`Laya could not start: ${error.message}\nRun npm.cmd install if dependencies are missing.`);
  process.exitCode = 1;
}
