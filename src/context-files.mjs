import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_CHARS = 200000;
export const FILE_EXTENSIONS = new Set(['.pdf','.docx','.doc','.md','.markdown','.txt','.xlsx','.xls','.xlsm','.csv']);

export function contextFilename(value) {
  if (typeof value !== 'string' || !value || value.length > 1000) throw new Error('Choose a file with a valid name.');
  const name = value.replace(/\\/g,'/').split('/').at(-1).replace(/[\x00-\x1f\x7f]/g,'').trim();
  if (!name || name.length > 255 || !FILE_EXTENSIONS.has(path.extname(name).toLowerCase())) throw new Error('Choose a PDF, Word (.docx/.doc), Markdown, text, or Excel (.xlsx/.xls/.xlsm/.csv) file.');
  return name;
}

let running = 0;
export function extractContextFile(filename, buffer, { signal, timeout = 30000 } = {}) {
  filename = contextFilename(filename);
  if (!buffer?.length) return Promise.reject(new Error('This file is empty.'));
  if (buffer.length > MAX_FILE_BYTES) return Promise.reject(new Error('Choose a file smaller than 10 MB.'));
  if (signal?.aborted) return Promise.reject(new Error('File import cancelled.'));
  if (running >= 2) return Promise.reject(new Error('Other files are being read. Please try again in a moment.'));
  return new Promise((resolve,reject) => {
    // PDF's native dependencies must run in their own process. Abruptly
    // terminating them in a worker thread can crash the enclosing app on Windows.
    const worker = fork(fileURLToPath(new URL('./context-worker.mjs',import.meta.url)), [], {
      env:{...process.env,...(process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{})},
      execArgv:['--max-old-space-size=256'], serialization:'advanced',
      stdio:['ignore','ignore','ignore','ipc'], windowsHide:true,
    });
    running++;
    let settled=false;
    const finish=(error,result)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(worker.exitCode===null&&worker.signalCode===null)worker.kill();
      running--;error?reject(error):resolve(result);
    };
    const abort=()=>finish(new Error('File import cancelled.'));
    const timer=setTimeout(()=>finish(new Error('This file took too long to read. Try a smaller file or a text export.')),timeout);
    signal?.addEventListener('abort',abort,{once:true});
    worker.once('message',message=>finish(message.error?new Error(message.error):null,message.result));
    worker.once('error',()=>finish(new Error('This file could not be read within the available memory. Try a smaller file.')));
    worker.once('exit',()=>{if(!settled)finish(new Error('The file reader stopped before extraction completed.'));});
    worker.send({filename,data:buffer,maxChars:MAX_EXTRACTED_CHARS},error=>{if(error)finish(new Error('The file reader could not receive this file.'));});
  });
}
