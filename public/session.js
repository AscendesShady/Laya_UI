export const SESSION_FORMAT = 'laya-conversation';
export const MAX_RUNS = 500;
const MODELS = ['laya:421m-typed-decisions-bf16', 'laya:421m-english-bf16'];
const TYPES = ['bool', 'choice', 'ranking', 'score'];
const object = v => v && typeof v === 'object' && !Array.isArray(v);
function string(value, name, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`Invalid ${name}.`);
  return value;
}
export function normalizeInput(input, complete = false) {
  if (!object(input) || !MODELS.includes(input.model) || !TYPES.includes(input.type)) throw new Error('Unknown model or decision type in the file.');
  const result = { model: input.model, type: input.type,
    state: string(input.state, 'context', 24000, complete), question: string(input.question, 'question', 2000, complete),
    trueDescription: string(input.trueDescription ?? 'The answer is yes.', 'true description', 300, complete && input.type === 'bool'),
    falseDescription: string(input.falseDescription ?? 'The answer is no.', 'false description', 300, complete && input.type === 'bool'), options: [] };
  if (input.type !== 'bool' || input.options?.length) {
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 26) throw new Error('Each decision needs 2–26 options.');
    result.options = input.options.map(option => {
      if (!object(option)) throw new Error('Invalid answer option.');
      return { label: string(option.label, 'option label', 100, complete), description: string(option.description ?? '', 'option description', 300) };
    });
    if (complete && input.type !== 'bool' && new Set(result.options.map(o => o.label.trim().toLowerCase())).size !== result.options.length) throw new Error('Duplicate option labels in a saved decision.');
  }
  return result;
}
export function validResult(result, input) {
  const a = result?.answers?.decision, probability = n => Number.isFinite(n) && n >= 0 && n <= 1;
  if (!object(result) || !object(a) || !Number.isFinite(result.elapsed_ms) || result.elapsed_ms < 0) return false;
  if (a.confidence != null && !probability(a.confidence)) return false;
  if (input.type === 'bool') return probability(a.noul);
  if (!object(a.probabilities) || !Object.values(a.probabilities).every(probability)) return false;
  const keys = input.type === 'score' ? input.options.map((_, i) => String(i)) : input.options.map(o => o.label.trim());
  if (Object.keys(a.probabilities).length !== keys.length || !keys.every(key => Object.hasOwn(a.probabilities, key))) return false;
  if (Math.abs(Object.values(a.probabilities).reduce((a, b) => a + b, 0) - 1) > .02) return false;
  return input.type === 'score' ? Number.isFinite(a.score) && a.score >= 0 && a.score <= input.options.length - 1 : keys.includes(a.choice);
}
export function normalizeSession(value) {
  // Also accept the single-decision JSON files exported by earlier versions.
  if (object(value) && value.input && value.result && !value.format) value = { format: SESSION_FORMAT, version: 1, runs: [value], draft: value.input };
  if (!object(value) || value.format !== SESSION_FORMAT || value.version !== 1) throw new Error('Choose a Laya conversation JSON file (version 1).');
  if (!Array.isArray(value.runs) || value.runs.length > MAX_RUNS) throw new Error(`A conversation can contain up to ${MAX_RUNS} decisions.`);
  const ids = new Set();
  const runs = value.runs.map(run => {
    if (!object(run) || typeof run.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(run.id) || ids.has(run.id)) throw new Error('Invalid or duplicate decision identifier.');
    ids.add(run.id);
    const input = normalizeInput(run.input, true);
    if (!validResult(run.result, input)) throw new Error('A saved decision has an invalid probability distribution.');
    if (typeof run.createdAt !== 'string' || !Number.isFinite(Date.parse(run.createdAt))) throw new Error('Invalid decision date.');
    return { id: run.id, createdAt: run.createdAt, input, result: JSON.parse(JSON.stringify(run.result)) };
  });
  return { format: SESSION_FORMAT, version: 1, runs, draft: normalizeInput(value.draft ?? runs.at(-1)?.input), savedAt: typeof value.savedAt === 'string' ? value.savedAt : null };
}
