import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const workerData = await new Promise(resolve=>process.once('message',resolve));
const parentPort = {postMessage:message=>process.send(message,()=>process.disconnect())};
const { filename, maxChars } = workerData;
const buffer = Buffer.from(workerData.data);
const extension = path.extname(filename).toLowerCase();
const zip = buffer[0]===0x50 && buffer[1]===0x4b;
const ole = buffer.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex'));

function checked(text) {
  text=String(text).replace(/\r\n?/g,'\n').replace(/\0/g,'').trim();
  if(text.length>maxChars) throw new Error('This document contains more than 200,000 characters. Export a smaller section to import.');
  return text;
}
function decodeText(data) {
  if(data[0]===0xff&&data[1]===0xfe)return new TextDecoder('utf-16le',{fatal:true}).decode(data.subarray(2));
  if(data[0]===0xfe&&data[1]===0xff)return new TextDecoder('utf-16be',{fatal:true}).decode(data.subarray(2));
  return new TextDecoder('utf-8',{fatal:true}).decode(data);
}
// Bound the expanded Office archive before asking a parser to inflate entries.
async function checkArchive() {
  const yauzl = require('yauzl');
  await new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true},(error,archive)=>{
    if(error)return reject(new Error('This Office file is damaged or password-protected.'));
    let expanded=0,entries=0,done=false;
    const fail=()=>{if(done)return;done=true;archive.close();reject(new Error('This Office file expands beyond the import limit. Export a smaller section.'));};
    archive.on('entry',entry=>{
      expanded+=entry.uncompressedSize;entries++;
      if(expanded>64*1024*1024||entries>10000)return fail();
      archive.readEntry();
    });
    archive.once('error',error=>{if(!done){done=true;archive.close();reject(error);}});
    archive.once('end',()=>{if(!done){done=true;resolve();}});
    archive.readEntry();
  }));
}

async function extract() {
  let text='', details='', warnings=[];
  if(['.md','.markdown','.txt'].includes(extension)) {
    text=decodeText(buffer);details='Text';
  } else if(extension==='.pdf') {
    if(!buffer.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('This file does not contain a valid PDF.');
    const { PDFParse }=await import('pdf-parse');
    const parser=new PDFParse({data:new Uint8Array(buffer),isEvalSupported:false});
    try {
      const info=await parser.getInfo();
      if(info.total>200)throw new Error('PDF imports support up to 200 pages. Save the relevant pages as a smaller PDF.');
      const result=await parser.getText({pageJoiner:''});
      const emptyPages=result.pages.filter(page=>!page.text.trim()).length;
      text=result.pages.map(page=>page.text.trim()?`[Page ${page.num}]\n${page.text.trim()}`:'').filter(Boolean).join('\n\n');
      details=`${info.total} page${info.total===1?'':'s'}`;
      if(emptyPages)warnings.push(`${emptyPages} page(s) had no extractable text. Images and scans need OCR before importing.`);
    } finally { await parser.destroy(); }
  } else if(extension==='.docx'||extension==='.doc') {
    if(extension==='.docx'&&!zip)throw new Error('This is not a readable .docx file. Save it as an unprotected Word document.');
    if(extension==='.doc'&&!ole)throw new Error('This is not a readable .doc file. Save it as .docx and try again.');
    if(zip)await checkArchive();
    const WordExtractor=require('word-extractor');
    const doc=await new WordExtractor().extract(buffer);
    text=[doc.getBody(),doc.getFootnotes(),doc.getEndnotes(),doc.getHeaders(),doc.getTextboxes()].filter(value=>value?.trim()).join('\n\n');details='Word document';
  } else {
    if(extension!=='.csv'&&!zip&&!ole)throw new Error('This is not a readable Excel workbook. Save it as .xlsx or .csv.');
    if(zip)await checkArchive();
    const XLSX=require('xlsx');
    const book=XLSX.read(extension==='.csv'?decodeText(buffer):buffer,{type:extension==='.csv'?'string':'buffer',dense:true,cellFormula:false,cellHTML:false,cellText:true,cellDates:true});
    if(book.SheetNames.length>50)throw new Error('This workbook has more than 50 sheets. Import a smaller workbook.');
    const sections=[];
    for(const name of book.SheetNames) {
      const sheet=book.Sheets[name];
      if(!sheet['!ref'])continue;
      const range=XLSX.utils.decode_range(sheet['!ref']);
      if((range.e.r-range.s.r+1)*(range.e.c-range.s.c+1)>100000)throw new Error('A sheet is too large to import. Export the relevant rows as CSV.');
      const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:'',blankrows:false});
      const lines=rows.map(row=>row.map(cell=>String(cell).replace(/[\r\n\t]+/g,' ')).join('\t')).filter(line=>line.trim());
      if(lines.length)sections.push(`[Sheet: ${name}]\n${lines.join('\n')}`);
      checked(sections.join('\n\n'));
    }
    text=sections.join('\n\n');details=`${book.SheetNames.length} sheet${book.SheetNames.length===1?'':'s'}`;
    warnings.push('Spreadsheet formulas use saved cell values; formulas are not recalculated. Charts and images are not included.');
  }
  text=checked(text);
  if(!text)throw new Error(extension==='.pdf'?'No selectable text found. This PDF may be scanned; run OCR first, then import it again.':'No readable text or cell values were found in this file.');
  return {filename,text,characters:text.length,details,warnings};
}
try { parentPort.postMessage({result:await extract()}); }
catch(error) {
  const message=/password|encrypt/i.test(error.message)?'This document is password-protected. Save an unprotected copy and try again.':error instanceof TypeError&&/encoded data/i.test(error.message)?'Save this text file as UTF-8 or UTF-16, then try again.':error.message;
  parentPort.postMessage({error:message||'This file could not be read. Try an unprotected copy or a text export.'});
}
