import { test, expect } from '@playwright/test';
import { pdfFixture, wordFixture, excelFixture } from '../context-fixtures.mjs';

const upload=async(page,files)=>{
  await page.locator('#context-files').setInputFiles(files);
  await expect(page.locator('#context-files-dialog')).toBeVisible();
  await expect(page.locator('#context-file-status')).not.toHaveText(/^Reading/,{timeout:30000});
};
test.beforeEach(async({page})=>{await page.goto('/');});

test('PDF, Word, Markdown and Excel review preserves existing context, then sends imported text to Laya',async({page})=>{
  await page.locator('#context').fill('Existing case: the product is unopened.');
  await page.locator('#question').fill('Does the policy allow a refund within 30 days?');
  await page.locator('[data-type="bool"]').click();
  const files=[
    {name:'policy.pdf',mimeType:'application/pdf',buffer:pdfFixture()},
    {name:'policy.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:await wordFixture()},
    {name:'notes.md',mimeType:'text/markdown',buffer:Buffer.from('# Additional facts\nThe purchase was 12 days ago.')},
    {name:'rules.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:excelFixture()},
  ];
  await upload(page,files);
  await expect(page.locator('#context')).toHaveValue('Existing case: the product is unopened.');
  await expect(page.locator('#context-preview')).toHaveValue(/\[Page 1\]/);
  await expect(page.locator('#context-preview')).toHaveValue(/বাংলা/);
  await expect(page.locator('#context-preview')).toHaveValue(/\[Sheet: Rules\]/);
  await page.screenshot({path:'verification/context-files-review.png',fullPage:true});
  await page.locator('#apply-context-files').click();
  await expect(page.locator('#context')).toHaveValue(/^Existing case: the product is unopened\./);
  const text=await page.locator('#context').inputValue();
  for(const file of files)expect(text).toContain(`[Source: ${file.name}]`);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/decide'));
  await page.locator('#run').click();const result=await response;
  expect(result.status()).toBe(200);expect((await result.json()).request.state).toBe(text);
  await expect(page.locator('.probability-row')).toHaveCount(2);
  const saved=await page.evaluate(()=>window.layaSessionData());
  expect(saved.draft.state).toBe(text);expect(saved.runs[0].input.state).toBe(text);
});

test('long previews require explicit trimming and support replacing existing context',async({page})=>{
  await page.locator('#context').fill('Original context');
  await upload(page,[{name:'large.md',mimeType:'text/markdown',buffer:Buffer.from('A'.repeat(25000))}]);
  await expect(page.locator('#apply-context-files')).toBeDisabled();
  await expect(page.locator('#context-preview-count')).toContainText('Trim the preview');
  expect((await page.locator('#context-preview').inputValue()).length).toBeGreaterThan(25000);
  await page.locator('#context-preview').fill('Only the relevant passage.');
  await page.locator('#context-import-mode').selectOption('replace');
  await page.locator('#apply-context-files').click();
  await expect(page.locator('#context')).toHaveValue('Only the relevant passage.');
  await page.reload();await expect(page.locator('#context')).toHaveValue('Only the relevant passage.');
});

test('cancel, unreadable files, literal markup and partial success preserve the draft',async({page})=>{
  await page.locator('#context').fill('Keep this draft.');
  await upload(page,[{name:'notes.md',mimeType:'text/markdown',buffer:Buffer.from('New text')}]);
  await page.locator('#context-files-dialog .close-dialog').last().click();
  await expect(page.locator('#context')).toHaveValue('Keep this draft.');
  await upload(page,[
    {name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('Not a PDF')},
    {name:'notes.md',mimeType:'text/markdown',buffer:Buffer.from('<img src=x onerror=alert(1)>')},
  ]);
  await expect(page.locator('#context-file-status')).toContainText('1 of 2');
  await expect(page.locator('#context-file-list')).toContainText('valid PDF');
  await expect(page.locator('#context-preview')).toHaveValue(/<img src=x/);
  await expect(page.locator('#context-files-dialog img')).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(page.locator('#context')).toHaveValue('Keep this draft.');
});

test('cancelling an active read leaves context intact and permits another import',async({page})=>{
  await page.locator('#context').fill('Keep this draft.');
  await page.route('**/api/context/extract',async route=>{await new Promise(r=>setTimeout(r,600));await route.abort().catch(()=>{});});
  await page.locator('#context-files').setInputFiles({name:'slow.md',mimeType:'text/markdown',buffer:Buffer.from('New text')});
  await expect(page.locator('#context-file-status')).toContainText('Reading');await page.keyboard.press('Escape');
  await page.unroute('**/api/context/extract');
  await upload(page,[{name:'next.md',mimeType:'text/markdown',buffer:Buffer.from('Another read')}]);
  await expect(page.locator('#apply-context-files')).toBeEnabled();
  await expect(page.locator('#context')).toHaveValue('Keep this draft.');
});

test('file import fits a mobile screen',async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await upload(page,[{name:'notes.md',mimeType:'text/markdown',buffer:Buffer.from('A short context passage.')}]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const box=await page.locator('#context-files-dialog').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(375);
  await page.screenshot({path:'verification/context-files-mobile.png',fullPage:true});
  await expect(page.locator('#apply-context-files')).toBeInViewport();
});
