import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { _electron } from 'playwright-core';
import ExcelJS from 'exceljs';
import { pdfFixture, wordFixture, excelFixture } from './context-fixtures.mjs';

const example = { format:'laya-conversation',version:1,runs:[{id:'fixture-1',createdAt:'2026-10-22T00:00:00.000Z',input:{model:'laya:421m-typed-decisions-bf16',type:'choice',state:'Test-only file persistence example.',question:'Choose a test action',options:[{label:'Refund',description:'Return payment'},{label:'Wait',description:'Take no action'}]},result:{elapsed_ms:5,answers:{decision:{choice:'Refund',probabilities:{Refund:.75,Wait:.25}}}}}],draft:{model:'laya:421m-typed-decisions-bf16',type:'choice',state:'Test-only file persistence example.',question:'An unsent follow-up',options:[{label:'Refund',description:'Return payment'},{label:'Wait',description:'Take no action'}]}};
const closedApps = new WeakSet();
async function start(profile) {
  const env={...process.env,PORT:'3330'}; delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({args:[path.resolve('desktop-main.cjs'),`--profile=${profile}`],env,timeout:30000});
  app.on('close',()=>closedApps.add(app));
  const page=await app.firstWindow(); await page.locator('#tab-home').waitFor();
  return {app,page};
}
async function select(app, response, paths=[]) {
  await app.evaluate(({dialog},{response,paths})=>{
    globalThis.testDialogs=[]; let index=0;
    dialog.showMessageBox=async(_window,options)=>{globalThis.testDialogs.push(options);return {response};};
    dialog.showSaveDialog=async()=>{const filePath=paths[index++];return filePath?{canceled:false,filePath}:{canceled:true};};
  },{response,paths});
}
async function request(app) { await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close()); }
async function exit(app) {
  if(closedApps.has(app))return;
  await select(app,3);
  const closed=app.waitForEvent('close'); await request(app); await closed;
}
async function folder() { await mkdir('verification/native-tests',{recursive:true}); return mkdtemp(path.resolve('verification/native-tests/session-')); }
async function load(page) { await page.locator('#load-file').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(example))}); await page.locator('.run-record').waitFor(); }
async function until(check) { for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,30));} throw new Error('Timed out waiting for native close handler.'); }

test('Cancel retains the conversation; Discard closes and the next launch is empty', {timeout:45000},async t=>{
  const profile=await folder(); let running=await start(profile); t.after(()=>exit(running.app));
  await load(running.page);
  const url=running.page.url();
  assert.equal(await running.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
  assert.equal(await running.app.evaluate(({app})=>app.commandLine.hasSwitch('no-sandbox')),false);
  assert.equal(await running.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox),true);
  await select(running.app,4); await request(running.app);
  await until(async()=>await running.app.evaluate(()=>globalThis.testDialogs.length)>0);
  assert.equal(await running.page.locator('.run-record').count(),1);
  assert.equal(await running.page.locator('#question').inputValue(),'An unsent follow-up');
  const buttons=await running.app.evaluate(()=>globalThis.testDialogs[0].buttons);
  assert.deepEqual(buttons,['Save JSON','Save Excel','Save Both','Discard','Cancel']);
  await exit(running.app);
  await assert.rejects(fetch(`${url}api/health`,{signal:AbortSignal.timeout(1500)}));
  running=await start(profile);
  assert.equal(await running.page.locator('.run-record').count(),0);
  assert.equal(await running.page.locator('#question').inputValue(),'');
});

test('Save Both writes restorable JSON and a real workbook before exiting', {timeout:45000},async t=>{
  const profile=await folder(), running=await start(profile); t.after(()=>exit(running.app)); await load(running.page);
  const json=path.join(profile,'saved.json'),xlsx=path.join(profile,'saved.xlsx');
  await select(running.app,2,[json,xlsx]);
  const closed=running.app.waitForEvent('close'); await request(running.app); await closed;
  const saved=JSON.parse(await readFile(json,'utf8'));
  assert.equal(saved.runs.length,1); assert.equal(saved.draft.question,'An unsent follow-up');
  const book=new ExcelJS.Workbook(); await book.xlsx.readFile(xlsx);
  assert.equal(book.getWorksheet('Probabilities').getCell('E2').value,.75);
  const reopened=await start(profile); t.after(()=>exit(reopened.app));
  assert.equal(await reopened.page.locator('.run-record').count(),0);
  await reopened.page.locator('#load-file').setInputFiles(json); await reopened.page.locator('.run-record').waitFor();
  assert.equal(await reopened.page.locator('#question').inputValue(),'An unsent follow-up');
});

test('Cancelling Save As keeps the window and conversation intact', {timeout:45000},async t=>{
  const running=await start(await folder());t.after(()=>exit(running.app));await load(running.page);
  await select(running.app,0,[]);await request(running.app);
  await until(async()=>await running.app.evaluate(()=>globalThis.testDialogs.length)>0);
  await running.page.waitForTimeout(100);
  assert.equal(await running.page.locator('.run-record').count(),1);
  assert.equal(running.app.process().exitCode,null);
});

for (const [response,extension] of [[0,'json'],[1,'xlsx']]) {
  test(`Save ${extension} alone saves the draft and exits`, {timeout:45000},async t=>{
    const profile=await folder(),running=await start(profile);t.after(()=>exit(running.app));
    await running.page.locator('#question').fill('An unfinished question');
    await running.page.locator('[data-field="label"]').first().fill('Custom option');
    const file=path.join(profile,`draft.${extension}`);
    await select(running.app,response,[file]);
    const closed=running.app.waitForEvent('close');await request(running.app);await closed;
    if(extension==='json') {
      const saved=JSON.parse(await readFile(file,'utf8'));
      assert.equal(saved.runs.length,0);assert.equal(saved.draft.options[0].label,'Custom option');
      assert.equal(saved.draft.question,'An unfinished question');
    } else {
      const book=new ExcelJS.Workbook();await book.xlsx.readFile(file);
      assert.equal(book.getWorksheet('Current setup').getCell('B4').value,'An unfinished question');
      assert.equal(book.getWorksheet('Current setup').getCell('B6').value,'Custom option');
    }
  });
}

test('Cancelling the second Save As leaves the first file and conversation intact', {timeout:45000},async t=>{
  const profile=await folder(),running=await start(profile);t.after(()=>exit(running.app));await load(running.page);
  const json=path.join(profile,'partial.json');await select(running.app,2,[json]);await request(running.app);
  await until(async()=>{try{return !!await readFile(json);}catch{return false;}});
  await running.page.waitForTimeout(100);
  assert.equal(await running.page.locator('.run-record').count(),1);
  assert.equal(JSON.parse(await readFile(json,'utf8')).runs.length,1);
});

test('Failed file writes keep the app open and report the failure', {timeout:45000},async t=>{
  const profile=await folder(),running=await start(profile);t.after(()=>exit(running.app));await load(running.page);
  const missing=path.join(profile,'missing-directory','failed.json');
  await select(running.app,0,[missing]);await request(running.app);
  await until(async()=>await running.app.evaluate(()=>globalThis.testDialogs.some(d=>d.type==='error')));
  assert.equal(await running.page.locator('.run-record').count(),1);
  await assert.rejects(access(missing));
});

test('native window reads PDF, Word, Markdown and Excel through its local parser', {timeout:45000},async t=>{
  const running=await start(await folder());t.after(()=>exit(running.app));
  await running.page.locator('#context-files').setInputFiles([
    {name:'policy.pdf',mimeType:'application/pdf',buffer:pdfFixture()},
    {name:'policy.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:await wordFixture()},
    {name:'notes.md',mimeType:'text/markdown',buffer:Buffer.from('A customer requests a refund.')},
    {name:'rules.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:excelFixture()},
  ]);
  await running.page.locator('#apply-context-files:not([disabled])').waitFor({timeout:30000});
  assert.match(await running.page.locator('#context-file-status').textContent(),/4 of 4/);
  await running.page.locator('#apply-context-files').click();
  const text=await running.page.locator('#context').inputValue();
  assert.match(text,/\[Page 1\]/);assert.match(text,/বাংলা/);assert.match(text,/\[Sheet: Rules\]/);
});

test('closing after real inference releases the model and a fresh launch starts its server', {timeout:45000},async t=>{
  const profile=await folder();let running=await start(profile);t.after(()=>exit(running.app));
  const url=running.page.url();
  const response=await fetch(`${url}api/decide`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(example.runs[0].input)});
  assert.equal(response.status,200);await response.json();
  const loaded=await (await fetch('http://127.0.0.1:11434/api/ps')).json();
  assert.ok(loaded.models.some(model=>model.name===example.draft.model));
  await exit(running.app);
  await assert.rejects(fetch(`${url}api/health`,{signal:AbortSignal.timeout(1500)}));
  const after=await (await fetch('http://127.0.0.1:11434/api/ps')).json();
  assert.ok(!after.models.some(model=>model.name===example.draft.model));
  running=await start(profile);
  assert.equal((await fetch(`${running.page.url()}api/health`)).status,200);
});
