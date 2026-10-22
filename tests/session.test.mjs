import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { normalizeSession } from '../public/session.js';
import { exportWorkbook } from '../workbook.mjs';
const input = { model:'laya:421m-typed-decisions-bf16', type:'choice', question:'Which action?', state:'A refund is requested.', options:[{label:'Refund',description:'Return payment'},{label:'Wait',description:'Take no action'}] };
const run = {id:'run-1',createdAt:'2026-10-21T16:00:00.000Z',input,result:{elapsed_ms:12,answers:{decision:{choice:'Refund',probabilities:{Refund:.8,Wait:.2},confidence:.6}},usage:{input_tokens:35}}};
const session = () => ({ format:'laya-conversation',version:1,runs:[structuredClone(run)],draft:{...structuredClone(input),question:'A follow-up question'} });
test('conversation round trip retains decisions, distributions, and unsent draft', () => {
  const restored = normalizeSession(JSON.parse(JSON.stringify(session())));
  assert.equal(restored.runs[0].result.answers.decision.probabilities.Refund,.8);
  assert.equal(restored.draft.question,'A follow-up question');
});
test('previous single-decision JSON exports remain loadable', () => {
  assert.equal(normalizeSession(run).runs[0].id,run.id);
});
test('malformed files, model substitutions, duplicate IDs and invalid distributions are rejected', () => {
  for (const change of [s=>s.version=2,s=>s.draft.model='unrelated',s=>s.runs.push(s.runs[0]),s=>s.runs[0].result.answers.decision.probabilities.Refund=3,s=>s.runs[0].id='bad"]selector']) {
    const data=session(); change(data); assert.throws(()=>normalizeSession(data));
  }
});
test('Excel export has typed numeric probabilities, all decisions, draft, and literal text', async () => {
  const data = session(); data.runs[0].input.question = '=HYPERLINK("https://example.com")';
  const buffer = await exportWorkbook(data), book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  assert.deepEqual(book.worksheets.map(s=>s.name),['Decisions','Probabilities','Current setup']);
  assert.equal(book.getWorksheet('Decisions').getCell('E2').value,data.runs[0].input.question);
  assert.equal(book.getWorksheet('Decisions').getCell('E2').type,ExcelJS.ValueType.String);
  assert.equal(book.getWorksheet('Probabilities').getCell('E2').value,.8);
  assert.equal(book.getWorksheet('Probabilities').getCell('E3').value,.2);
  assert.equal(book.getWorksheet('Current setup').getCell('B4').value,'A follow-up question');
});
