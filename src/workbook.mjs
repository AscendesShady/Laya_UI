import ExcelJS from 'exceljs';
import { normalizeSession } from './public/session.js';

export async function exportWorkbook(value) {
  const session = normalizeSession(value), workbook = new ExcelJS.Workbook();
  workbook.creator = 'Laya Decision Studio';
  const decisions = workbook.addWorksheet('Decisions');
  decisions.columns = [
    ['#', 6], ['Date (UTC)', 25], ['Model', 38], ['Type', 12], ['Question', 48], ['Answer', 25],
    ['P(true)', 12], ['Expected score', 16], ['Concentration', 16], ['Input tokens', 14], ['Elapsed (ms)', 14], ['Context', 75],
  ].map(([header, width]) => ({ header, width }));
  const probabilities = workbook.addWorksheet('Probabilities');
  probabilities.columns = [['Decision #', 12], ['Question', 48], ['Option / level', 28], ['Description', 60], ['Probability', 15], ['Rank', 9]].map(([header, width]) => ({ header, width }));
  session.runs.forEach((run, index) => {
    const { input, result } = run, answer = result.answers.decision;
    decisions.addRow([index + 1, new Date(run.createdAt).toISOString(), input.model, input.type, input.question,
      input.type === 'bool' ? answer.noul === .5 ? 'Evenly split' : answer.noul > .5 ? 'True' : 'False' : input.type === 'score' ? answer.score : answer.choice,
      input.type === 'bool' ? answer.noul : null, input.type === 'score' ? answer.score : null,
      answer.confidence ?? null, result.usage?.input_tokens ?? null, result.elapsed_ms, input.state]);
    const rows = input.type === 'bool' ? [
      { label: 'True', description: input.trueDescription, probability: answer.noul },
      { label: 'False', description: input.falseDescription, probability: 1 - answer.noul },
    ] : Object.entries(answer.probabilities).map(([key, probability]) => {
      const option = input.type === 'score' ? input.options[Number(key)] : input.options.find(o => o.label.trim() === key);
      return { label: input.type === 'score' ? `${key}: ${option.label}` : key, description: option?.description || '', probability };
    });
    const sorted = rows.map(row => row.probability).sort((a,b) => b-a);
    rows.forEach(row => probabilities.addRow([index + 1, input.question, row.label, row.description, row.probability, sorted.indexOf(row.probability) + 1]));
  });
  const draft = workbook.addWorksheet('Current setup');
  draft.columns = [{ header: 'Field', width: 25 }, { header: 'Value', width: 100 }];
  draft.addRows([['Model',session.draft.model], ['Decision type',session.draft.type], ['Question',session.draft.question], ['Context',session.draft.state]]);
  if (session.draft.type === 'bool') draft.addRows([['True',session.draft.trueDescription],['False',session.draft.falseDescription]]);
  else session.draft.options.forEach((o,i) => draft.addRows([[`Option ${i+1}`,o.label],[`Description ${i+1}`,o.description]]));
  for (const sheet of workbook.worksheets) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } };
    sheet.eachRow((row, index) => {
      row.alignment = { vertical: 'top', wrapText: true };
      if (index === 1) { row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF7150C5'} }; row.height = 30; }
      else { row.font = { name:'Calibri', size:11 }; row.height = sheet === decisions ? 65 : 36; }
    });
  }
  for (const column of [7,9]) decisions.getColumn(column).numFmt = '0.0%';
  decisions.getColumn(8).numFmt = '0.00'; probabilities.getColumn(5).numFmt = '0.0%';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
