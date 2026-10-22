import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ page }) => { await page.goto('/'); });
async function loadPreset(page, key) {
  await page.getByRole('tab',{name:/Templates/}).click();
  await page.locator(`#preset-grid [data-preset="${key}"]`).click();
}


test('initial screen, validation, guide, and all use cases', async ({ page }) => {
  const errors = []; page.on('pageerror',e=>errors.push(e.message));
  await expect(page.locator('#connection-text')).toHaveText('Ollama connected');
  await expect(page.locator('#model option')).toHaveCount(2);
  await expect(page.locator('[data-type]')).toHaveText(['Bool','Choice','Ranking']);
  await page.getByRole('button',{name:'Make a decision'}).click();
  await expect(page.locator('#context-error')).toContainText('Add the text');
  await expect(page.locator('#question')).toBeFocused();
  await page.getByRole('tab',{name:'Help',exact:true}).click();
  await expect(page.locator('#panel-help')).toContainText('Ranking');
  await expect(page.locator('#panel-help')).not.toContainText('Score');
  await page.getByRole('tab',{name:/Templates/}).click();
  await expect(page.locator('#preset-grid .preset-card')).toHaveCount(6);
  await page.getByRole('button',{name:/Check a statement/}).click();
  await expect(page.locator('#context')).toHaveValue(/Unopened products/);
  await expect(page.getByRole('button',{name:'Bool',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(errors).toEqual([]);
});

test('real decisions render for each mode on both local Laya models', async ({ page }) => {
  const errors = []; page.on('pageerror',e=>errors.push(e.message));
  for (const model of ['laya:421m-typed-decisions-bf16','laya:421m-english-bf16']) {
    for (const [type,preset] of [['choice','support'],['bool','phishing'],['ranking','priority']]) {
      await page.locator('#model').selectOption(model);
      await page.getByRole('tab',{name:/Templates/}).click();
      await page.locator(`#preset-grid [data-preset="${preset}"]`).click();
      const response = page.waitForResponse(r=>r.url().endsWith('/api/decide'));
      await page.locator('#run').click();
      expect((await response).status()).toBe(200);
      await expect(page.locator('.run-record').last()).toBeVisible();
      await expect(page.locator('.run-record').last().locator('.probability-row')).toHaveCount(type==='bool'?2:4);
      await expect(page.locator('#form-error')).toBeHidden();
      const widths = await page.locator('.run-record').last().locator('[data-probability]').evaluateAll(bars=>bars.map(b=>parseFloat(b.style.width)));
      expect(widths.reduce((a,b)=>a+b,0)).toBeCloseTo(100,1);
    }
  }
  await expect(page.locator('.history-item')).toHaveCount(6);
  expect(errors).toEqual([]);
  await mkdir('verification',{recursive:true});
  // Keep a single genuine result in the desktop screenshot.
  await page.locator('.history-item').first().click();
  await expect(page.locator('#toast')).toBeHidden();
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:'verification/desktop-result.png',fullPage:true,animations:'disabled'});
});

test('editable options, uniqueness validation, and switching decision types', async ({ page }) => {
  await loadPreset(page, 'support');
  await page.getByRole('button',{name:'Add option'}).click();
  await expect(page.locator('.option-row')).toHaveCount(5);
  await page.getByRole('textbox',{name:'Option 5 label',exact:true}).fill('Billing');
  await page.locator('#run').click();
  await expect(page.locator('#form-error')).toContainText('unique');
  await page.getByRole('button',{name:'Remove option 5'}).click();
  await page.getByRole('button',{name:'Bool',exact:true}).click();
  await expect(page.locator('.bool-row')).toHaveCount(2);
  await page.getByRole('button',{name:'Choice',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Option 1 label',exact:true})).toHaveValue('Billing');
  await loadPreset(page,'urgency');
  await expect(page.getByRole('button',{name:'Choice',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await page.locator('[data-field="label"]').evaluateAll(fields=>fields.map(field=>field.value))).toEqual(['Low','Medium','High']);
  await expect(page.locator('[data-move]')).toHaveCount(0);
});

test('Forms-style option entry supports Enter, multiline paste, and actual custom answers', async ({ page }) => {
  await loadPreset(page, 'support');
  await page.getByRole('textbox',{name:'Option 4 label',exact:true}).press('Enter');
  const fifth = page.getByRole('textbox',{name:'Option 5 label',exact:true});
  await expect(fifth).toBeFocused();
  await fifth.fill('Escalate');
  await fifth.press('Enter');
  const sixth = page.getByRole('textbox',{name:'Option 6 label',exact:true});
  await sixth.evaluate(el => {
    const data = new DataTransfer(); data.setData('text/plain','Archive\nInvestigate');
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  });
  await expect(page.locator('.option-row')).toHaveCount(7);
  await expect(page.getByRole('textbox',{name:'Option 7 label',exact:true})).toHaveValue('Investigate');
  const resultWait = page.waitForResponse(r=>r.url().endsWith('/api/decide'));
  await page.locator('#run').click();
  const response = await resultWait;
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(Object.keys(result.request.questions.decision.criteria)).toEqual(['Billing','Technical','Sales','Other','Escalate','Archive','Investigate']);
  await expect(page.locator('.probability-row')).toHaveCount(7);
  await page.getByRole('textbox',{name:'Option 1 label',exact:true}).evaluate(el => {
    const data = new DataTransfer(); data.setData('text/plain',Array.from({length:23},(_,i)=>`Candidate ${i+1}`).join('\n'));
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  });
  await expect(page.locator('#form-error')).toContainText('exceed 26');
  await expect(page.locator('.option-row')).toHaveCount(7);
  await page.getByRole('textbox',{name:'Option 1 label',exact:true}).evaluate(el => {
    const data = new DataTransfer(); data.setData('text/plain',Array.from({length:20},(_,i)=>`Candidate ${i+1}`).join('\n'));
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  });
  await expect(page.locator('.option-row')).toHaveCount(26);
  await expect(page.locator('#add-option')).toBeDisabled();
  await page.getByRole('button',{name:'Bool',exact:true}).click();
  await expect(page.locator('#add-option')).toBeHidden();
  await expect(page.locator('.bool-row')).toHaveCount(2);
});

test('keyboard submit, JSON export, in-window refresh, and reuse', async ({ page }) => {
  await loadPreset(page, 'support');
  await page.locator('#question').focus();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.run-record')).toHaveCount(1);
  await expect(page.locator('#context')).toBeEnabled();
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button',{name:'Export decision as JSON'}).click();
  const download = await downloadWait;
  expect(download.suggestedFilename()).toMatch(/^laya-choice-.*\.json$/);
  const stream = await download.createReadStream(); const chunks=[]; for await (const chunk of stream) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks).toString());
  expect(data.result.answers.decision.probabilities.Billing).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('.history-item')).toHaveCount(1);
  await page.locator('.history-item').click();
  await expect(page.locator('.run-record')).toHaveCount(1);
  await page.getByRole('button',{name:'Reuse this setup'}).click();
  await expect(page.locator('#question')).toHaveValue(data.input.question);

});

test('offline status, inference failure, and cancellation retain user input', async ({ page }) => {
  await page.route('**/api/status',route=>route.fulfill({json:{online:false,models:[],error:'Start Ollama'}}));
  await page.locator('#refresh').click();
  await expect(page.locator('#connection-text')).toHaveText('Ollama offline');
  await loadPreset(page, 'support');
  await page.locator('#run').click();
  await expect(page.locator('#form-error')).toContainText('Ollama is offline');
  await page.unroute('**/api/status'); await page.locator('#refresh').click();
  await expect(page.locator('#connection-text')).toHaveText('Ollama connected');
  await page.route('**/api/decide',route=>route.fulfill({status:502,json:{error:'The selected model could not load.'}}));
  await page.locator('#run').click();
  await expect(page.locator('#form-error')).toContainText('could not load');
  await expect(page.locator('#context')).toHaveValue(/charged twice/);
  await page.unroute('**/api/decide');
  await page.route('**/api/decide',async route=>{
    await new Promise(resolve=>setTimeout(resolve,1000));
    await route.abort().catch(()=>{});
  });
  await page.locator('#run').click();
  await expect(page.locator('#context')).toBeDisabled();
  await page.locator('#cancel').click();
  await expect(page.locator('#context')).toBeEnabled();
  await expect(page.locator('#context')).toHaveValue(/charged twice/);
});

test('untrusted labels and context render as text, and incomplete probabilities fail visibly', async ({ page }) => {
  await loadPreset(page, 'support');
  const malicious = '<img src=x onerror=alert(1)>';
  await page.getByRole('textbox',{name:'Option 1 label',exact:true}).fill(malicious);
  await page.route('**/api/decide',async route => {
    const input=route.request().postDataJSON();
    const probabilities=Object.fromEntries(input.options.map((o,i)=>[o.label,i===0?.7:.1]));
    await route.fulfill({json:{elapsed_ms:5,answers:{decision:{type:'choice',choice:malicious,probabilities}}}});
  });
  await page.locator('#run').click();
  await expect(page.locator('.answer-value')).toHaveText(malicious);
  await expect(page.locator('.run-record img')).toHaveCount(0);
  await page.unroute('**/api/decide');
  await page.route('**/api/decide',route=>route.fulfill({json:{elapsed_ms:4,answers:{decision:{choice:'Billing',probabilities:{Billing:.8}}}}}));
  await page.locator('#run').click();
  await expect(page.locator('#form-error')).toContainText('invalid probability');
  await expect(page.locator('.run-record')).toHaveCount(1);
});

for (const [width,height] of [[375,812],[768,1024],[1024,768],[1440,1080],[812,375]]) {
  test(`responsive layout and reduced motion at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({width,height});
    await page.emulateMedia({reducedMotion:'reduce'});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('#run')).toBeVisible();
    await expect(page.locator('#question')).toBeVisible();
    await loadPreset(page, 'support');
    await page.locator('#run').click();
    await expect(page.locator('.run-record')).toHaveCount(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    if (width === 375) {
      await expect(page.locator('#toast')).toBeHidden();
      await page.screenshot({path:'verification/mobile-result.png',fullPage:true,animations:'disabled'});
    }
    if (width === 1440) {
      await page.locator('#new-decision').click();
      await expect(page.locator('#toast')).toBeHidden();
      await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
      await page.screenshot({path:'verification/desktop-empty.png',fullPage:true,animations:'disabled'});
    }
  });
}
