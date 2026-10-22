import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { contextFilename, extractContextFile, MAX_FILE_BYTES } from './context-files.mjs';

export const MODELS = ['laya:421m-typed-decisions-bf16', 'laya:421m-english-bf16'];
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OLLAMA = 'http://127.0.0.1:11434';
const MAX_BODY = 96 * 1024;

export class InputError extends Error {}
function text(value, name, limit) {
  if (typeof value !== 'string' || !value.trim()) throw new InputError(`${name} is required.`);
  if (value.length > limit) throw new InputError(`${name} must be at most ${limit.toLocaleString()} characters.`);
  return value.trim();
}

export function buildRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Send a JSON object.');
  if (!MODELS.includes(input.model)) throw new InputError('Choose one of the two supported Laya models.');
  if (!['bool', 'choice', 'ranking'].includes(input.type)) throw new InputError('Choose Bool, Choice, or Ranking.');
  const state = text(input.state, 'Context', 24000);
  const instructions = text(input.question, 'Question', 2000);
  let criteria;
  if (input.type === 'bool') {
    criteria = {
      true: text(input.trueDescription, 'True description', 300),
      false: text(input.falseDescription, 'False description', 300),
    };
  } else {
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 26) {
      throw new InputError('Add between 2 and 26 answer options.');
    }
    const options = input.options.map((option, i) => {
      if (!option || typeof option !== 'object') throw new InputError(`Option ${i + 1} is invalid.`);
      return { label: text(option.label, `Option ${i + 1} label`, 100),
        description: typeof option.description === 'string' ? option.description.trim() : '' };
    });
    if (new Set(options.map(o => o.label.toLowerCase())).size !== options.length) throw new InputError('Each option needs a unique label.');
    if (options.some(o => o.description.length > 300)) throw new InputError('Keep option descriptions under 300 characters.');
    criteria = Object.fromEntries(options.map(o => [o.label, o.description || null]));
  }
  return { model: input.model, state, questions: { decision: {
    type: input.type === 'bool' ? 'noul' : 'choice',
    instructions, criteria,
  } }, keep_alive: '5m' };
}

function json(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

export function createApp({ fetchOllama = fetch, instanceId = null, onActivate = null } = {}) {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const authority = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(authority)) return json(res, 403, { error: 'This app accepts local connections only.' });
    if (req.headers.origin && ![`http://${authority}`].includes(req.headers.origin)) return json(res, 403, { error: 'Cross-origin requests are not allowed.' });
    const url = new URL(req.url, `http://${authority}`);
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return json(res, 200, { app: 'laya-decision-studio', version: '1.1.0', managed: Boolean(instanceId), instanceId });
      }
      if (req.method === 'POST' && url.pathname === '/api/activate' && onActivate) {
        await onActivate(); return json(res, 200, { activated: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/context/extract') {
        if(req.headers['content-type']!=='application/octet-stream')return json(res,415,{error:'Send the selected file as binary data.'});
        let filename;
        try { filename=contextFilename(decodeURIComponent(req.headers['x-file-name']||'')); }
        catch(error){return json(res,415,{error:error.message});}
        if(Number(req.headers['content-length'])>MAX_FILE_BYTES)return json(res,413,{error:'Choose a file smaller than 10 MB.'});
        const chunks=[];let bytes=0;
        for await(const chunk of req){bytes+=chunk.length;if(bytes>MAX_FILE_BYTES)return json(res,413,{error:'Choose a file smaller than 10 MB.'});chunks.push(chunk);}
        const controller=new AbortController();const cancel=()=>{if(!res.writableEnded)controller.abort();};
        res.once('close',cancel);
        try { return json(res,200,await extractContextFile(filename,Buffer.concat(chunks),{signal:controller.signal})); }
        catch(error){if(!controller.signal.aborted)return json(res,400,{error:error.message});}
        finally {res.off('close',cancel);}
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/export/excel') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Use application/json.' });
        const chunks = []; let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 20 * 1024 * 1024) return json(res, 413, { error: 'Conversation exceeds the 20 MB export limit.' });
          chunks.push(chunk);
        }
        let value;
        try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new InputError('Invalid conversation JSON.'); }
        try {
          const { exportWorkbook } = await import('./workbook.mjs');
          const buffer = await exportWorkbook(value);
          res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="laya-conversation.xlsx"', 'Cache-Control': 'no-store' });
          return res.end(buffer);
        } catch (error) { throw new InputError(error.message); }
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        try {
          const response = await fetchOllama(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
          if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
          const data = await response.json();
          return json(res, 200, { online: true, models: MODELS.map(name => ({
            name, available: data.models?.some(m => (m.name || m.model) === name) || false,
          })) });
        } catch {
          return json(res, 200, { online: false, models: MODELS.map(name => ({ name, available: false })), error: 'Cannot reach Ollama at 127.0.0.1:11434. Start Ollama, then refresh the connection.' });
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/decide') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Use application/json.' });
        const chunks = []; let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > MAX_BODY) return json(res, 413, { error: 'Request is too large.' });
          chunks.push(chunk);
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new InputError('Invalid JSON request.'); }
        const payload = buildRequest(input);
        const controller = new AbortController();
        const stop = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', stop);
        const started = performance.now();
        try {
          const response = await fetchOllama(`${OLLAMA}/v1/systemone`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
          });
          const raw = await response.text();
          let data;
          try { data = JSON.parse(raw); } catch { throw new Error(`Ollama returned HTTP ${response.status} without a JSON decision. Ollama 0.40 or later is required.`); }
          if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || `Ollama returned HTTP ${response.status}.`);
          if (!data.answers?.decision) throw new Error('Ollama returned no decision. Check that the selected model supports /v1/systemone.');
          return json(res, 200, { ...data, elapsed_ms: Math.round(performance.now() - started), request: payload });
        } catch (error) {
          if (controller.signal.aborted) return;
          return json(res, 502, { error: error.name === 'TimeoutError'
            ? 'Ollama took more than 120 seconds. Try shorter context or retry after the model loads.'
            : error.message === 'fetch failed' ? 'Cannot reach Ollama at 127.0.0.1:11434. Start Ollama and try again.' : error.message });
        } finally { res.off('close', stop); }
      }
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/context-import.js': ['context-import.js','text/javascript'], '/session.js': ['session.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
      if (req.method === 'GET' && files[url.pathname]) {
        const [file, mime] = files[url.pathname];
        const content = await readFile(path.join(ROOT, 'public', file));
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-cache' });
        return res.end(content);
      }
      json(res, 404, { error: 'Not found.' });
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof InputError ? 400 : 500, { error: error instanceof InputError ? error.message : 'The local server could not complete this request.' });
      else res.end();
    }
  });
}

function openBrowser(url) {
  if (process.platform !== 'win32') return;
  const child = spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
  child.on('error', () => console.log(`Open ${url} in your browser.`));
  child.unref();
}

async function isExistingStudio(url) {
  try {
    const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
    if (health.ok && (await health.json()).app === 'laya-decision-studio') return true;
  } catch { /* Older versions do not have the health route. */ }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: 'error' });
    if (!response.ok) return false;
    const page = await response.text();
    return page.includes('<title>Laya — Decision Studio</title>') && page.includes('id="decision-form"');
  } catch { return false; }
}

export async function startApp({ port = 3210, open = false, openUrl = openBrowser, log = console.log, reuse = true, appOptions = {} } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a number between 1 and 65535.');
  for (let candidate = port; candidate <= Math.min(port + 10, 65535); candidate++) {
    const server = createApp(appOptions);
    const url = `http://127.0.0.1:${candidate}`;
    try {
      await new Promise((resolve, reject) => {
        const failed = error => { server.off('listening', ready); reject(error); };
        const ready = () => { server.off('error', failed); resolve(); };
        server.once('error', failed);
        server.once('listening', ready);
        server.listen(candidate, '127.0.0.1');
      });
      log(`Laya Decision Studio → ${url}\nOllama → ${OLLAMA}\nPress Ctrl+C to stop.`);
      if (open) openUrl(url);
      return { server, url, reused: false };
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      if (reuse && await isExistingStudio(url)) {
        log(`Laya Decision Studio is already running → ${url}\nReusing the existing instance.`);
        if (open) openUrl(url);
        return { server: null, url, reused: true };
      }
      log(`Port ${candidate} is occupied by another service. Trying the next UI port…`);
    }
  }
  throw new Error(`No available UI port between ${port} and ${Math.min(port + 10, 65535)}. Set PORT to a different number and retry.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await startApp({ port: Number(process.env.PORT || 3210), open: process.argv.includes('--open') }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
