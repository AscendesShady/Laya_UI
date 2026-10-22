import JSZip from 'jszip';
import XLSX from 'xlsx';

export function pdfFixture(text='Unopened items may be refunded within 30 days.') {
  const content=`BT /F1 12 Tf 40 740 Td (${text.replace(/[\\()]/g,'\\$&')}) Tj ET`;
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf='%PDF-1.4\n';const offsets=[0];
  for(const [i,body] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${body}\nendobj\n`;}
  const start=Buffer.byteLength(pdf);
  pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}
export async function wordFixture() {
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Refund policy</w:t></w:r></w:p><w:p><w:r><w:t>Return unopened items within 30 days. বাংলা</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({type:'nodebuffer'});
}
export function excelFixture(bookType='xlsx') {
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Item','Days'],['Unopened',30],['Opened',0]]),'Policy');
  const totals=XLSX.utils.aoa_to_sheet([['Threshold'],[30]]);
  totals.A2={t:'n',v:30,f:'15+15'};
  XLSX.utils.book_append_sheet(book,totals,'Rules');
  return XLSX.write(book,{type:'buffer',bookType});
}
