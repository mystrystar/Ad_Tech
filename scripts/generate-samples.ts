// Writes the same sample brief as email text, PDF and Excel to samples/.
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const BODY = 'Budget around 4.5 cr all in. 20 Oct to 12 Nov. Women 25-44, NCCS AB, Hindi belt + Maharashtra. Strong GEC presence, some sports, and digital. Mostly 30 sec, a few 10s. Keep rates same as last year. No competing beverage in the same break.';
const AGENCY = 'Bluekite Media';
const CLIENT = 'Fizzwell Beverages';

mkdirSync('samples', { recursive: true });

writeFileSync('samples/brief-email.txt', `From: Priya Nair <priya.nair@bluekite.example>
Subject: Festive campaign brief

Hi team,

${BODY}

Regards,
Priya Nair
Agency: ${AGENCY}
Client: ${CLIENT}
`);

const pdf = new PDFDocument({ margin: 56 });
pdf.pipe(createWriteStream('samples/brief.pdf'));
pdf.fontSize(16).text('Media Brief');
pdf.moveDown();
pdf.fontSize(11).text(`Agency: ${AGENCY}`).text(`Client: ${CLIENT}`);
pdf.moveDown();
pdf.text(BODY);
pdf.end();

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('Brief');
sheet.columns = [{ header: 'Field', key: 'field', width: 22 }, { header: 'Value', key: 'value', width: 60 }];
sheet.addRows([
  ['Agency', AGENCY],
  ['Client', CLIENT],
  ['Budget', 'around 4.5 cr all in'],
  ['Dates', '20 Oct to 12 Nov'],
  ['Audience', 'Women 25-44'],
  ['NCCS', 'NCCS AB'],
  ['Regions', 'Hindi belt + Maharashtra'],
  ['Genres', 'Strong GEC presence, some sports, and digital'],
  ['Ad lengths', 'Mostly 30 sec, a few 10s'],
  ['Rate instruction', 'Keep rates same as last year'],
  ['Separation rule', 'No competing beverage in the same break'],
]);
await workbook.xlsx.writeFile('samples/brief.xlsx');
console.log('Sample briefs written to samples/');
