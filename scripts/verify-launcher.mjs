import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import path from 'node:path';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const env={...process.env,PORT:'3340'};
const root=path.resolve('.');
const child=spawn('python',[path.join(root,'run.py')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
const exited=once(child,'exit');
const run=promisify(execFile);
try {
  const deadline=Date.now()+20000;
  while(!output.includes('Laya ready.') && Date.now()<deadline && child.exitCode===null) await new Promise(r=>setTimeout(r,100));
  assert.match(output,/Laya ready\./,output);
  const url=output.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  assert.equal((await (await fetch(`${url}/api/health`)).json()).app,'laya-decision-studio');
  const second=await run('python',[path.join(root,'run.py')],{cwd:root,env,windowsHide:true,timeout:10000});
  assert.match(second.stdout,/already running/);
  const stopped=await run('python',[path.join(root,'run.py'),'--stop'],{cwd:root,env,windowsHide:true,timeout:30000});
  assert.match(stopped.stdout,/Stopped [1-9]\d* Laya/);
  await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Launcher did not exit.')),5000).unref())]);
  await assert.rejects(fetch(`${url}/api/health`,{signal:AbortSignal.timeout(1500)}));
  const repeat=await run('python',[path.join(root,'run.py'),'--stop'],{cwd:root,env,windowsHide:true,timeout:30000});
  assert.match(repeat.stdout,/Stopped 0 Laya/);
  await writeFile('verification/launcher-recovery.json',JSON.stringify({verifiedAt:new Date().toISOString(),realPythonLauncher:true,secondLaunchReused:true,stopResult:stopped.stdout.trim(),serverReleased:true,repeatedStopSafe:true},null,2));
  console.log('Real Python launcher opened Laya, reused the window, stopped all app/launcher processes, and released the port.');
} finally {
  if(child.exitCode===null && child.signalCode===null) await run('python',[path.join(root,'run.py'),'--stop'],{cwd:root,env,windowsHide:true,timeout:30000});
}
