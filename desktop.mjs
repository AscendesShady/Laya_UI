import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
try {
  const { default: executable } = await import('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [path.join(root, 'desktop-main.cjs')], {
    cwd:root,env,stdio:['ignore','inherit','inherit','ipc'],windowsHide:true,
  });
  let pending='',interrupts=0;
  const close=force=>{
    if(child.connected)child.send({type:force?'laya-force-close':'laya-close'},()=>{});
  };
  const interrupt=()=>close(++interrupts>1);
  for(const signal of ['SIGINT','SIGTERM',...(process.platform==='win32'?['SIGBREAK']:[])])process.on(signal,interrupt);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data',chunk=>{
    pending+=chunk;const lines=pending.split(/\r?\n/);pending=lines.pop();
    for(const line of lines){if(line==='close')close(false);else if(line==='force-close')close(true);}
  });
  const finish=()=>{process.stdin.pause();process.stdin.destroy();};
  child.once('error',error=>{console.error(error.message);process.exitCode=1;finish();});
  child.once('exit',code=>{process.exitCode=code??1;finish();});
} catch (error) {
  console.error(`Laya could not start: ${error.message}\nRun npm.cmd install if dependencies are missing.`);
  process.exitCode = 1;
}
