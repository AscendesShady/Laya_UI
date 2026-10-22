import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';

async function preset(page,key='support') {
  await page.getByRole('tab',{name:/Templates/}).click();
  await page.locator(`[data-preset="${key}"]`).click();
}
async function run(page) {
  const response = page.waitForResponse(r=>r.url().endsWith('/api/decide'));
  await page.locator('#run').click();
  expect((await response).status()).toBe(200);
  await expect(page.locator('#run')).toBeEnabled();
}
async function download(page,button) {
  const pending=page.waitForEvent('download'); await page.locator(button).click();
  const file=await pending, stream=await file.createReadStream(), chunks=[];
  for await(const chunk of stream) chunks.push(chunk);
  return {buffer:Buffer.concat(chunks),filename:file.suggestedFilename()};
}
test.beforeEach(async({page})=>{await page.goto('/');});

test('conventional tabs keep the six templates off Home and support arrow-key navigation',async({page})=>{
  await expect(page.getByRole('tab',{name:'Home',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#panel-home [data-preset]')).toHaveCount(0);
  await expect(page.locator('.starter-section')).toHaveCount(0);
  await page.getByRole('tab',{name:'Home',exact:true}).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#panel-templates')).toBeVisible();
  await expect(page.locator('#preset-grid .preset-card')).toHaveCount(6);
  await page.keyboard.press('ArrowRight'); await expect(page.locator('#panel-help')).toBeVisible();
  await page.keyboard.press('Home'); await expect(page.locator('#panel-home')).toBeVisible();
});

test('JSON saves every turn and current draft, restores them, then continues the conversation',async({page})=>{
  await preset(page); await run(page);
  await page.locator('#question').fill('Does this customer ask for a refund?');
  await page.getByRole('button',{name:'Bool',exact:true}).click(); await run(page);
  await page.locator('#question').fill('An unsent follow-up question');
  const saved=await download(page,'#save-json'), data=JSON.parse(saved.buffer);
  expect(data.format).toBe('laya-conversation'); expect(data.runs).toHaveLength(2);
  expect(data.draft.question).toBe('An unsent follow-up question');
  await page.locator('#new-decision').click();
  await page.locator('#load-file').setInputFiles({name:'conversation.json',mimeType:'application/json',buffer:saved.buffer});
  await expect(page.locator('.run-record')).toHaveCount(2);
  await expect(page.locator('#question')).toHaveValue('An unsent follow-up question');
  await expect(page.getByRole('button',{name:'Bool',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.locator('#question').fill('Does the customer threaten to cancel?'); await run(page);
  await expect(page.locator('.run-record')).toHaveCount(3);
  const continued=JSON.parse((await download(page,'#save-json')).buffer);
  expect(continued.runs).toHaveLength(3); expect(continued.runs[0]).toEqual(data.runs[0]);
  await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('laya-studio-conversation-v1'))?.runs.length)).toBe(3);
  await page.reload(); await expect(page.locator('.run-record')).toHaveCount(3);
  await page.locator('#load-file').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{invalid')});
  await expect(page.locator('#toast')).toContainText('Could not load JSON');
  await expect(page.locator('.run-record')).toHaveCount(3);
  await page.locator('#load-file').setInputFiles({name:'original.json',mimeType:'application/json',buffer:saved.buffer});
  await expect(page.locator('#import-dialog')).toBeVisible();
  await page.locator('#import-dialog .close-dialog').click();
  await expect(page.locator('.run-record')).toHaveCount(3);
});

test('Excel download contains native decision values and every option probability',async({page})=>{
  await preset(page); await run(page);
  const saved=await download(page,'#export-excel'); expect(saved.filename).toMatch(/\.xlsx$/);
  const book=new ExcelJS.Workbook(); await book.xlsx.load(saved.buffer);
  expect(book.worksheets.map(s=>s.name)).toEqual(['Decisions','Probabilities','Current setup']);
  expect(book.getWorksheet('Decisions').rowCount).toBe(2);
  const sheet=book.getWorksheet('Probabilities'); expect(sheet.rowCount).toBe(5);
  expect([2,3,4,5].reduce((sum,row)=>sum+sheet.getCell(`E${row}`).value,0)).toBeCloseTo(1,3);
  expect(book.getWorksheet('Decisions').getCell('L2').value).toContain('charged twice');
});

test('older Score files retain results while their setup continues as Choice',async({page})=>{
  const input={model:'laya:421m-typed-decisions-bf16',type:'score',question:'How urgent is this incident?',state:'Production checkout is down. Customers cannot pay. Restore service immediately.',options:[{label:'Low',description:'Can wait'},{label:'High',description:'Critical outage'}]};
  const old={format:'laya-conversation',version:1,draft:input,runs:[{id:'legacy-score',createdAt:'2026-10-22T00:00:00.000Z',input,result:{elapsed_ms:1,answers:{decision:{type:'score',score:.9,probabilities:{'0':.1,'1':.9}}}}}]};
  await page.locator('#load-file').setInputFiles({name:'older-score.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(old))});
  await expect(page.locator('.run-record')).toHaveCount(1);
  await expect(page.locator('.answer-value')).toContainText('0.90');
  await expect(page.getByRole('button',{name:'Choice',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-type="score"]')).toHaveCount(0);
  const request=page.waitForRequest(r=>r.url().endsWith('/api/decide'));
  await run(page);
  expect((await request).postDataJSON().type).toBe('choice');
  const saved=JSON.parse((await download(page,'#save-json')).buffer);
  expect(saved.runs[0]).toMatchObject(old.runs[0]);
  expect(saved.runs[1].input.type).toBe('choice');
  expect(saved.draft.type).toBe('choice');
});
