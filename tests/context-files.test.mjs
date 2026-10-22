import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { extractContextFile, contextFilename, MAX_FILE_BYTES } from '../context-files.mjs';
import { pdfFixture, wordFixture, excelFixture } from './context-fixtures.mjs';

test('Markdown preserves Unicode, headings, and literal markup',async()=>{
  const text='# Refund policy\nবাংলা\n<script>literal text</script>';
  assert.equal((await extractContextFile('policy.md',Buffer.from(text))).text,text);
  assert.equal((await extractContextFile('policy.txt',Buffer.concat([Buffer.from([255,254]),Buffer.from('Policy','utf16le')]))).text,'Policy');
});
test('PDF extracts real text and identifies pages; image-only or empty pages require OCR',async()=>{
  const result=await extractContextFile('policy.pdf',pdfFixture());
  assert.match(result.text,/\[Page 1\]/);assert.match(result.text,/refunded within 30 days/);
  await assert.rejects(extractContextFile('scan.pdf',pdfFixture('')),/OCR/);
});
test('Word DOCX extraction retains paragraph text and Unicode',async()=>{
  const result=await extractContextFile('policy.docx',await wordFixture());
  assert.match(result.text,/Refund policy/);assert.match(result.text,/within 30 days/);assert.match(result.text,/বাংলা/);
});
test('Excel XLSX and legacy XLS include every sheet and saved formula values',async()=>{
  for(const type of ['xlsx','xls']) {
    const result=await extractContextFile(`policy.${type}`,excelFixture(type));
    assert.match(result.text,/\[Sheet: Policy\]/);assert.match(result.text,/\[Sheet: Rules\]/);
    assert.match(result.text,/Unopened\t30/);assert.match(result.warnings.join(' '),/not recalculated/);
  }
  const result=await extractContextFile('policy.csv',Buffer.from('Item,Days\n"Refund, unopened",30'));
  assert.match(result.text,/Refund, unopened\t30/);
});
test('unreadable, unsupported, oversized, and excessively long files fail without truncating',async()=>{
  assert.throws(()=>contextFilename('program.exe'),/Choose a PDF/);
  assert.equal(contextFilename('C:\\private\\policy.md'),'policy.md');
  await assert.rejects(extractContextFile('empty.md',Buffer.alloc(0)),/empty/);
  await assert.rejects(extractContextFile('big.pdf',Buffer.alloc(MAX_FILE_BYTES+1)),/10 MB/);
  for(const ext of ['pdf','docx','doc','xlsx'])await assert.rejects(extractContextFile(`broken.${ext}`,Buffer.from('invalid file')),/valid|readable/);
  await assert.rejects(extractContextFile('long.md',Buffer.from('x'.repeat(200001))),/200,000/);
  await assert.rejects(extractContextFile('cancel.md',Buffer.from('text'),{signal:AbortSignal.abort()}),/cancelled/);
  await assert.rejects(extractContextFile('timeout.md',Buffer.from('text'),{timeout:1}),/too long/);
  assert.equal((await extractContextFile('after-timeout.md',Buffer.from('Still available'))).text,'Still available');
});
test('local file endpoint extracts bytes and rejects unsupported files and cross-site requests',async t=>{
  const server=createApp();server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const url=`http://127.0.0.1:${server.address().port}/api/context/extract`;
  const upload=(name,body,extra={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name),...extra},body});
  let response=await upload('policy.md',Buffer.from('# Policy\n30 days'));
  assert.equal(response.status,200);assert.equal((await response.json()).text,'# Policy\n30 days');
  assert.equal((await upload('program.exe',Buffer.from('x'))).status,415);
  assert.equal((await upload('policy.md',Buffer.from('x'),{Origin:'https://example.com'})).status,403);
  assert.equal((await upload('big.md',Buffer.alloc(MAX_FILE_BYTES+1))).status,413);
});
