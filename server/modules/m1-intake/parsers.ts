// Format registry: add a new brief format by adding one parser here.
import ExcelJS from 'exceljs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { SourceFormat } from '../../types';

type Parser = (input: Buffer) => Promise<string>;

const parseEmail: Parser = async (input) => input.toString('utf8');

const parsePdf: Parser = async (input) => {
  const document = await getDocument({ data: new Uint8Array(input), verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= document.numPages; n++) {
    const content = await (await document.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join(''));
  }
  const text = pages.join('\n').trim();
  if (!text) throw new Error('This PDF has no readable text. Scanned PDFs are not supported yet.');
  return text;
};

const parseExcel: Parser = async (input) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input as unknown as ArrayBuffer);
  const lines: string[] = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1).filter((cell) => cell !== null && cell !== undefined).map(String);
      if (cells.length) lines.push(cells.join(': '));
    });
  });
  return lines.join('\n');
};

const parsers: Record<SourceFormat, Parser> = { email: parseEmail, pdf: parsePdf, excel: parseExcel };

const extensions: Record<string, SourceFormat> = { txt: 'email', eml: 'email', pdf: 'pdf', xlsx: 'excel' };

export function formatFromFilename(filename: string): SourceFormat | null {
  return extensions[filename.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

export const toText = (format: SourceFormat, input: Buffer) => parsers[format](input);
