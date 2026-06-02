import type { AppSettings, ProgressMap, QuestionProgress } from '../types';

const progressKey = 'fiszki-licencjat-progress-v1';
const settingsKey = 'fiszki-licencjat-settings-v1';

export const defaultSettings: AppSettings = {
  examDate: '',
  dailyNewGoal: 20,
  dailyReviewGoal: 60,
};

export function createDefaultProgress(): QuestionProgress {
  return {
    status: 'new',
    attempts: 0,
    correct: 0,
    incorrect: 0,
    partial: 0,
    confidence: 0,
    lastReviewedAt: null,
    nextReviewAt: null,
    easeFactor: 2.5,
    intervalDays: 0,
    streakCorrect: 0,
    starred: false,
    needsVerification: false,
    notes: '',
    hardCount: 0,
  };
}

export function loadProgress(): ProgressMap {
  try {
    return JSON.parse(localStorage.getItem(progressKey) ?? '{}') as ProgressMap;
  } catch {
    return {};
  }
}

export function saveProgress(progress: ProgressMap) {
  localStorage.setItem(progressKey, JSON.stringify(progress));
}

export function loadSettings(): AppSettings {
  try {
    return { ...defaultSettings, ...(JSON.parse(localStorage.getItem(settingsKey) ?? '{}') as Partial<AppSettings>) };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}

export function clearProgress() {
  localStorage.removeItem(progressKey);
}

export function isDue(progress: QuestionProgress | undefined) {
  if (!progress?.nextReviewAt) {
    return false;
  }
  return new Date(progress.nextReviewAt).getTime() <= Date.now();
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
