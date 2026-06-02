import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type QuestionRecord = {
  number: number;
  question: string;
  answer: string;
  sourcePageStart: number;
  sourcePageEnd: number;
  extractionWarnings: string[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const questionsPath = path.join(rootDir, 'src', 'data', 'questions.json');
const reportPath = path.join(rootDir, 'src', 'data', 'validation-report.json');

const questions = JSON.parse(fs.readFileSync(questionsPath, 'utf8')) as QuestionRecord[];
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as {
  totalQuestionsFound: number;
  missingQuestionNumbers: number[];
  duplicateQuestionNumbers: number[];
  questionsWithEmptyAnswers: number[];
};

const problems: string[] = [];
if (report.totalQuestionsFound !== questions.length) {
  problems.push('Liczba pytań w raporcie nie zgadza się z questions.json.');
}
if (report.duplicateQuestionNumbers.length > 0) {
  problems.push(`Duplikaty numerów: ${report.duplicateQuestionNumbers.join(', ')}`);
}
if (report.questionsWithEmptyAnswers.length > 0) {
  problems.push(`Puste odpowiedzi: ${report.questionsWithEmptyAnswers.join(', ')}`);
}

questions.forEach((question) => {
  if (!Number.isInteger(question.number)) {
    problems.push(`Nieprawidłowy numer pytania: ${String(question.number)}`);
  }
  if (question.sourcePageStart > question.sourcePageEnd) {
    problems.push(`Nieprawidłowy zakres stron dla pytania ${question.number}.`);
  }
  if (!question.question.trim()) {
    problems.push(`Puste pytanie ${question.number}.`);
  }
});

console.log(`Pytań w danych: ${questions.length}`);
console.log(`Brakujące numery: ${report.missingQuestionNumbers.length}`);
console.log(`Duplikaty: ${report.duplicateQuestionNumbers.length}`);
console.log(`Puste odpowiedzi: ${report.questionsWithEmptyAnswers.length}`);

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
}
