import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import { writeFile, mkdir, mkdtemp } from 'node:fs/promises';

const root=path.resolve('.');
await mkdir('verification/native-tests',{recursive:true});
const profile=await mkdtemp(path.join(root,'verification/native-tests/launcher-'));
const env={...process.env,PORT:'3340',LAYA_PROFILE:profile};
const run=promisify(execFile);
// Inject Python SIGINTs while real subprocesses run. The first opens the native
// save dialog; the second exercises force-close without UI automation hooks.
const harness=String.raw`
import os,sys,time,json,threading,_thread,urllib.request,subprocess
import run
base='http://127.0.0.1:'+os.environ['PORT']
errors=[]
def get(url):
    return json.load(urllib.request.urlopen(url,timeout=5))
def exercise():
    try:
        for attempt in range(200):
            try:
                assert get(base+'/api/health')['app']=='laya-decision-studio'
                break
            except Exception: time.sleep(.1)
        else: raise AssertionError('UI server did not start')
        data={'model':'laya:421m-typed-decisions-bf16','type':'bool','state':'The customer requests a refund for a duplicate payment.','question':'Does the customer request a refund?','trueDescription':'A refund is requested.','falseDescription':'No refund is requested.','options':[]}
        request=urllib.request.Request(base+'/api/decide',data=json.dumps(data).encode(),headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=20) as response: assert 'decision' in json.load(response)['answers']
        assert any(m['name']==data['model'] for m in get('http://127.0.0.1:11434/api/ps')['models'])
        second=subprocess.run([sys.executable,'run.py'],capture_output=True,text=True,timeout=10)
        assert second.returncode==0 and 'already running' in second.stdout
        _thread.interrupt_main()
        time.sleep(1)
        assert get(base+'/api/health')['app']=='laya-decision-studio'
    except Exception as error: errors.append(str(error))
    finally: _thread.interrupt_main()
worker=threading.Thread(target=exercise,daemon=True)
worker.start()
result=run.main()
worker.join(timeout=2)
assert not errors,errors
assert result==0,result
`;
for(let cycle=0;cycle<2;cycle++) {
  const result=await run(process.env.LAYA_PYTHON||'python',['-u','-c',harness],{cwd:root,env,windowsHide:true,timeout:45000});
  assert.match(result.stdout,/Close Laya using the save dialog/);
  assert.match(result.stdout,/Unloaded laya:421m-typed-decisions-bf16/);
  assert.match(result.stdout,/Laya closed\. UI server stopped/);
  assert.doesNotMatch(result.stdout+result.stderr,/Terminate batch job/);
  await assert.rejects(fetch('http://127.0.0.1:3340/api/health',{signal:AbortSignal.timeout(1500)}));
  const models=await (await fetch('http://127.0.0.1:11434/api/ps')).json();
  assert.ok(!models.models.some(model=>model.name==='laya:421m-typed-decisions-bf16'));
}
await writeFile('verification/launcher-recovery.json',JSON.stringify({verifiedAt:new Date().toISOString(),realPythonLauncher:true,secondLaunchReused:true,interruptControlVerified:true,modelUnloaded:true,serverReleased:true,startStopCycles:2},null,2));
console.log('Two real Python start/interrupt/exit cycles passed. Server released, Laya unloaded, no CMD batch prompt.');
