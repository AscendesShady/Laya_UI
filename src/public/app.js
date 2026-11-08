/* Local-only UI. Model requests always go through our same-origin server. */
import { normalizeSession, validResult, SESSION_FORMAT, MAX_RUNS } from './session.js';
import { setupContextImport } from './context-import.js';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const STORAGE = 'laya-studio-history-v1';
const DRAFT = 'laya-studio-draft-v1';
const CONVERSATION = 'laya-studio-conversation-v1';
// Score is retained only to display older saved decisions.
const TYPE_LABEL = { bool: 'Bool', choice: 'Choice', ranking: 'Ranking', score: 'Score' };
const hints = {
  bool: 'Evaluate a statement. Get the probability of true and false.',
  choice: 'Pick the best fit from your answer options.',
  ranking: 'Sort alternatives by their relative match to your question.',
};
const defaultOptions = () => [
  { label: 'Billing', description: 'Payments, invoices, refunds' },
  { label: 'Technical', description: 'Bugs, errors, outages' },
  { label: 'Sales', description: 'Pricing, demos, new purchases' },
  { label: 'Other', description: 'Anything outside these teams' },
];
const urgencyOptions = () => [{ label: 'Low', description: 'No deadline or immediate impact' }, { label: 'Medium', description: 'Time sensitive, but not blocking' }, { label: 'High', description: 'Immediate action or critical impact' }];
const PRESETS = {
  support: { title: 'Route a request', description: 'Choose the team best suited to a customer message.', icon: 'mail', color: 'lavender', type: 'choice', question: 'Which team should handle this customer request?', state: 'Hi team, I was charged twice for my monthly subscription. Please refund the duplicate payment today or I will cancel my account.', options: defaultOptions() },
  phishing: { title: 'Spot a red flag', description: 'Check an email for signs of phishing.', icon: 'shield', color: 'peach', type: 'bool', question: 'Is this email a phishing attempt?', state: 'From: security@account-verify.example\nSubject: Account suspension in 1 hour\nYour account has been locked. Click http://verify-login.example now and enter your password and bank card details to restore access.', trueDescription: 'The email attempts to steal sensitive information through impersonation or deceptive links.', falseDescription: 'The email is legitimate and does not attempt to steal information.' },
  urgency: { title: 'Read the urgency', description: 'Choose the urgency of a support request.', icon: 'bolt', color: 'mint', type: 'choice', question: 'How urgent is this support request?', state: 'Our production checkout is down. All customers see an error when paying, and no orders have gone through in the last hour. Please investigate immediately.', options: urgencyOptions() },
  sentiment: { title: 'Understand the tone', description: 'Classify the sentiment of a written review.', icon: 'chat', color: 'lavender', type: 'choice', question: 'What is the overall sentiment of this review?', state: 'The delivery was a day late, but the team was incredibly helpful and the product is even better than I expected. I would happily order again.', options: [{ label: 'Positive', description: 'Mostly satisfied, appreciative or enthusiastic' }, { label: 'Neutral', description: 'Factual, indifferent or evenly balanced' }, { label: 'Negative', description: 'Mostly dissatisfied or critical' }] },
  priority: { title: 'Compare next steps', description: 'Rank possible actions against the same situation.', icon: 'rank', color: 'mint', type: 'ranking', question: 'Which next action best addresses the customer request?', state: 'The customer received a broken item and sent photos of the damage. They want a working replacement, not a refund. The item is in stock and covered by warranty.', options: [{ label: 'Replace', description: 'Arrange a warranty replacement' }, { label: 'Refund', description: 'Return the payment and close the order' }, { label: 'Troubleshoot', description: 'Ask the customer to try repairs first' }, { label: 'Decline', description: 'Reject the request' }] },
  fact: { title: 'Check a statement', description: 'Test whether provided facts support a claim.', icon: 'book', color: 'peach', type: 'bool', question: 'Does the policy allow a full refund in this case?', state: 'Policy: Unopened products may be returned for a full refund within 30 days of delivery. Opened products may only be exchanged.\nCase: A customer received the product 12 days ago and has not opened the packaging.', trueDescription: 'The supplied policy and case meet the conditions for a full refund.', falseDescription: 'The case does not meet the policy conditions for a full refund.' },
};
let type = 'choice', options = defaultOptions(), trueDescription = 'The answer to the question is yes.', falseDescription = 'The answer to the question is no.';
let history = [], visibleRuns = [], currentRun = null, busy = false, controller = null, availability = null, saveEnabled = true;
let toastTimer, draftTimer;
let pendingImport = null;
const emptyOutput = $('#decision-feed').innerHTML;
try {
  for (const key of [STORAGE,DRAFT,CONVERSATION,'laya-studio-save-v1']) localStorage.removeItem(key);
  const stored = JSON.parse(sessionStorage.getItem(STORAGE) || '[]');
  if (Array.isArray(stored)) history = stored.filter(r => r?.id && r.input && r.result?.answers?.decision && TYPE_LABEL[r.input.type]).slice(0, 40);
} catch { /* Storage may be disabled or stale. The live UI still works. */ }

function announce(message) { $('#announcement').textContent = message; }
function toast(message) { const el = $('#toast'); clearTimeout(toastTimer); el.textContent = message; el.hidden = false; toastTimer = setTimeout(() => { el.hidden = true; }, 3500); }
function showError(message) { $('#form-error').textContent = message; $('#form-error').hidden = !message; }
function persistHistory() {
  try { sessionStorage.setItem(STORAGE, JSON.stringify(history)); }
  catch { toast('Browser storage is full or disabled. This result is available until you close the page.'); }
}
function captureInput() {
  return { model: $('#model').value, type, options: structuredClone(options), trueDescription, falseDescription, state: $('#context').value, question: $('#question').value };
}
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistSessionNow, 250);
}
function persistSessionNow() {
  if (!saveEnabled) return;
  try { sessionStorage.setItem(DRAFT, JSON.stringify(captureInput())); } catch { /* Optional persistence. */ }
  try { sessionStorage.setItem(CONVERSATION, JSON.stringify(sessionData())); } catch { /* Manual save remains available. */ }
}
window.addEventListener('pagehide', persistSessionNow);
function renderOptions() {
  const isBool = type === 'bool';
  const list = options;
  $('#option-count').textContent = isBool ? '2' : list.length;
  $('#options-label').firstChild.textContent = 'Answer options ';
  $('#add-option').hidden = isBool;
  $('#add-option').disabled = list.length >= 26;
  $('#options-limit').hidden = isBool;
  $('#add-option-label').textContent = list.length >= 26 ? 'Maximum 26 options reached' : 'Add option';
  $('#options-hint').textContent = isBool ? 'Define both sides of the statement. Labels stay true / false.' : `${list.length > 20 ? 'Keep option sets small for clearer distinctions. ' : ''}Type your own answers. Press Enter to add another, or paste one option per line.`;
  if (isBool) {
    $('#options-list').innerHTML = ['true', 'false'].map((side, i) => `<div class="option-row bool-row"><span class="option-index">${side === 'true' ? 'True' : 'False'}</span><input class="description" data-bool="${side}" value="${escapeHTML(i === 0 ? trueDescription : falseDescription)}" maxlength="300" aria-label="${side === 'true' ? 'True' : 'False'} answer description"></div>`).join('');
  } else {
    $('#options-list').innerHTML = list.map((o, i) => `<div class="option-row"><span class="option-index" aria-hidden="true">${i + 1}</span><input data-index="${i}" data-field="label" value="${escapeHTML(o.label)}" maxlength="100" placeholder="Option ${i + 1}" aria-label="Option ${i + 1} label"><input class="description" data-index="${i}" data-field="description" value="${escapeHTML(o.description)}" maxlength="300" placeholder="Add a description (optional)" aria-label="Option ${i + 1} description"><button type="button" class="icon-button" data-remove="${i}" aria-label="Remove option ${i + 1}" ${list.length <= 2 ? 'disabled' : ''}>${icon('close')}</button></div>`).join('');
  }
}
function setType(next, save = true) {
  type = ['bool','choice','ranking'].includes(next) ? next : 'choice';
  $$('[data-type]').forEach(b => { b.classList.toggle('selected', b.dataset.type === type); b.setAttribute('aria-pressed', String(b.dataset.type === type)); });
  $('#type-hint').textContent = hints[type];
  renderOptions();
  if (save) saveDraft();
}
function updateCount() { $('#context-count').textContent = `${$('#context').value.length.toLocaleString()} characters`; }
function updateModelHint() {
  const english = $('#model').value.includes('english');
  $('#model-hint').textContent = english ? 'English checkpoint · published default context: 512 tokens.' : 'Structured workflows · published default context: 1,024 tokens.';
  if (availability?.online && !availability.models.find(m => m.name === $('#model').value)?.available) $('#model-hint').textContent += ' Not installed in Ollama.';
}
function loadInput(input) {
  if (!TYPE_LABEL[input.type]) return;
  if ($$('#model option').some(o => o.value === input.model)) $('#model').value = input.model;
  if (Array.isArray(input.options) && input.options.length >= 2 && input.options.length <= 26) {
    const list = input.options.map(o => ({ label: String(o.label || ''), description: String(o.description || '') }));
    options = list;
  }
  trueDescription = typeof input.trueDescription === 'string' ? input.trueDescription : 'The answer to the question is yes.';
  falseDescription = typeof input.falseDescription === 'string' ? input.falseDescription : 'The answer to the question is no.';
  $('#context').value = input.state || '';
  $('#question').value = input.question || '';
  setType(input.type, false); updateCount(); updateModelHint(); clearValidation();
}
function loadPreset(key) {
  if (busy) return;
  const preset = PRESETS[key];
  if (!preset) return;
  setTab('home');
  loadInput({ ...preset, model: $('#model').value });
  $$('dialog[open]').forEach(dialog => dialog.close());
  saveDraft(); toast(`${preset.title} example loaded. Edit it or make a decision.`);
  $('#question').focus();
}
function renderHistory() {
  $('#clear-history').disabled = !history.length;
  $('#history').innerHTML = history.length ? history.map(run => `<button class="history-item${run.id === currentRun ? ' current' : ''}" data-history="${escapeHTML(run.id)}" title="${escapeHTML(run.input.question)}">${icon(run.input.type === 'ranking' ? 'rank' : 'history')}<span>${escapeHTML(run.input.question)}</span></button>`).join('') : '<p class="history-empty">A little history, once you<br>make your first decision.</p>';
}
function probabilities(input, answer) {
  if (input.type === 'bool') return [{ label: 'True', value: answer.noul }, { label: 'False', value: 1 - answer.noul }];
  if (!answer.probabilities || typeof answer.probabilities !== 'object') return [];
  const rows = Object.entries(answer.probabilities).map(([key, value]) => ({ label: input.type === 'score' ? input.options[Number(key)]?.label || answer.legend?.[key] || key : key, value, key }));
  return input.type === 'score' ? rows.sort((a, b) => Number(a.key) - Number(b.key)) : rows.sort((a, b) => b.value - a.value);
}
const percentage = value => `${(value * 100).toFixed(1)}%`;
function renderRun(run) {
  const { input, result } = run, answer = result.answers.decision;
  const rows = probabilities(input, answer);
  const best = [...rows].sort((a, b) => b.value - a.value)[0];
  let value, subtitle;
  const isTie = rows.length > 1 && Math.abs([...rows].sort((a,b) => b.value-a.value)[0].value - [...rows].sort((a,b) => b.value-a.value)[1].value) < 1e-9;
  if (input.type === 'bool') {
    value = isTie ? 'Evenly split' : answer.noul > .5 ? 'True' : 'False';
    subtitle = isTie ? 'The model assigns the same probability to both answers.' : `${percentage(best.value)} model probability · ${answer.noul > .5 ? input.trueDescription : input.falseDescription}`;
  } else if (input.type === 'score') {
    value = `${Number(answer.score).toFixed(2)} <span class="score-out-of">/ ${input.options.length - 1}</span>`;
    subtitle = `Expected level on your 0–${input.options.length - 1} scale. Most likely: ${best?.label || '—'}.`;
  } else {
    value = isTie ? 'Tied options' : escapeHTML(answer.choice);
    subtitle = input.type === 'ranking' ? 'Alternatives ranked by relative probability, highest first.' : isTie ? 'Two or more options share the highest probability.' : `${percentage(best?.value || 0)} model probability for the selected option.`;
  }
  const modelName = input.model.includes('typed-decisions') ? 'Typed Decisions' : 'English';
  return `<article class="run-record" data-run-id="${escapeHTML(run.id)}"><div class="question-bubble"><strong>${escapeHTML(input.question)}</strong><details><summary>View the context</summary><p>${escapeHTML(input.state)}</p></details></div><div class="answer-heading"><span class="answer-avatar">${icon('spark')}</span><strong>Laya <span class="model-name">· ${modelName}</span></strong><small>${TYPE_LABEL[input.type]}</small></div><div class="answer-label">${input.type === 'ranking' ? 'BEST MATCH' : input.type === 'score' ? 'EXPECTED SCORE' : 'THE DECISION'}</div><div class="answer-value">${value}</div><p class="answer-subtitle">${escapeHTML(subtitle)}</p><div class="probability-list" aria-label="Answer probabilities">${rows.map((r,i) => `<div class="probability-row${r.value === best?.value ? ' winner' : ''}"><div class="probability-label"><span>${input.type === 'ranking' ? `<span class="rank-number">${String(i+1).padStart(2,'0')}</span>` : ''}${escapeHTML(r.label)}</span><strong>${percentage(r.value)}</strong></div><div class="probability-bar" role="meter" aria-label="${escapeHTML(r.label)} probability" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${(r.value*100).toFixed(1)}"><span data-probability="${r.value}"></span></div></div>`).join('')}</div><div class="answer-metadata"><span>${result.elapsed_ms.toLocaleString()} ms</span>${result.usage?.input_tokens != null ? `<span>${Number(result.usage.input_tokens).toLocaleString()} input tokens</span>` : ''}${Number.isFinite(answer.confidence) ? `<span title="Distribution concentration, not probability of correctness">${percentage(answer.confidence)} concentration</span>` : ''}<button class="text-button" data-export="${escapeHTML(run.id)}" aria-label="Export decision as JSON">${icon('download')}JSON</button></div><details class="raw-details"><summary>Inspect request & response</summary><pre>${escapeHTML(JSON.stringify({ request: result.request, response: Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'request')) }, null, 2))}</pre></details><button class="text-button" data-reuse="${escapeHTML(run.id)}">${icon('copy')}Reuse this setup</button></article>`;
}
function renderFeed() {
  $('#decision-feed').innerHTML = visibleRuns.length ? visibleRuns.map(renderRun).join('') : emptyOutput;
  $$('[data-probability]').forEach(bar => { bar.style.width = `${Math.max(0, Math.min(1, Number(bar.dataset.probability))) * 100}%`; });
}
function setBusy(value) {
  busy = value; $('#form-fields').disabled = value; $('#run').disabled = value;
  $('#run span').textContent = value ? 'Thinking…' : 'Make a decision';
  $('#cancel').hidden = !value;
  $('#decision-feed').setAttribute('aria-busy', String(value));
  $('#new-decision').disabled = value;
  $('#load-json').disabled = value;
  $$('[data-preset], [data-history], #clear-history, #confirm-clear').forEach(b => { b.disabled = value; });
}
function clearValidation() {
  showError('');
  ['context', 'question'].forEach(id => { $(`#${id}-error`).textContent = ''; $(`#${id}`).removeAttribute('aria-invalid'); });
}
function validate(input) {
  clearValidation();
  let firstInvalid;
  [['question', input.question], ['context', input.state]].forEach(([id, value]) => {
    if (!value.trim()) {
      $(`#${id}-error`).textContent = id === 'context' ? 'Add the text or situation Laya should evaluate.' : 'Enter the question you want Laya to answer.';
      $(`#${id}`).setAttribute('aria-invalid', 'true');
      firstInvalid ||= $(`#${id}`);
    }
  });
  if (firstInvalid) { firstInvalid.focus(); announce('Add the missing context or question.'); return false; }
  if (input.type === 'bool' && (!input.trueDescription.trim() || !input.falseDescription.trim())) { showError('Describe both the true and false answers.'); return false; }
  if (input.type !== 'bool') {
    if (input.options.some(o => !o.label.trim())) { showError('Give every answer option a label.'); return false; }
    if (new Set(input.options.map(o => o.label.trim().toLowerCase())).size !== input.options.length) { showError('Use a unique label for each answer option.'); return false; }
  }
  if (availability && (!availability.online || !availability.models.find(m => m.name === input.model)?.available)) {
    showError(availability.online ? 'The selected Laya model is missing. Install it in Ollama, then refresh the connection.' : 'Ollama is offline. Start Ollama, then refresh the connection.'); return false;
  }
  return true;
}
async function decide(event) {
  event?.preventDefault();
  if (busy) return;
  if (visibleRuns.length >= MAX_RUNS) { showError(`Save this conversation and start a new one after ${MAX_RUNS} decisions.`); return; }
  const input = captureInput();
  if (!validate(input)) return;
  setBusy(true); controller = new AbortController();
  const loading = document.createElement('div');
  loading.className = 'loading-output';
  loading.innerHTML = '<div class="spinner" aria-hidden="true"></div><h3>Weighing the possibilities…</h3><p>Laya is evaluating your context locally.<br>The first run may take longer while the model loads.</p>';
  if (!visibleRuns.length) $('#decision-feed').innerHTML = '';
  $('#decision-feed').append(loading); announce('Laya is evaluating your decision.');
  try {
    const response = await fetch('/api/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (HTTP ${response.status}).`);
    if (!validResult(result, input)) throw new Error('The model returned an incomplete or invalid probability distribution. Please retry.');
    const run = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), input, result };
    visibleRuns.push(run); currentRun = run.id;
    if (saveEnabled) { history.unshift(run); history = history.slice(0,40); persistHistory(); }
    renderFeed(); renderHistory(); saveDraft();
    const answer = result.answers.decision;
    announce(`Decision ready. ${input.type === 'bool' ? `Probability of true: ${percentage(answer.noul)}` : input.type === 'score' ? `Expected score: ${answer.score.toFixed(2)}` : `Selected option: ${answer.choice}`}.`);
    const record = $(`[data-run-id="${run.id}"]`);
    if (record && window.innerWidth < 1000) record.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (error.name === 'AbortError') toast('Decision cancelled. Your input is still here.');
    else { showError(error.message === 'Failed to fetch' ? 'Cannot reach the local UI server. Restart it with npm start and retry.' : error.message); announce(`Decision failed: ${error.message}`); }
    renderFeed();
  } finally { controller = null; setBusy(false); }
}
async function checkStatus() {
  $('#refresh').disabled = true;
  try {
    const response = await fetch('/api/status', { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error();
    availability = await response.json();
    const count = availability.models.filter(m => m.available).length;
    $('#connection-text').textContent = availability.online ? count === 2 ? 'Ollama connected' : `Ollama · ${count}/2 models found` : 'Ollama offline';
    $('#status-dot').className = `status-dot ${availability.online && count ? 'online' : 'offline'}`;
    $('#connection-text').title = availability.error || `${count} of your 2 Laya models are installed.`;
    updateModelHint();
  } catch {
    availability = null;
    $('#connection-text').textContent = 'UI server unavailable'; $('#status-dot').className = 'status-dot offline';
  } finally { $('#refresh').disabled = false; }
}
function exportRun(id) {
  const run = visibleRuns.find(r => r.id === id) || history.find(r => r.id === id);
  if (!run) return;
  const blob = new Blob([JSON.stringify(run,null,2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `laya-${run.input.type}-${run.createdAt.replace(/[:.]/g,'-')}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function newDecision() {
  if (busy) return;
  visibleRuns = []; currentRun = null; setTab('home');
  loadInput({ model: $('#model').value, type: 'choice', options: defaultOptions(), state: '', question: '' });
  renderFeed(); renderHistory(); saveDraft(); $('#question').focus();
}

$('#decision-form').addEventListener('submit', decide);
$('#cancel').addEventListener('click', () => controller?.abort());
$$('[data-type]').forEach(b => b.addEventListener('click', () => setType(b.dataset.type)));
$('#model').addEventListener('change', () => { updateModelHint(); saveDraft(); });
function addOption() {
  if (busy || type === 'bool') return;
  const list = options;
  if (list.length >= 26) return;
  list.push({ label: '', description: '' }); renderOptions();
  $(`[data-index="${list.length-1}"][data-field="label"]`).focus(); saveDraft();
  showError(''); announce(`Option ${list.length} added. Type the answer label.`);
}
$('#add-option').addEventListener('click', addOption);
$('#options-list').addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.isComposing || event.ctrlKey || event.metaKey || event.shiftKey || event.target.dataset.field !== 'label') return;
  event.preventDefault();
  if (!event.target.value.trim()) return;
  const i = Number(event.target.dataset.index), list = options;
  if (i < list.length - 1) $(`[data-index="${i + 1}"][data-field="label"]`).focus();
  else if (list.length < 26) addOption();
  else announce('Maximum 26 options reached.');
});
$('#options-list').addEventListener('paste', event => {
  if (busy || event.target.dataset.field !== 'label') return;
  const pasted = event.clipboardData?.getData('text/plain') || '';
  if (!/[\r\n]/.test(pasted)) return;
  const labels = pasted.split(/\r\n|\r|\n/).map(label => label.trim()).filter(Boolean);
  if (labels.length < 2) return;
  event.preventDefault();
  const list = options, i = Number(event.target.dataset.index);
  if (list.length - 1 + labels.length > 26) { showError('Pasting these answers would exceed 26 options. Paste fewer lines.'); return; }
  if (labels.some(label => label.length > 100)) { showError('Keep each option label within 100 characters.'); return; }
  list.splice(i, 1, ...labels.map(label => ({ label, description: '' })));
  renderOptions(); showError(''); saveDraft();
  $(`[data-index="${i + labels.length - 1}"][data-field="label"]`).focus();
  announce(`${labels.length} options pasted. ${list.length} options in total.`);
});
$('#options-list').addEventListener('input', event => {
  const { bool, index, field } = event.target.dataset;
  if (bool === 'true') trueDescription = event.target.value;
  else if (bool === 'false') falseDescription = event.target.value;
  else if (index != null && field) (options)[Number(index)][field] = event.target.value;
  saveDraft();
});
$('#options-list').addEventListener('click', event => {
  const remove = event.target.closest('[data-remove]');
  const list = options;
  if (remove && list.length > 2) {
    const i = Number(remove.dataset.remove); list.splice(i,1); renderOptions(); saveDraft();
    $(`[data-index="${Math.min(i,list.length-1)}"][data-field="label"]`).focus();
  }
});
['context','question'].forEach(id => $(`#${id}`).addEventListener('input', () => {
  $(`#${id}-error`).textContent = ''; $(`#${id}`).removeAttribute('aria-invalid'); showError(''); updateCount(); saveDraft();
}));
$('#new-decision').addEventListener('click', newDecision);
$('#refresh').addEventListener('click', checkStatus);
$('#clear-history').addEventListener('click', () => $('#clear-dialog').showModal());
$('#confirm-clear').addEventListener('click', () => { history = []; persistHistory(); renderHistory(); $('#clear-dialog').close(); toast('Saved history cleared.'); });
$$('.close-dialog').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$('#preset-grid').innerHTML = Object.entries(PRESETS).map(([key,p]) => `<button class="preset-card" data-preset="${key}"><span class="starter-icon ${p.color}">${icon(p.icon)}</span><strong>${p.title}</strong><p>${p.description}</p><span class="preset-type">${TYPE_LABEL[p.type]}</span></button>`).join('');
document.addEventListener('click', event => {
  const preset = event.target.closest('[data-preset]'); if (preset) loadPreset(preset.dataset.preset);
  const saved = event.target.closest('[data-history]');
  if (saved && !busy) { const run = history.find(r => r.id === saved.dataset.history); if (run) { currentRun = run.id; visibleRuns = [run]; setTab('home'); loadInput(run.input); renderFeed(); renderHistory(); saveDraft(); } }
  const exp = event.target.closest('[data-export]'); if (exp) exportRun(exp.dataset.export);
  const reuse = event.target.closest('[data-reuse]');
  if (reuse && !busy) { const run = visibleRuns.find(r => r.id === reuse.dataset.reuse); if (run) { loadInput(run.input); saveDraft(); $('#question').focus(); toast('Setup restored. Edit it and run again.'); } }
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !document.querySelector('dialog[open]')) { event.preventDefault(); decide(); }
  if (event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); newDecision(); }
});
try {
  const draft = saveEnabled && JSON.parse(sessionStorage.getItem(DRAFT) || 'null');
  if (draft) loadInput(draft);
  const saved = saveEnabled && JSON.parse(sessionStorage.getItem(CONVERSATION) || 'null');
  if (saved) { const session = normalizeSession(saved); visibleRuns = session.runs; currentRun = visibleRuns.at(-1)?.id || null; loadInput(session.draft); renderFeed(); }
} catch { /* Ignore stale drafts. */ }
setType(type, false); updateCount(); updateModelHint(); renderHistory(); checkStatus();
$$('svg').forEach(svg => svg.setAttribute('aria-hidden', 'true'));

function setTab(name) {
  if (!['home','templates','help'].includes(name)) return;
  $$('[data-tab]').forEach(button => {
    const selected = button.dataset.tab === name;
    button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    $(`#panel-${button.dataset.tab}`).hidden = !selected;
  });
  $('#active-section').textContent = name[0].toUpperCase() + name.slice(1);
}
$$('[data-tab]').forEach(button => {
  button.addEventListener('click', () => setTab(button.dataset.tab));
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = $$('[data-tab]'), i = tabs.indexOf(button);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[next].dataset.tab); tabs[next].focus();
  });
});
$('[data-home-link]').addEventListener('click', event => { event.preventDefault(); setTab('home'); });
function sessionData() { return { format: SESSION_FORMAT, version: 1, savedAt: new Date().toISOString(), runs: visibleRuns, draft: captureInput() }; }
function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#save-json').addEventListener('click', async () => {
  if (window.layaDesktop) { await desktopSave(['json']); return; }
  downloadFile(new Blob([JSON.stringify(sessionData(),null,2)], {type:'application/json'}), `laya-conversation-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
});
$('#load-json').addEventListener('click', () => { $('#load-file').value = ''; $('#load-file').click(); });
function applySession(session) {
  visibleRuns = session.runs; currentRun = visibleRuns.at(-1)?.id || null;
  loadInput(session.draft); setTab('home'); renderFeed();
  if (saveEnabled) {
    const existing = new Set(history.map(r => r.id));
    history = [...session.runs.filter(r => !existing.has(r.id)).reverse(), ...history].slice(0,40); persistHistory();
  }
  renderHistory(); saveDraft();
  toast(`Conversation loaded. ${visibleRuns.length} decisions restored. Continue by editing your context or question.`);
}
$('#load-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file || busy) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('Choose a JSON file smaller than 20 MB.');
    const session = normalizeSession(JSON.parse(await file.text()));
    if (visibleRuns.length || $('#context').value.trim() || $('#question').value.trim()) { pendingImport = session; $('#import-dialog').showModal(); }
    else applySession(session);
  } catch (error) { toast(`Could not load JSON: ${error.message}`); }
});
$('#confirm-import').addEventListener('click', () => {
  if (pendingImport) applySession(pendingImport);
  pendingImport = null; $('#import-dialog').close();
});
$('#import-dialog').addEventListener('close', () => { pendingImport = null; });
$('#export-excel').addEventListener('click', async () => {
  if (window.layaDesktop) { await desktopSave(['xlsx']); return; }
  const button = $('#export-excel'); button.disabled = true; button.textContent = 'Exporting…';
  try {
    const response = await fetch('/api/export/excel', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sessionData())});
    if (!response.ok) throw new Error((await response.json()).error || 'Excel export failed.');
    downloadFile(await response.blob(), `laya-conversation-${new Date().toISOString().replace(/[:.]/g,'-')}.xlsx`);
  } catch (error) { toast(`Could not export Excel: ${error.message}`); }
  finally { button.disabled = false; button.textContent = 'Export Excel'; }
});
window.addEventListener('desktop-save-status', event => toast(String(event.detail)));

async function desktopSave(formats) {
  try {
    const outcome = await window.layaDesktop.saveSession(sessionData(), formats);
    toast(outcome.saved ? 'File saved.' : outcome.cancelled ? 'Save cancelled. Your conversation is still here.' : outcome.error || 'Save did not complete.');
  } catch (error) { toast(`Could not save: ${error.message}`); }
}
window.layaSessionData = () => structuredClone(sessionData());
const contextImport = setupContextImport({isBusy:()=>busy});
window.layaPrepareToClose = () => { controller?.abort(); return structuredClone(sessionData()); };
window.layaClearConversation = () => {
  contextImport.cancel();
  saveEnabled = false; clearTimeout(draftTimer); controller?.abort();
  for (const key of [STORAGE,DRAFT,CONVERSATION,'laya-studio-save-v1']) {
    sessionStorage.removeItem(key); localStorage.removeItem(key);
  }
  visibleRuns = []; history = []; currentRun = null;
  $('#context').value = ''; $('#question').value = ''; renderFeed(); renderHistory();
};
