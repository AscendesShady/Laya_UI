// Selected files are parsed by the local server; only reviewed text enters Context.
export function setupContextImport({ isBusy }) {
  const $=selector=>document.querySelector(selector);
  const dialog=$('#context-files-dialog'), picker=$('#context-files'), preview=$('#context-preview');
  const context=$('#context'), apply=$('#apply-context-files'), mode=$('#context-import-mode');
  const status=$('#context-file-status'), list=$('#context-file-list'), count=$('#context-preview-count');
  let controller=null,reading=false;
  const combined=()=>mode.value==='replace'?preview.value.trim():[context.value.trim(),preview.value.trim()].filter(Boolean).join('\n\n');
  function update() {
    const length=combined().length,limit=context.maxLength;
    apply.disabled=reading||!preview.value.trim()||length>limit;
    count.textContent=length>limit?`${length.toLocaleString()} / ${limit.toLocaleString()} characters. Trim the preview or replace the existing context to fit.`:`${length.toLocaleString()} / ${limit.toLocaleString()} context characters after insertion.`;
    count.classList.toggle('over-limit',length>limit);
    preview.setAttribute('aria-invalid',String(length>limit));
  }
  $('#add-context-files').addEventListener('click',()=>{
    if(isBusy())return;picker.value='';picker.click();
  });
  picker.addEventListener('change',async()=>{
    const files=[...picker.files];if(!files.length||isBusy())return;
    controller?.abort();const active=new AbortController();controller=active;
    reading=true;preview.value='';preview.readOnly=true;mode.value='append';list.replaceChildren();
    status.textContent='Reading selected files locally…';dialog.showModal();update();
    if(files.length>5){reading=false;preview.readOnly=false;status.textContent='Choose up to 5 files at a time.';update();return;}
    const parts=[];let successes=0;
    try {
      for(const [index,file] of files.entries()) {
        if(active.signal.aborted)return;
        status.textContent=`Reading file ${index+1} of ${files.length}: ${file.name}`;
        const item=document.createElement('li');list.append(item);
        try {
          if(file.size>10*1024*1024)throw new Error('Choose a file smaller than 10 MB.');
          const response=await fetch('/api/context/extract',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file,signal:active.signal});
          const result=await response.json();
          if(!response.ok)throw new Error(result.error||'Could not read this file.');
          parts.push(`[Source: ${result.filename}]\n${result.text}`);successes++;
          item.textContent=`${result.filename} · ${result.details} · ${result.characters.toLocaleString()} characters`;
          for(const warning of result.warnings||[]){const note=document.createElement('p');note.className='file-note';note.textContent=warning;item.append(note);}
        } catch(error) {
          if(active.signal.aborted)return;
          item.className='file-error';item.textContent=`${file.name}: ${error.message==='Failed to fetch'?'The local file reader is unavailable. Restart Laya and try again.':error.message}`;
        }
      }
      if(active.signal.aborted)return;
      preview.value=parts.join('\n\n');
      status.textContent=successes?`${successes} of ${files.length} file(s) read. Review the text below before adding it.`:'No files could be read. Your existing context is unchanged.';
    } finally {
      if(controller===active){reading=false;preview.readOnly=false;update();}
    }
  });
  preview.addEventListener('input',update);mode.addEventListener('change',update);
  apply.addEventListener('click',()=>{
    if(apply.disabled||isBusy())return;
    context.value=combined();context.dispatchEvent(new Event('input',{bubbles:true}));
    dialog.close();context.focus();
  });
  dialog.addEventListener('close',()=>{
    // A previous close event may be queued while another import reopens this dialog.
    if(dialog.open)return;
    controller?.abort();controller=null;reading=false;
  });
  return {cancel:()=>{controller?.abort();if(dialog.open)dialog.close();}};
}
