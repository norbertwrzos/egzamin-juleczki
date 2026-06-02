export type QuestionRecord = {
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

export type QuestionStatus = 'new' | 'learning' | 'mastered';

export type QuestionProgress = {
  status: QuestionStatus;
  attempts: number;
  correct: number;
  incorrect: number;
  partial: number;
  confidence: number;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
  easeFactor: number;
  intervalDays: number;
  streakCorrect: number;
  starred: boolean;
  needsVerification: boolean;
  notes: string;
  hardCount: number;
};

export type ProgressMap = Record<string, QuestionProgress>;

export type AppSettings = {
  examDate: string;
  dailyNewGoal: number;
  dailyReviewGoal: number;
};

export type Chapter = {
  id: string;
  name: string;
  range: string;
  start: number;
  end: number;
  virtual?: boolean;
};

export type FlashcardRating = 'again' | 'hard' | 'good' | 'easy';
export type QuizRating = 'wrong' | 'partial' | 'correct';
