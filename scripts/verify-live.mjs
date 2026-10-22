import { writeFile, mkdir } from 'node:fs/promises';
const origin = process.env.LAYA_UI_URL || 'http://127.0.0.1:3210';
const models = ['laya:421m-typed-decisions-bf16','laya:421m-english-bf16'];
const report = { verifiedAt: new Date().toISOString(), origin, status: await (await fetch(`${origin}/api/status`)).json(), runs: [] };
for (const model of models) {
  for (const type of ['bool','choice','ranking']) {
    const input = { model, type, state: 'The production payment system has been down for an hour. Customers cannot complete orders. Fix the payment outage immediately.',
      question: type === 'bool' ? 'Is the payment system currently down?' : 'Which action best addresses this incident?',
      trueDescription: 'The payment system is down and customers cannot pay.', falseDescription: 'The payment system is working normally.',
      options: [{label:'Repair',description:'Restore the payment service immediately'},{label:'Advertise',description:'Launch a marketing campaign'},{label:'Ignore',description:'Take no action'}] };
    const response = await fetch(`${origin}/api/decide`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input)});
    const result = await response.json();
    if (!response.ok) throw new Error(`${model} / ${type}: ${JSON.stringify(result)}`);
    const answer = result.answers?.decision;
    if (!answer) throw new Error('Missing decision');
    if (type === 'bool' && !(answer.noul >= 0 && answer.noul <= 1)) throw new Error('Invalid boolean probability');
    if (type !== 'bool') {
      const values = Object.values(answer.probabilities || {});
      if (values.length !== 3 || values.some(p => !Number.isFinite(p) || p < 0 || p > 1) || Math.abs(values.reduce((a,b)=>a+b,0)-1) > .01) throw new Error('Invalid probability distribution');
    }
    report.runs.push({input,result});
    console.log(`${model} / ${type}: ${type === 'bool' ? answer.noul.toFixed(4)+' P(true)' : answer.choice} (${result.elapsed_ms} ms)`);
  }
}
await mkdir('verification',{recursive:true});
await writeFile('verification/live-results.json', JSON.stringify(report,null,2));
console.log(`Verified ${report.runs.length} real decisions. Evidence: verification/live-results.json`);
