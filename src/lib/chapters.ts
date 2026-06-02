import type { Chapter, QuestionRecord } from '../types';

export const chapters: Chapter[] = [
  { id: 'all', name: 'Wszystkie pytania', range: '1–1000', start: 1, end: 1000, virtual: true },
  ...Array.from({ length: 10 }, (_, index) => {
    const start = index * 100 + 1;
    const end = start + 99;
    return {
      id: `part-${index + 1}`,
      name: `Część ${index + 1}`,
      range: `${start}–${end}`,
      start,
      end,
    };
  }),
];

export function questionsForChapter(questions: QuestionRecord[], chapterId: string) {
  const chapter = chapters.find((item) => item.id === chapterId) ?? chapters[0];
  return questions.filter((question) => question.number >= chapter.start && question.number <= chapter.end);
}

export function chapterForQuestion(number: number) {
  return chapters.find((chapter) => !chapter.virtual && number >= chapter.start && number <= chapter.end) ?? chapters[1];
}
