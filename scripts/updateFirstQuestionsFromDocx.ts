import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

type QuestionRecord = {
  id: string;
  number: number;
  question: string;
  answer: string;
  sourcePageStart: number;
  sourcePageEnd: number;
  chapter: string;
  chapterRange: string;
  verified: boolean;
  extractionWarnings: string[];
};

type ParsedParagraph = {
  text: string;
  isBold: boolean;
  hasDrawing: boolean;
  before: number;
  left: number;
};

type ParsedQuestion = {
  number: number;
  question: string;
  answer: string;
  warnings: string[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const questionsPath = path.join(rootDir, 'src', 'data', 'questions.json');
const reportPath = path.join(rootDir, 'src', 'data', 'validation-report.json');
const docxPath = process.argv[2];

if (!docxPath) {
  throw new Error('Podaj ścieżkę do pliku DOCX.');
}

function chapterFor(number: number) {
  const index = Math.ceil(number / 100);
  const start = (index - 1) * 100 + 1;
  const end = index * 100;
  return {
    chapter: `Część ${index}`,
    chapterRange: `${start}–${end}`,
  };
}

function readZipEntry(buffer: Buffer, filename: string) {
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new Error('Nie znaleziono centralnego katalogu ZIP w DOCX.');
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error('Nieprawidłowy wpis centralnego katalogu ZIP.');
    }

    const method = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const name = buffer.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString('utf8');

    if (name === filename) {
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) {
        return compressed;
      }
      if (method === 8) {
        return inflateRawSync(compressed);
      }
      throw new Error(`Nieobsługiwana metoda kompresji ZIP: ${method}.`);
    }

    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`Nie znaleziono ${filename} w DOCX.`);
}

function decodeXml(text: string) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeText(text: string) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function parseParagraphs(documentXml: string): ParsedParagraph[] {
  const paragraphs: ParsedParagraph[] = [];
  const paragraphPattern = /<w:p\b[\s\S]*?<\/w:p>/g;
  const runPattern = /<w:r\b[\s\S]*?<\/w:r>/g;
  const textPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let paragraphMatch: RegExpExecArray | null;

  while ((paragraphMatch = paragraphPattern.exec(documentXml)) !== null) {
    const paragraphXml = paragraphMatch[0]
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, '\n');
    const fragments: string[] = [];
    let firstTextRunXml = '';
    let runMatch: RegExpExecArray | null;

    while ((runMatch = runPattern.exec(paragraphXml)) !== null) {
      const runXml = runMatch[0];
      const runFragments: string[] = [];
      let textMatch: RegExpExecArray | null;
      textPattern.lastIndex = 0;
      while ((textMatch = textPattern.exec(runXml)) !== null) {
        runFragments.push(decodeXml(textMatch[1]));
      }
      const runText = runFragments.join('');
      if (runText.trim() && !firstTextRunXml) {
        firstTextRunXml = runXml;
      }
      fragments.push(runText);
    }

    const text = normalizeText(fragments.join(''));
    if (!text) {
      continue;
    }

    const boldTags = firstTextRunXml.match(/<w:b\b[^>]*\/?>/g) ?? [];
    const isBold = boldTags.some((tag) => !/w:val="0"/.test(tag));

    paragraphs.push({
      text,
      isBold,
      hasDrawing: /<w:drawing\b|<w:pict\b/.test(paragraphXml),
      before: Number(paragraphXml.match(/<w:spacing\b[^>]*w:before="([^"]+)"/)?.[1] ?? 0),
      left: Number(paragraphXml.match(/<w:ind\b[^>]*w:left="([^"]+)"/)?.[1] ?? 0),
    });
  }

  return paragraphs;
}

function isQuestionParagraph(paragraph: ParsedParagraph, number: number) {
  const hasQuestionIndent = number === 1 ? paragraph.left < 600 : paragraph.left < 320;
  const hasQuestionSpacing = paragraph.before === 0 || paragraph.before >= 250 || (paragraph.before >= 240 && paragraph.left < 50);
  return paragraph.isBold && hasQuestionIndent && hasQuestionSpacing;
}

function splitInlineAnswer(text: string) {
  const inline = text.match(/^(.*?\?)\s+[-–]\s*(.+)$/);
  if (!inline) {
    return { question: text, answer: '' };
  }
  return {
    question: normalizeText(inline[1]),
    answer: normalizeText(inline[2]),
  };
}

function parseQuestions(paragraphs: ParsedParagraph[]) {
  const questions: ParsedQuestion[] = [];
  let current: ParsedQuestion | null = null;
  let expectedNumber = 1;

  for (const paragraph of paragraphs) {
    if (/^PYTANIA\s+NA\s+LICENCJAT/i.test(paragraph.text)) {
      continue;
    }

    const match = paragraph.text.match(/^(\d{1,3})\.\s*(.+)$/);
    const number = match ? Number(match[1]) : null;
    if (process.env.DEBUG_DOCX === '1' && match && number !== null && number >= 10 && number <= 15) {
      console.log(
        JSON.stringify({
          number,
          expectedNumber,
          text: paragraph.text.slice(0, 80),
          isBold: paragraph.isBold,
          before: paragraph.before,
          left: paragraph.left,
          isQuestionParagraph: isQuestionParagraph(paragraph, number),
        }),
      );
    }
    const isQuestionStart = Boolean(match && number === expectedNumber && number <= 101 && isQuestionParagraph(paragraph, number));

    if (isQuestionStart && match && number !== null) {
      if (current) {
        questions.push(current);
      }
      const split = splitInlineAnswer(match[2]);
      current = {
        number,
        question: split.question,
        answer: split.answer,
        warnings: [],
      };
      if (paragraph.hasDrawing) {
        current.warnings.push('Akapit pytania zawiera element graficzny w DOCX; wymaga kontroli.');
      }
      expectedNumber += 1;
      continue;
    }

    if (current) {
      current.answer = normalizeText([current.answer, paragraph.text].filter(Boolean).join('\n'));
      if (paragraph.hasDrawing) {
        current.warnings.push('Odpowiedź zawiera element graficzny w DOCX; tekst zachowano, obraz wymaga kontroli.');
      }
    }
  }

  if (current) {
    questions.push(current);
  }

  return questions.filter((question) => question.number <= 101);
}

function buildValidationReport(questions: QuestionRecord[]) {
  const numbers = questions.map((question) => question.number);
  const counts = new Map<number, number>();
  numbers.forEach((number) => counts.set(number, (counts.get(number) ?? 0) + 1));
  const missingQuestionNumbers = [];

  for (let number = 1; number <= 1000; number += 1) {
    if (!counts.has(number)) {
      missingQuestionNumbers.push(number);
    }
  }

  return {
    totalQuestionsFound: questions.length,
    firstQuestionNumber: numbers.length ? Math.min(...numbers) : null,
    lastQuestionNumber: numbers.length ? Math.max(...numbers) : null,
    missingQuestionNumbers,
    duplicateQuestionNumbers: [...counts.entries()].filter(([, count]) => count > 1).map(([number]) => number),
    questionsWithEmptyAnswers: questions.filter((question) => !question.answer.trim()).map((question) => question.number),
    questionsWithSuspiciouslyShortAnswers: questions
      .filter((question) => question.answer.trim().length > 0 && question.answer.trim().length < 35)
      .map((question) => question.number),
    questionsWithUnusuallyLongAnswers: questions.filter((question) => question.answer.length > 7000).map((question) => question.number),
    questionsSpanningMultiplePages: questions
      .filter((question) => question.sourcePageStart !== question.sourcePageEnd)
      .map((question) => question.number),
    questionsWithExtractionWarnings: questions
      .filter((question) => question.extractionWarnings.length > 0)
      .map((question) => ({ number: question.number, warnings: question.extractionWarnings })),
    samples: Array.from({ length: 10 }, (_, index) => {
      const start = index * 100 + 1;
      const end = start + 99;
      const sample = questions.find((question) => question.number >= start && question.number <= end);
      return {
        range: `${start}–${end}`,
        number: sample?.number ?? null,
        question: sample?.question ?? '',
        answerPreview: sample?.answer.slice(0, 360) ?? '',
      };
    }),
  };
}

const docx = fs.readFileSync(docxPath);
const documentXml = readZipEntry(docx, 'word/document.xml').toString('utf8');
const parsed = parseQuestions(parseParagraphs(documentXml));
const parsedByNumber = new Map(parsed.map((question) => [question.number, question]));
const existing = JSON.parse(fs.readFileSync(questionsPath, 'utf8')) as QuestionRecord[];

const updated = existing.map((question) => {
  const replacement = parsedByNumber.get(question.number);
  if (!replacement) {
    return question;
  }

  const warnings = [...new Set(replacement.warnings)];
  return {
    ...question,
    question: replacement.question,
    answer: replacement.answer,
    ...chapterFor(question.number),
    verified: warnings.length === 0,
    extractionWarnings: warnings,
  };
});

fs.writeFileSync(questionsPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
fs.writeFileSync(reportPath, `${JSON.stringify(buildValidationReport(updated), null, 2)}\n`, 'utf8');

const missingInDocx = Array.from({ length: 101 }, (_, index) => index + 1).filter((number) => !parsedByNumber.has(number));

console.log(`Zaktualizowano rekordów: ${parsed.length}`);
console.log(`Pierwszy numer z DOCX: ${parsed[0]?.number ?? 'brak'}`);
console.log(`Ostatni numer z DOCX: ${parsed.at(-1)?.number ?? 'brak'}`);
console.log(`Brakujące w DOCX z zakresu 1-101: ${missingInDocx.length ? missingInDocx.join(', ') : 'brak'}`);
console.log(`Pytania z ostrzeżeniami z DOCX: ${parsed.filter((question) => question.warnings.length > 0).length}`);
