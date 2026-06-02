import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

type TextItem = {
  str: string;
  width: number;
  transform: number[];
  hasEOL?: boolean;
};

type Line = {
  text: string;
  page: number;
  x: number;
  y: number;
};

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

type ValidationReport = {
  totalQuestionsFound: number;
  firstQuestionNumber: number | null;
  lastQuestionNumber: number | null;
  missingQuestionNumbers: number[];
  duplicateQuestionNumbers: number[];
  questionsWithEmptyAnswers: number[];
  questionsWithSuspiciouslyShortAnswers: number[];
  questionsWithUnusuallyLongAnswers: number[];
  questionsSpanningMultiplePages: number[];
  questionsWithExtractionWarnings: Array<{ number: number; warnings: string[] }>;
  samples: Array<{
    range: string;
    number: number | null;
    question: string;
    answerPreview: string;
  }>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outputQuestions = path.join(rootDir, 'src', 'data', 'questions.json');
const outputReport = path.join(rootDir, 'src', 'data', 'validation-report.json');
const pdfPath = process.argv[2];

if (!pdfPath) {
  throw new Error('Podaj ścieżkę do PDF, np. npm run extract -- "C:/ścieżka/plik.pdf"');
}

const dottedQuestionStartPattern = /^(\d{1,4})\.\s*(.*)$/;
const undottedQuestionStartPattern = /^(\d{1,4})\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ])(.*)$/;
const rangedQuestionStartPattern = /^(\d{1,4})\s*[-–]\s*(\d{1,4})\.\s*(.*)$/;
const togetherQuestionStartPattern = /^(\d{1,4})\s+i\s+(\d{1,4})\s+razem\s+[–-]\s*(.*)$/i;
const bulletLikePattern = /^(?:[•◦\-–]|\d{1,2}\.\s|[a-z]\)\s)/i;
const headerPattern = /^PYTANIA\s+NA\s+LICENCJAT\s+1-1000$/i;

type QuestionMarker = {
  numbers: number[];
  primaryNumber: number;
  remainder: string;
  warnings: string[];
};

function chapterFor(number: number) {
  const index = Math.ceil(number / 100);
  const start = (index - 1) * 100 + 1;
  const end = index * 100;
  return {
    chapter: `Część ${index}`,
    chapterRange: `${start}–${end}`,
  };
}

function normalizeLineText(text: string) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?%)\]])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\bfi\s+(?=[a-ząćęłńóśźż])/gi, 'fi')
    .trim();
}

function normalizeAnswer(text: string) {
  return text
    .split('\n')
    .map((line) => normalizeLineText(line))
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function lineFromItems(items: TextItem[]) {
  const sorted = [...items]
    .filter((item) => item.str.trim() !== '')
    .sort((a, b) => a.transform[4] - b.transform[4]);

  let text = '';
  let previousEnd: number | null = null;
  let firstX = 0;
  let y = 0;

  sorted.forEach((item, index) => {
    const x = item.transform[4];
    const width = item.width ?? 0;
    if (index === 0) {
      firstX = x;
      y = item.transform[5];
    }

    if (previousEnd !== null) {
      const gap = x - previousEnd;
      if (gap > 2.2 && !text.endsWith(' ')) {
        text += ' ';
      }
    }

    text += item.str;
    previousEnd = x + width;
  });

  return {
    text: normalizeLineText(text),
    x: firstX,
    y,
  };
}

function pageLines(items: TextItem[], pageNumber: number) {
  const groups: TextItem[][] = [];

  [...items]
    .filter((item) => item.str.trim() !== '')
    .sort((a, b) => {
      const yDiff = b.transform[5] - a.transform[5];
      return Math.abs(yDiff) > 2 ? yDiff : a.transform[4] - b.transform[4];
    })
    .forEach((item) => {
      const y = item.transform[5];
      const group = groups.find((candidate) => Math.abs(candidate[0].transform[5] - y) < 2);
      if (group) {
        group.push(item);
      } else {
        groups.push([item]);
      }
    });

  return groups
    .map((group) => ({ ...lineFromItems(group), page: pageNumber }))
    .filter((line) => line.text && !headerPattern.test(line.text) && !/^\d+$/.test(line.text));
}

function verticalGap(previous: Line, current: Line) {
  if (previous.page !== current.page) {
    return 18;
  }
  return Math.abs(previous.y - current.y);
}

function splitQuestionAndAnswer(lines: Line[], firstLineRemainder: string) {
  const questionLines = [firstLineRemainder.trim()];
  const answerLines: string[] = [];
  let cursor = 1;
  const warnings: string[] = [];

  while (cursor < lines.length) {
    const previous = lines[cursor - 1];
    const current = lines[cursor];
    const gap = verticalGap(previous, current);
    const currentText = current.text.trim();
    const currentQuestion = questionLines.join(' ');
    const lineLooksLikeWrappedQuestion =
      current.x > lines[0].x + 8 || /^[a-ząćęłńóśźż]/.test(currentText);
    const probablyContinuation =
      gap <= 28 &&
      !bulletLikePattern.test(currentText) &&
      !/^Odpowied/i.test(currentText) &&
      !/[?:.!]$/.test(currentQuestion) &&
      lineLooksLikeWrappedQuestion;

    if (!probablyContinuation) {
      break;
    }

    questionLines.push(currentText);
    cursor += 1;
  }

  for (let index = cursor; index < lines.length; index += 1) {
    answerLines.push(lines[index].text);
  }

  const question = normalizeLineText(questionLines.join(' '));
  let answer = normalizeAnswer(answerLines.join('\n'));
  const explicitAnswer = answer.match(/^Odpowiedź\s*:\s*/i);
  if (explicitAnswer) {
    answer = answer.replace(/^Odpowiedź\s*:\s*/i, '').trim();
  }

  if (!answer) {
    warnings.push('Nie wykryto odpowiedzi po tekście pytania.');
  }

  if (!explicitAnswer && answer && answer.length < 35) {
    warnings.push('Odpowiedź jest bardzo krótka; wymaga ręcznego sprawdzenia.');
  }

  if (!/[?]$/.test(question) && question.length < 12) {
    warnings.push('Tekst pytania jest nietypowo krótki.');
  }

  return { question, answer, warnings };
}

function parseQuestionMarker(text: string, lastQuestionNumber: number): QuestionMarker | null {
  const ranged = text.match(rangedQuestionStartPattern);
  if (ranged) {
    const start = Number(ranged[1]);
    const end = Number(ranged[2]);
    if (start <= end && end <= 1000) {
      return {
        numbers: Array.from({ length: end - start + 1 }, (_, index) => start + index),
        primaryNumber: start,
        remainder: ranged[3],
        warnings: [`PDF łączy numery ${start}–${end} w jednym wpisie; odpowiedź wymaga ręcznej kontroli.`],
      };
    }
  }

  const together = text.match(togetherQuestionStartPattern);
  if (together) {
    const first = Number(together[1]);
    const second = Number(together[2]);
    if (first < second && second <= 1000) {
      return {
        numbers: [first, second],
        primaryNumber: first,
        remainder: together[3],
        warnings: [`PDF opisuje pytania ${first} i ${second} jako wspólny wpis; odpowiedź wymaga ręcznej kontroli.`],
      };
    }
  }

  const dotted = text.match(dottedQuestionStartPattern);
  if (dotted) {
    const number = Number(dotted[1]);
    if (number > 1000) {
      const corrected = number - 1000;
      if (corrected > lastQuestionNumber && corrected <= 1000) {
        return {
          numbers: [corrected],
          primaryNumber: corrected,
          remainder: dotted[2],
          warnings: [`Numer w PDF wygląda jak "${number}", przypisano do oczekiwanego zakresu jako ${corrected}.`],
        };
      }
    }

    return {
      numbers: [number],
      primaryNumber: number,
      remainder: dotted[2],
      warnings: [],
    };
  }

  const undotted = text.match(undottedQuestionStartPattern);
  if (undotted) {
    const number = Number(undotted[1]);
    return {
      numbers: [number],
      primaryNumber: number,
      remainder: undotted[2],
      warnings: [`Numer ${number} nie ma kropki w PDF; wykryto go po układzie strony.`],
    };
  }

  return null;
}

function isTopLevelQuestion(marker: QuestionMarker, line: Line, lastQuestionNumber: number) {
  const number = marker.primaryNumber;
  const marginLimit = number < 100 ? 65 : 82;
  return number > lastQuestionNumber && number <= 1000 && line.x <= marginLimit;
}

function findInlineQuestionBoundary(text: string, lastQuestionNumber: number) {
  const inlinePattern = /(\d{3,4})\.\s*/g;
  let match: RegExpExecArray | null;
  while ((match = inlinePattern.exec(text)) !== null) {
    const number = Number(match[1]);
    if (match.index > 0 && number > lastQuestionNumber && number <= 1000) {
      return match.index;
    }
  }
  return -1;
}

async function pagesWithImages(pdf: Awaited<ReturnType<typeof getDocument>['promise']>) {
  const imagePages = new Set<number>();
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const operatorList = await page.getOperatorList();
    if (
      operatorList.fnArray.some((fn) =>
        [
          OPS.paintImageXObject,
          OPS.paintInlineImageXObject,
          OPS.paintImageMaskXObject,
        ].includes(fn),
      )
    ) {
      imagePages.add(pageNumber);
    }
  }
  return imagePages;
}

function buildValidationReport(questions: QuestionRecord[]): ValidationReport {
  const numbers = questions.map((question) => question.number);
  const counts = new Map<number, number>();
  numbers.forEach((number) => counts.set(number, (counts.get(number) ?? 0) + 1));
  const first = numbers.length ? Math.min(...numbers) : null;
  const last = numbers.length ? Math.max(...numbers) : null;
  const missing: number[] = [];

  for (let number = 1; number <= 1000; number += 1) {
    if (!counts.has(number)) {
      missing.push(number);
    }
  }

  const samples = Array.from({ length: 10 }, (_, index) => {
    const start = index * 100 + 1;
    const end = start + 99;
    const sample = questions.find((question) => question.number >= start && question.number <= end);
    return {
      range: `${start}–${end}`,
      number: sample?.number ?? null,
      question: sample?.question ?? '',
      answerPreview: sample?.answer.slice(0, 360) ?? '',
    };
  });

  return {
    totalQuestionsFound: questions.length,
    firstQuestionNumber: first,
    lastQuestionNumber: last,
    missingQuestionNumbers: missing,
    duplicateQuestionNumbers: [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([number]) => number),
    questionsWithEmptyAnswers: questions
      .filter((question) => question.answer.trim().length === 0)
      .map((question) => question.number),
    questionsWithSuspiciouslyShortAnswers: questions
      .filter((question) => question.answer.trim().length > 0 && question.answer.trim().length < 35)
      .map((question) => question.number),
    questionsWithUnusuallyLongAnswers: questions
      .filter((question) => question.answer.length > 7000)
      .map((question) => question.number),
    questionsSpanningMultiplePages: questions
      .filter((question) => question.sourcePageStart !== question.sourcePageEnd)
      .map((question) => question.number),
    questionsWithExtractionWarnings: questions
      .filter((question) => question.extractionWarnings.length > 0)
      .map((question) => ({ number: question.number, warnings: question.extractionWarnings })),
    samples,
  };
}

async function extract() {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await getDocument({ data, disableFontFace: true }).promise;
  const allLines: Line[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    allLines.push(...pageLines(textContent.items as TextItem[], pageNumber));
  }

  const imagePages = await pagesWithImages(pdf);
  const blocks: Array<{
    numbers: number[];
    lines: Line[];
    firstLineRemainder: string;
    markerWarnings: string[];
  }> = [];
  let current: {
    numbers: number[];
    lines: Line[];
    firstLineRemainder: string;
    markerWarnings: string[];
  } | null = null;
  let lastQuestionNumber = 0;

  for (const originalLine of allLines) {
    let line = originalLine;
    const inlineBoundary = current ? findInlineQuestionBoundary(line.text, lastQuestionNumber) : -1;
    if (inlineBoundary > 0) {
      const before = line.text.slice(0, inlineBoundary).trim();
      const after = line.text.slice(inlineBoundary).trim();
      if (before) {
        current?.lines.push({ ...line, text: before });
      }
      line = { ...line, text: after };
    }

    const marker = parseQuestionMarker(line.text, lastQuestionNumber);

    if (marker && isTopLevelQuestion(marker, line, lastQuestionNumber)) {
      if (current) {
        blocks.push(current);
      }
      current = {
        numbers: marker.numbers,
        lines: [line],
        firstLineRemainder: marker.remainder,
        markerWarnings: marker.warnings,
      };
      lastQuestionNumber = Math.max(...marker.numbers);
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    blocks.push(current);
  }

  const questions = blocks.flatMap((block): QuestionRecord[] => {
    const { question, answer, warnings } = splitQuestionAndAnswer(block.lines, block.firstLineRemainder);
    const sourcePageStart = block.lines[0].page;
    const sourcePageEnd = block.lines[block.lines.length - 1].page;
    const pageRange = Array.from(
      { length: sourcePageEnd - sourcePageStart + 1 },
      (_, index) => sourcePageStart + index,
    );
    const imageWarning = pageRange.some((pageNumber) => imagePages.has(pageNumber))
      ? ['Zakres źródłowy zawiera element graficzny; tekst wokół niego zachowano, ale obraz wymaga ręcznej kontroli.']
      : [];
    const lengthWarnings = [
      answer.length > 7000 ? 'Odpowiedź jest nietypowo długa; sprawdź, czy nie połączono pytań.' : '',
      question.length < 8 ? 'Pytanie jest nietypowo krótkie.' : '',
    ].filter(Boolean);
    const extractionWarnings = [...block.markerWarnings, ...warnings, ...imageWarning, ...lengthWarnings];

    return block.numbers.map((number) => ({
      id: `q${String(number).padStart(4, '0')}`,
      number,
      question,
      answer,
      sourcePageStart,
      sourcePageEnd,
      ...chapterFor(number),
      verified: extractionWarnings.length === 0,
      extractionWarnings,
    }));
  });

  const shared334Warning = 'PDF zawiera wspólny nagłówek "334-335."; wpis zachowano dla obu numerów i oznaczono do kontroli.';
  const question335 = questions.find((question) => question.number === 335);
  if (question335 && !questions.some((question) => question.number === 334)) {
    questions.push({
      ...question335,
      id: 'q0334',
      number: 334,
      ...chapterFor(334),
      verified: false,
      extractionWarnings: Array.from(new Set([...question335.extractionWarnings, shared334Warning])),
    });
    question335.verified = false;
    question335.extractionWarnings = Array.from(new Set([...question335.extractionWarnings, shared334Warning]));
    questions.sort((a, b) => a.number - b.number);
  }

  const report = buildValidationReport(questions);

  fs.mkdirSync(path.dirname(outputQuestions), { recursive: true });
  fs.writeFileSync(outputQuestions, `${JSON.stringify(questions, null, 2)}\n`, 'utf8');
  fs.writeFileSync(outputReport, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Zapisano ${questions.length} pytań do ${outputQuestions}`);
  console.log(`Raport walidacji: ${outputReport}`);
  console.log(`Brakujące numery: ${report.missingQuestionNumbers.length}`);
  console.log(`Duplikaty: ${report.duplicateQuestionNumbers.length}`);
  console.log(`Pozycje z ostrzeżeniami: ${report.questionsWithExtractionWarnings.length}`);
}

extract().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
