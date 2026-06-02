import type { FlashcardRating, QuestionProgress, QuizRating } from '../types';
import { createDefaultProgress } from './progressStorage';

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(8, 0, 0, 0);
  return date.toISOString();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function applyFlashcardRating(progress: QuestionProgress | undefined, rating: FlashcardRating): QuestionProgress {
  const current = progress ?? createDefaultProgress();
  const next: QuestionProgress = {
    ...current,
    attempts: current.attempts + 1,
    lastReviewedAt: new Date().toISOString(),
  };

  if (rating === 'again') {
    next.status = 'learning';
    next.incorrect += 1;
    next.hardCount += 1;
    next.streakCorrect = 0;
    next.intervalDays = 0;
    next.easeFactor = clamp(next.easeFactor - 0.25, 1.3, 3.2);
    next.confidence = clamp(next.confidence - 18, 0, 100);
    next.nextReviewAt = addDays(0);
    return next;
  }

  if (rating === 'hard') {
    next.status = 'learning';
    next.incorrect += 1;
    next.hardCount += 1;
    next.streakCorrect = 0;
    next.intervalDays = Math.max(1, Math.round(next.intervalDays * 0.8));
    next.easeFactor = clamp(next.easeFactor - 0.1, 1.3, 3.2);
    next.confidence = clamp(next.confidence + 6, 0, 100);
    next.nextReviewAt = addDays(1);
    return next;
  }

  const multiplier = rating === 'easy' ? next.easeFactor + 0.7 : next.easeFactor;
  next.correct += 1;
  next.streakCorrect += 1;
  next.intervalDays = next.intervalDays === 0 ? (rating === 'easy' ? 4 : 2) : Math.ceil(next.intervalDays * multiplier);
  next.easeFactor = clamp(next.easeFactor + (rating === 'easy' ? 0.2 : 0.05), 1.3, 3.2);
  next.confidence = clamp(next.confidence + (rating === 'easy' ? 22 : 14), 0, 100);
  next.status = next.streakCorrect >= 3 && next.intervalDays >= 7 ? 'mastered' : 'learning';
  next.nextReviewAt = addDays(next.intervalDays);
  return next;
}

export function applyQuizRating(progress: QuestionProgress | undefined, rating: QuizRating): QuestionProgress {
  if (rating === 'wrong') {
    return applyFlashcardRating(progress, 'again');
  }
  if (rating === 'partial') {
    const next = applyFlashcardRating(progress, 'hard');
    next.partial += 1;
    return next;
  }
  return applyFlashcardRating(progress, 'good');
}
