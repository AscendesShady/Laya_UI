import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { buildRequest, createApp, startApp, MODELS } from '../server.mjs';

const base = { model: MODELS[0], type: 'choice', state: 'The customer needs a refund.', question: 'Which team should help?', options: [{ label: 'Billing', description: 'Payments' }, { label: 'Technical', description: '' }] };
async function app(t, mock) {
  const server = createApp({ fetchOllama: mock }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (url, body) => fetch(`${url}/api/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('startup reuses an existing studio and reopens its URL without a duplicate server', async t => {
  const url = await app(t, fetch), opened = [];
  const result = await startApp({ port: Number(new URL(url).port), open: true, openUrl: url => opened.push(url), log: () => {} });
  assert.equal(result.reused, true); assert.equal(result.server, null);
  assert.deepEqual(opened, [url]);
});

test('startup recognizes the earlier studio that has no health endpoint', async t => {
  const old = http.createServer((req,res) => {
    if (req.url === '/api/health') { res.writeHead(404); return res.end(); }
    res.end('<title>Laya — Decision Studio</title><form id="decision-form"></form>');
  });
  old.listen(0,'127.0.0.1'); await once(old,'listening');
  t.after(() => new Promise(resolve => { old.close(resolve); old.closeAllConnections(); }));
  const result = await startApp({port:old.address().port,log:()=>{}});
  assert.equal(result.reused,true);
});

test('an unrelated occupied port stays untouched while startup finds another UI port', async t => {
  const other = http.createServer((req,res)=>res.end('Another application'));
  other.listen(0,'127.0.0.1'); await once(other,'listening');
  t.after(() => new Promise(resolve => { other.close(resolve); other.closeAllConnections(); }));
  const port = other.address().port;
  const result = await startApp({port,log:()=>{}});
  t.after(() => new Promise(resolve => { result.server.close(resolve); result.server.closeAllConnections(); }));
  assert.equal(result.reused,false);
  assert.ok(Number(new URL(result.url).port) > port);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(),'Another application');
  assert.equal((await (await fetch(`${result.url}/api/health`)).json()).app,'laya-decision-studio');
});

test('invalid preferred port gives an actionable error', async () => {
  await assert.rejects(startApp({port:NaN}), /PORT must be/);
});

test('choice and ranking both use the actual choice primitive with all criteria intact', () => {
  for (const type of ['choice','ranking']) {
    const payload = buildRequest({ ...base, type });
    assert.deepEqual(payload.questions.decision, { type: 'choice', instructions: base.question, criteria: { Billing: 'Payments', Technical: null } });
    assert.equal(payload.state, base.state); assert.equal(payload.model, MODELS[0]);
  }
});
test('boolean sends true/false descriptions as noul, never invented labels', () => {
  const p = buildRequest({ ...base, type: 'bool', trueDescription: 'Refund requested', falseDescription: 'No refund requested' });
  assert.equal(p.questions.decision.type, 'noul');
  assert.deepEqual(p.questions.decision.criteria, { true: 'Refund requested', false: 'No refund requested' });
});
test('removed Score mode cannot be submitted for new inference', () => {
  assert.throws(()=>buildRequest({ ...base, type: 'score' }),/Choose Bool, Choice, or Ranking/);
});
test('invalid model, blank inputs, duplicate labels and invalid option counts fail before inference', () => {
  const invalid = [{ model: 'deepseek-r1:8b' }, { state: ' ' }, { question: '' }, { type: 'chat' }, { options: [] }, { options: Array(27).fill(base.options[0]) }, { options: [{label:'A'}, {label:' a '}] }, { type: 'bool', trueDescription: '', falseDescription: 'no' }];
  for (const change of invalid) assert.throws(() => buildRequest({ ...base, ...change }));
});
test('status limits model list to the exact two checkpoints', async t => {
  const url = await app(t, async () => Response.json({ models: [{name:MODELS[0]}, {name:'unrelated'}] }));
  const data = await (await fetch(`${url}/api/status`)).json();
  assert.deepEqual(data.models, [{ name:MODELS[0], available:true }, { name:MODELS[1], available:false }]);
});
test('offline Ollama returns a useful connection state', async t => {
  const url = await app(t, async () => { throw new Error('fetch failed'); });
  const data = await (await fetch(`${url}/api/status`)).json();
  assert.equal(data.online, false); assert.match(data.error, /Start Ollama/);
});
test('proxy calls /v1/systemone and preserves probabilities and request metadata', async t => {
  let called;
  const url = await app(t, async (target, config) => {
    called = { target, payload: JSON.parse(config.body) };
    return Response.json({ model: MODELS[0], answers: { decision: { type:'choice', choice:'Billing', probabilities:{Billing:.8, Technical:.2}, confidence:.6 } }, usage:{input_tokens:42} });
  });
  const response = await post(url, base), data = await response.json();
  assert.equal(response.status,200); assert.equal(called.target, 'http://127.0.0.1:11434/v1/systemone');
  assert.deepEqual(called.payload, buildRequest(base)); assert.equal(data.answers.decision.probabilities.Billing,.8);
  assert.ok(data.elapsed_ms >= 0); assert.deepEqual(data.request, called.payload);
});
test('upstream error remains actionable, and malformed responses do not become a decision', async t => {
  let mode = 0;
  const url = await app(t, async () => mode === 0 ? Response.json({error:'model is not loaded'}, {status:500}) : mode === 1 ? new Response('404 page not found', {status:404}) : Response.json({answers:{}}));
  for (const expected of [/model is not loaded/, /0.40/, /no decision/]) {
    const response = await post(url, base); assert.equal(response.status,502); assert.match((await response.json()).error, expected); mode++;
  }
});
test('loopback host and same-origin checks reject cross-site writes', async t => {
  const url = await app(t, async () => { assert.fail('Upstream must not be called'); });
  assert.equal((await fetch(`${url}/api/decide`, {method:'POST', headers:{Origin:'https://evil.example', 'Content-Type':'application/json'}, body:JSON.stringify(base)})).status,403);
  const hostStatus = await new Promise((resolve,reject) => {
    const req = http.get(`${url}/api/status`, { headers: { Host:'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error',reject);
  });
  assert.equal(hostStatus,403);
  assert.equal((await post(url, {...base, model:'other'})).status,400);
});
test('static routes serve locally; path traversal and arbitrary files are rejected', async t => {
  const url = await app(t, fetch);
  assert.match(await (await fetch(url)).text(), /Laya — Decision Studio/);
  for (const route of ['/server.mjs', '/package.json', '/..%2Fserver.mjs']) assert.equal((await fetch(url+route)).status,404);
});
test('UTF-8 context survives the local JSON proxy', async t => {
  const state = 'Customer name: বাংলা — café 🚆';
  const url = await app(t, async (_,config) => { assert.equal(JSON.parse(config.body).state,state); return Response.json({answers:{decision:{type:'noul',noul:.7}}}); });
  assert.equal((await post(url,{...base,state})).status,200);
});
