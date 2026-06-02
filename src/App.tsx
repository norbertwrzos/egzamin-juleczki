import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Download,
  FileQuestion,
  Flag,
  Home,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Star,
  Upload,
  XCircle,
} from 'lucide-react';
import { ChangeEvent, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import questionsData from './data/questions.json';
import validationReport from './data/validation-report.json';
import { chapterForQuestion, chapters, questionsForChapter } from './lib/chapters';
import {
  clearProgress,
  createDefaultProgress,
  defaultSettings,
  downloadJson,
  isDue,
  loadProgress,
  loadSettings,
  saveProgress,
  saveSettings,
} from './lib/progressStorage';
import { applyFlashcardRating, applyQuizRating } from './lib/spacedRepetition';
import type { AppSettings, FlashcardRating, ProgressMap, QuestionProgress, QuestionRecord, QuizRating } from './types';

const questions = questionsData as QuestionRecord[];

type Screen = 'dashboard' | 'chapters' | 'flashcards' | 'quiz' | 'bank' | 'mistakes' | 'stats' | 'settings';
type StatusFilter = 'all' | 'new' | 'learning' | 'mastered' | 'due' | 'starred' | 'needsVerification';
type DashboardStats = {
  learned: number;
  mastered: number;
  due: number;
  reviewedToday: number;
  streak: number;
  accuracy: number;
  progress: number;
};

const navItems: Array<{ id: Screen; label: string; icon: typeof Home }> = [
  { id: 'dashboard', label: 'Panel główny', icon: Home },
  { id: 'chapters', label: 'Rozdziały', icon: BookOpen },
  { id: 'flashcards', label: 'Fiszki', icon: Sparkles },
  { id: 'quiz', label: 'Test', icon: FileQuestion },
  { id: 'bank', label: 'Bank pytań', icon: Search },
  { id: 'mistakes', label: 'Błędy', icon: AlertTriangle },
  { id: 'stats', label: 'Statystyki', icon: BarChart3 },
  { id: 'settings', label: 'Ustawienia', icon: Settings },
];

function pct(value: number, total: number) {
  return total === 0 ? 0 : Math.round((value / total) * 100);
}

function todayKey(dateIso: string | null) {
  if (!dateIso) {
    return '';
  }
  return new Date(dateIso).toISOString().slice(0, 10);
}

function getProgress(progress: ProgressMap, id: string) {
  return progress[id] ?? createDefaultProgress();
}

function statusLabel(progress: QuestionProgress) {
  if (progress.status === 'mastered') return 'Opanowane';
  if (progress.status === 'learning') return 'W trakcie';
  return 'Nowe';
}

function badgeClass(progress: QuestionProgress) {
  if (progress.status === 'mastered') return 'badge badge-pink';
  if (progress.status === 'learning') return 'badge badge-gold';
  return 'badge badge-muted';
}

function exportName(prefix: string) {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.json`;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [progress, setProgress] = useState<ProgressMap>(() => loadProgress());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [chapterId, setChapterId] = useState('all');
  const [flashIndex, setFlashIndex] = useState(0);
  const [flashRevealed, setFlashRevealed] = useState(false);
  const [quizSize, setQuizSize] = useState('10');
  const [quizOptions, setQuizOptions] = useState({
    random: true,
    mistakes: false,
    starred: false,
    newOnly: false,
    dueOnly: false,
  });
  const [quizSession, setQuizSession] = useState<QuestionRecord[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswer, setQuizAnswer] = useState('');
  const [quizRevealed, setQuizRevealed] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [detailQuestion, setDetailQuestion] = useState<QuestionRecord | null>(null);

  function commitProgress(next: ProgressMap) {
    setProgress(next);
    saveProgress(next);
  }

  function updateQuestion(id: string, updater: (current: QuestionProgress) => QuestionProgress) {
    const next = { ...progress, [id]: updater(getProgress(progress, id)) };
    commitProgress(next);
  }

  const enriched = useMemo(
    () =>
      questions.map((question) => ({
        question,
        progress: getProgress(progress, question.id),
      })),
    [progress],
  );

  const overall = useMemo(() => {
    const learned = enriched.filter((item) => item.progress.attempts > 0).length;
    const mastered = enriched.filter((item) => item.progress.status === 'mastered').length;
    const due = enriched.filter((item) => isDue(item.progress)).length;
    const correct = enriched.reduce((sum, item) => sum + item.progress.correct, 0);
    const attempts = enriched.reduce(
      (sum, item) => sum + item.progress.correct + item.progress.incorrect + item.progress.partial,
      0,
    );
    const today = new Date().toISOString().slice(0, 10);
    const reviewedToday = enriched.filter((item) => todayKey(item.progress.lastReviewedAt) === today).length;
    const streak = computeStreak(enriched.map((item) => item.progress.lastReviewedAt).filter(Boolean) as string[]);

    return {
      learned,
      mastered,
      due,
      correct,
      attempts,
      reviewedToday,
      streak,
      accuracy: pct(correct, attempts),
      progress: pct(mastered, questions.length),
    };
  }, [enriched]);

  const chapterStats = useMemo(
    () =>
      chapters.map((chapter) => {
        const chapterQuestions = questionsForChapter(questions, chapter.id);
        const chapterProgress = chapterQuestions.map((question) => getProgress(progress, question.id));
        const mastered = chapterProgress.filter((item) => item.status === 'mastered').length;
        const learning = chapterProgress.filter((item) => item.status === 'learning').length;
        const fresh = chapterProgress.filter((item) => item.status === 'new').length;
        const due = chapterProgress.filter((item) => isDue(item)).length;
        const correct = chapterProgress.reduce((sum, item) => sum + item.correct, 0);
        const attempts = chapterProgress.reduce((sum, item) => sum + item.correct + item.incorrect + item.partial, 0);

        return {
          ...chapter,
          total: chapterQuestions.length,
          mastered,
          learning,
          fresh,
          due,
          accuracy: pct(correct, attempts),
          progress: pct(mastered, chapterQuestions.length),
        };
      }),
    [progress],
  );

  const activeChapterQuestions = useMemo(() => questionsForChapter(questions, chapterId), [chapterId]);
  const mistakeQuestions = useMemo(
    () =>
      questions.filter((question) => {
        const item = getProgress(progress, question.id);
        return item.incorrect > 0 || item.hardCount > 0;
      }),
    [progress],
  );

  const flashQuestions = useMemo(() => {
    const source = activeChapterQuestions.length ? activeChapterQuestions : questions;
    return [...source].sort((a, b) => {
      const progressA = getProgress(progress, a.id);
      const progressB = getProgress(progress, b.id);
      if (isDue(progressA) !== isDue(progressB)) return isDue(progressA) ? -1 : 1;
      if (progressA.status !== progressB.status) return progressA.status === 'new' ? -1 : 1;
      return a.number - b.number;
    });
  }, [activeChapterQuestions, progress]);

  const currentFlash = flashQuestions[flashIndex % Math.max(1, flashQuestions.length)];
  const currentQuiz = quizSession[quizIndex];

  function rateFlash(rating: FlashcardRating) {
    if (!currentFlash) return;
    updateQuestion(currentFlash.id, (current) => applyFlashcardRating(current, rating));
    setFlashRevealed(false);
    setFlashIndex((value) => Math.min(value + 1, Math.max(flashQuestions.length - 1, 0)));
  }

  function startQuiz(source = activeChapterQuestions) {
    let pool = [...source];
    if (quizOptions.mistakes) pool = pool.filter((question) => getProgress(progress, question.id).incorrect > 0);
    if (quizOptions.starred) pool = pool.filter((question) => getProgress(progress, question.id).starred);
    if (quizOptions.newOnly) pool = pool.filter((question) => getProgress(progress, question.id).status === 'new');
    if (quizOptions.dueOnly) pool = pool.filter((question) => isDue(progress[question.id]));
    if (quizOptions.random) pool = pool.sort(() => Math.random() - 0.5);
    const count = quizSize === 'all' ? pool.length : Number(quizSize);
    setQuizSession(pool.slice(0, count));
    setQuizIndex(0);
    setQuizAnswer('');
    setQuizRevealed(false);
  }

  function rateQuiz(rating: QuizRating) {
    if (!currentQuiz) return;
    updateQuestion(currentQuiz.id, (current) => applyQuizRating(current, rating));
    setQuizAnswer('');
    setQuizRevealed(false);
    setQuizIndex((value) => value + 1);
  }

  function handleSettings(next: AppSettings) {
    setSettings(next);
    saveSettings(next);
  }

  function importProgress(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result)) as ProgressMap;
        commitProgress(imported);
        event.target.value = '';
      } catch {
        alert('Nie udało się zaimportować pliku. Sprawdź, czy to poprawny JSON postępu.');
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">EJ</div>
          <div>
            <p className="text-sm font-semibold">Egzamin Juleczki</p>
            <p className="text-xs text-slate-500">1000 pytań egzaminacyjnych</p>
          </div>
        </div>
        <nav className="nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={screen === item.id ? 'nav-button active' : 'nav-button'} onClick={() => setScreen(item.id)}>
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="main-shell">
        {screen === 'dashboard' && (
          <Dashboard
            stats={overall}
            chapterStats={chapterStats}
            onStart={() => setScreen('flashcards')}
            onDue={() => {
              setChapterId('all');
              setScreen('flashcards');
            }}
            onQuiz={() => {
              startQuiz(questions);
              setScreen('quiz');
            }}
          />
        )}
        {screen === 'chapters' && (
          <ChaptersScreen
            stats={chapterStats}
            onAction={(chapter, action) => {
              setChapterId(chapter.id);
              if (action === 'learn' || action === 'review') setScreen('flashcards');
              if (action === 'test') setScreen('quiz');
              if (action === 'mistakes') setScreen('mistakes');
            }}
          />
        )}
        {screen === 'flashcards' && (
          <FlashcardsScreen
            chapterId={chapterId}
            setChapterId={setChapterId}
            questions={flashQuestions}
            current={currentFlash}
            index={flashIndex}
            revealed={flashRevealed}
            setRevealed={setFlashRevealed}
            progress={progress}
            updateQuestion={updateQuestion}
            rate={rateFlash}
          />
        )}
        {screen === 'quiz' && (
          <QuizScreen
            chapterId={chapterId}
            setChapterId={setChapterId}
            quizSize={quizSize}
            setQuizSize={setQuizSize}
            options={quizOptions}
            setOptions={setQuizOptions}
            session={quizSession}
            current={currentQuiz}
            index={quizIndex}
            answer={quizAnswer}
            setAnswer={setQuizAnswer}
            revealed={quizRevealed}
            setRevealed={setQuizRevealed}
            start={() => startQuiz()}
            rate={rateQuiz}
          />
        )}
        {screen === 'bank' && (
          <QuestionBank
            progress={progress}
            searchText={searchText}
            setSearchText={setSearchText}
            chapterId={chapterId}
            setChapterId={setChapterId}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            open={setDetailQuestion}
          />
        )}
        {screen === 'mistakes' && (
          <MistakesScreen
            questions={mistakeQuestions}
            progress={progress}
            startFlashcards={() => setScreen('flashcards')}
            startQuiz={() => {
              startQuiz(mistakeQuestions);
              setScreen('quiz');
            }}
          />
        )}
        {screen === 'stats' && <StatsScreen stats={overall} chapterStats={chapterStats} progress={progress} />}
        {screen === 'settings' && (
          <SettingsScreen
            settings={settings}
            setSettings={handleSettings}
            progress={progress}
            importProgress={importProgress}
            reset={() => {
              if (confirm('Czy na pewno zresetować cały postęp nauki?')) {
                clearProgress();
                commitProgress({});
              }
            }}
          />
        )}
      </main>

      {detailQuestion && (
        <QuestionDetail
          question={detailQuestion}
          progress={getProgress(progress, detailQuestion.id)}
          close={() => setDetailQuestion(null)}
          update={(updater) => updateQuestion(detailQuestion.id, updater)}
        />
      )}
    </div>
  );
}

function Dashboard({
  stats,
  chapterStats,
  onStart,
  onDue,
  onQuiz,
}: {
  stats: DashboardStats;
  chapterStats: Array<Record<string, number | string | boolean | undefined>>;
  onStart: () => void;
  onDue: () => void;
  onQuiz: () => void;
}) {
  const weakest = [...chapterStats]
    .filter((chapter) => chapter.id !== 'all')
    .sort((a, b) => Number(a.accuracy) - Number(b.accuracy))
    .slice(0, 3);

  return (
    <section className="space-y-6">
      <Header title="Panel główny" subtitle="Plan nauki, powtórki i gotowość do egzaminu w jednym miejscu." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Liczba pytań" value={questions.length} />
        <Metric label="Nauczone pytania" value={stats.learned} />
        <Metric label="Opanowane" value={stats.mastered} />
        <Metric label="Do powtórki dziś" value={stats.due} tone="gold" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="section-title">Postęp ogólny</h2>
              <p className="muted">Cel dzienny: {stats.reviewedToday} / {defaultSettings.dailyReviewGoal} powtórek</p>
            </div>
            <div className="action-row">
              <button className="primary" onClick={onStart}>Rozpocznij naukę</button>
              <button className="secondary" onClick={onDue}>Powtórki na dziś</button>
              <button className="secondary" onClick={onQuiz}>Test próbny</button>
            </div>
          </div>
          <ProgressBar value={stats.progress} />
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <MiniStat label="Skuteczność" value={`${stats.accuracy}%`} />
            <MiniStat label="Dni nauki z rzędu" value={stats.streak} />
            <MiniStat label="Dzisiejsza aktywność" value={stats.reviewedToday} />
          </div>
        </div>
        <div className="panel">
          <h2 className="section-title">Najsłabsze części</h2>
          <div className="mt-4 space-y-3">
            {weakest.map((chapter) => (
              <div key={String(chapter.id)} className="soft-row">
                <span>{chapter.name}</span>
                <strong>{chapter.accuracy}%</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="panel">
        <h2 className="section-title">Ostatnia aktywność</h2>
        <p className="empty">Twoje ostatnie powtórki pojawią się tutaj po rozpoczęciu nauki.</p>
      </div>
    </section>
  );
}

function ChaptersScreen({
  stats,
  onAction,
}: {
  stats: Array<Record<string, number | string | boolean | undefined>>;
  onAction: (chapter: { id: string }, action: 'learn' | 'review' | 'test' | 'mistakes') => void;
}) {
  return (
    <section className="space-y-6">
      <Header title="Rozdziały" subtitle="Zakresy są rozłączne; widok „Wszystkie pytania” jest tylko filtrem." />
      <div className="grid gap-4 xl:grid-cols-2">
        {stats.map((chapter) => (
          <div key={String(chapter.id)} className="panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{chapter.name}</h2>
                <p className="muted">Zakres {chapter.range} · {chapter.total} pytań</p>
              </div>
              <span className="badge badge-pink">{chapter.progress}%</span>
            </div>
            <ProgressBar value={Number(chapter.progress)} />
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
              <MiniStat label="Opanowane" value={chapter.mastered} />
              <MiniStat label="W trakcie" value={chapter.learning} />
              <MiniStat label="Nowe" value={chapter.fresh} />
              <MiniStat label="Dziś" value={chapter.due} />
              <MiniStat label="Skuteczność" value={`${chapter.accuracy}%`} />
            </div>
            <div className="action-row mt-4">
              <button className="primary" onClick={() => onAction({ id: String(chapter.id) }, 'learn')}>Ucz się</button>
              <button className="secondary" onClick={() => onAction({ id: String(chapter.id) }, 'review')}>Powtórz</button>
              <button className="secondary" onClick={() => onAction({ id: String(chapter.id) }, 'test')}>Test</button>
              <button className="secondary" onClick={() => onAction({ id: String(chapter.id) }, 'mistakes')}>Błędy</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FlashcardsScreen(props: {
  chapterId: string;
  setChapterId: (id: string) => void;
  questions: QuestionRecord[];
  current: QuestionRecord | undefined;
  index: number;
  revealed: boolean;
  setRevealed: (value: boolean) => void;
  progress: ProgressMap;
  updateQuestion: (id: string, updater: (current: QuestionProgress) => QuestionProgress) => void;
  rate: (rating: FlashcardRating) => void;
}) {
  const currentProgress = props.current ? getProgress(props.progress, props.current.id) : createDefaultProgress();
  return (
    <section className="space-y-6">
      <Header title="Fiszki" subtitle="Najpierw pytanie, potem ocena odpowiedzi i automatyczny termin powtórki." />
      <Toolbar chapterId={props.chapterId} setChapterId={props.setChapterId} />
      {!props.current ? (
        <EmptyState text="Brak pytań w wybranym zakresie." />
      ) : (
        <div className="study-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="badge badge-muted">Pytanie {props.current.number}</span>
            <span className="muted">Postęp sesji {Math.min(props.index + 1, props.questions.length)} / {props.questions.length}</span>
          </div>
          <h2 className="question-text">{props.current.question}</h2>
          <div className="flex flex-wrap gap-2">
            <button
              className="icon-button"
              title="Oznacz gwiazdką"
              onClick={() =>
                props.updateQuestion(props.current!.id, (item) => ({ ...item, starred: !item.starred }))
              }
            >
              <Star size={18} fill={currentProgress.starred ? 'currentColor' : 'none'} />
              Oznacz gwiazdką
            </button>
            <button
              className="icon-button"
              title="Do sprawdzenia"
              onClick={() =>
                props.updateQuestion(props.current!.id, (item) => ({ ...item, needsVerification: !item.needsVerification }))
              }
            >
              <Flag size={18} />
              Do sprawdzenia
            </button>
          </div>
          {!props.revealed ? (
            <button className="primary mt-4" onClick={() => props.setRevealed(true)}>Pokaż odpowiedź</button>
          ) : (
            <div className="answer-box">
              <h3>Odpowiedź z PDF</h3>
              <PreservedText text={props.current.answer} />
              <div className="rating-row">
                <button className="danger" onClick={() => props.rate('again')}>Nie wiem</button>
                <button className="warning" onClick={() => props.rate('hard')}>Trudne</button>
                <button className="success" onClick={() => props.rate('good')}>Dobrze</button>
                <button className="primary" onClick={() => props.rate('easy')}>Łatwe</button>
              </div>
            </div>
          )}
          {!props.current.verified && <Warning warnings={props.current.extractionWarnings} />}
        </div>
      )}
    </section>
  );
}

function QuizScreen(props: {
  chapterId: string;
  setChapterId: (id: string) => void;
  quizSize: string;
  setQuizSize: (value: string) => void;
  options: { random: boolean; mistakes: boolean; starred: boolean; newOnly: boolean; dueOnly: boolean };
  setOptions: (value: { random: boolean; mistakes: boolean; starred: boolean; newOnly: boolean; dueOnly: boolean }) => void;
  session: QuestionRecord[];
  current: QuestionRecord | undefined;
  index: number;
  answer: string;
  setAnswer: (value: string) => void;
  revealed: boolean;
  setRevealed: (value: boolean) => void;
  start: () => void;
  rate: (rating: QuizRating) => void;
}) {
  const completed = props.session.length > 0 && props.index >= props.session.length;
  return (
    <section className="space-y-6">
      <Header title="Test" subtitle="Wpisz własną odpowiedź, odsłoń wersję z PDF i oceń wynik samodzielnie." />
      <div className="panel grid gap-4 lg:grid-cols-3">
        <Toolbar chapterId={props.chapterId} setChapterId={props.setChapterId} compact />
        <label className="field">
          Liczba pytań
          <select value={props.quizSize} onChange={(event) => props.setQuizSize(event.target.value)}>
            {['10', '25', '50', '100', 'all'].map((size) => (
              <option key={size} value={size}>{size === 'all' ? 'wszystkie' : size}</option>
            ))}
          </select>
        </label>
        <div className="checks">
          {[
            ['random', 'Losowa kolejność'],
            ['mistakes', 'Tylko błędy'],
            ['starred', 'Tylko z gwiazdką'],
            ['newOnly', 'Tylko nowe'],
            ['dueOnly', 'Tylko do powtórki'],
          ].map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={props.options[key as keyof typeof props.options]}
                onChange={(event) => props.setOptions({ ...props.options, [key]: event.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        <button className="primary lg:col-span-3" onClick={props.start}>Rozpocznij test</button>
      </div>
      {completed && <EmptyState text="Test zakończony. Wyniki zostały zapisane w postępie nauki." />}
      {!completed && props.current && (
        <div className="study-card">
          <span className="badge badge-muted">Pytanie {props.index + 1} / {props.session.length}</span>
          <h2 className="question-text">{props.current.question}</h2>
          <textarea
            className="answer-input"
            value={props.answer}
            onChange={(event) => props.setAnswer(event.target.value)}
            placeholder="Wpisz swoją odpowiedź..."
          />
          {!props.revealed ? (
            <button className="primary" onClick={() => props.setRevealed(true)}>Pokaż odpowiedź</button>
          ) : (
            <div className="answer-box">
              <h3>Odpowiedź z PDF</h3>
              <PreservedText text={props.current.answer} />
              <div className="rating-row">
                <button className="danger" onClick={() => props.rate('wrong')}>Źle</button>
                <button className="warning" onClick={() => props.rate('partial')}>Częściowo</button>
                <button className="success" onClick={() => props.rate('correct')}>Dobrze</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function QuestionBank(props: {
  progress: ProgressMap;
  searchText: string;
  setSearchText: (value: string) => void;
  chapterId: string;
  setChapterId: (value: string) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (value: StatusFilter) => void;
  open: (question: QuestionRecord) => void;
}) {
  const filtered = questions
    .filter((question) => questionsForChapter([question], props.chapterId).length > 0)
    .filter((question) => {
      const text = `${question.question} ${question.answer}`.toLowerCase();
      return text.includes(props.searchText.toLowerCase());
    })
    .filter((question) => {
      const item = getProgress(props.progress, question.id);
      if (props.statusFilter === 'all') return true;
      if (props.statusFilter === 'due') return isDue(item);
      if (props.statusFilter === 'starred') return item.starred;
      if (props.statusFilter === 'needsVerification') return item.needsVerification || !question.verified;
      return item.status === props.statusFilter;
    });

  return (
    <section className="space-y-6">
      <Header title="Bank pytań" subtitle="Szukaj w pytaniach i odpowiedziach bez zmiany treści źródłowej." />
      <div className="panel grid gap-4 lg:grid-cols-3">
        <label className="field lg:col-span-1">
          Szukaj
          <input value={props.searchText} onChange={(event) => props.setSearchText(event.target.value)} placeholder="Fraza, numer albo temat" />
        </label>
        <Toolbar chapterId={props.chapterId} setChapterId={props.setChapterId} compact />
        <label className="field">
          Status
          <select value={props.statusFilter} onChange={(event) => props.setStatusFilter(event.target.value as StatusFilter)}>
            <option value="all">Wszystkie</option>
            <option value="new">Nowe</option>
            <option value="learning">W trakcie</option>
            <option value="mastered">Opanowane</option>
            <option value="due">Do powtórki</option>
            <option value="starred">Oznaczone gwiazdką</option>
            <option value="needsVerification">Do sprawdzenia</option>
          </select>
        </label>
      </div>
      <div className="question-list">
        {filtered.slice(0, 250).map((question) => {
          const item = getProgress(props.progress, question.id);
          return (
            <button key={question.id} className="question-row" onClick={() => props.open(question)}>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <strong>#{question.number}</strong>
                  <span className={badgeClass(item)}>{statusLabel(item)}</span>
                  {(!question.verified || item.needsVerification) && <span className="badge badge-red">Do sprawdzenia</span>}
                </div>
                <p>{question.question}</p>
                <small>{question.answer.slice(0, 180)}...</small>
              </div>
              <span className="muted">{chapterForQuestion(question.number).name}, str. {question.sourcePageStart}–{question.sourcePageEnd}</span>
            </button>
          );
        })}
        {filtered.length === 0 && <EmptyState text="Brak pytań pasujących do filtrów." />}
      </div>
    </section>
  );
}

function MistakesScreen({
  questions: items,
  progress,
  startFlashcards,
  startQuiz,
}: {
  questions: QuestionRecord[];
  progress: ProgressMap;
  startFlashcards: () => void;
  startQuiz: () => void;
}) {
  return (
    <section className="space-y-6">
      <Header title="Błędy" subtitle="Pytania oznaczone jako trudne albo ocenione błędnie." />
      <div className="panel flex flex-wrap items-center justify-between gap-3">
        <p className="muted">Liczba pytań do przepracowania: <strong>{items.length}</strong></p>
        <div className="action-row">
          <button className="primary" onClick={startFlashcards}>Powtórz jako fiszki</button>
          <button className="secondary" onClick={startQuiz}>Test z błędów</button>
        </div>
      </div>
      <div className="question-list">
        {items.map((question) => {
          const item = getProgress(progress, question.id);
          return (
            <div key={question.id} className="question-row static-row">
              <div>
                <strong>#{question.number} {question.question}</strong>
                <p className="muted">Błędne: {item.incorrect}, trudne: {item.hardCount}, seria poprawnych: {item.streakCorrect}</p>
              </div>
            </div>
          );
        })}
        {items.length === 0 && <EmptyState text="Nie ma jeszcze błędów. Bardzo przyjemny widok." />}
      </div>
    </section>
  );
}

function StatsScreen({
  stats,
  chapterStats,
  progress,
}: {
  stats: DashboardStats;
  chapterStats: Array<Record<string, number | string | boolean | undefined>>;
  progress: ProgressMap;
}) {
  const chartData = chapterStats.filter((chapter) => chapter.id !== 'all');
  const hardest = questions
    .map((question) => ({ question, progress: getProgress(progress, question.id) }))
    .sort((a, b) => b.progress.incorrect + b.progress.hardCount - (a.progress.incorrect + a.progress.hardCount))
    .slice(0, 8);
  return (
    <section className="space-y-6">
      <Header title="Statystyki" subtitle="Przegląd skuteczności, rozkładu powtórek i gotowości." />
      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Postęp ogólny" value={`${stats.progress}%`} />
        <Metric label="Skuteczność" value={`${stats.accuracy}%`} />
        <Metric label="Dni nauki z rzędu" value={stats.streak} />
        <Metric label="Szacowana gotowość" value={`${Math.round((stats.progress + stats.accuracy) / 2)}%`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title="Postęp według części">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="progress" name="Postęp">
                {chartData.map((entry) => <Cell key={String(entry.id)} fill={Number(entry.progress) > 60 ? '#db2777' : '#f472b6'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title="Skuteczność według części">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="accuracy" name="Skuteczność" stroke="#9f1239" strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
      <div className="panel">
        <h2 className="section-title">Najtrudniejsze pytania</h2>
        <div className="mt-3 space-y-2">
          {hardest.map(({ question, progress: item }) => (
            <div key={question.id} className="soft-row">
              <span>#{question.number} {question.question.slice(0, 90)}</span>
              <strong>{item.incorrect + item.hardCount}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SettingsScreen(props: {
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
  progress: ProgressMap;
  importProgress: (event: ChangeEvent<HTMLInputElement>) => void;
  reset: () => void;
}) {
  return (
    <section className="space-y-6">
      <Header title="Ustawienia" subtitle="Cele nauki, import, eksport i raport walidacji ekstrakcji." />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel space-y-4">
          <label className="field">Data egzaminu
            <input type="date" value={props.settings.examDate} onChange={(event) => props.setSettings({ ...props.settings, examDate: event.target.value })} />
          </label>
          <label className="field">Dzienny cel nowych pytań
            <input type="number" min="1" value={props.settings.dailyNewGoal} onChange={(event) => props.setSettings({ ...props.settings, dailyNewGoal: Number(event.target.value) })} />
          </label>
          <label className="field">Dzienny cel powtórek
            <input type="number" min="1" value={props.settings.dailyReviewGoal} onChange={(event) => props.setSettings({ ...props.settings, dailyReviewGoal: Number(event.target.value) })} />
          </label>
          <button className="danger" onClick={props.reset}><RotateCcw size={16} /> Zresetuj postęp</button>
        </div>
        <div className="panel space-y-3">
          <button className="secondary w-full" onClick={() => downloadJson(exportName('postep'), props.progress)}><Download size={16} /> Eksportuj postęp</button>
          <label className="secondary flex w-full cursor-pointer items-center justify-center gap-2">
            <Upload size={16} /> Importuj postęp
            <input className="hidden" type="file" accept="application/json" onChange={props.importProgress} />
          </label>
          <button className="secondary w-full" onClick={() => downloadJson(exportName('pytania'), questions)}><Download size={16} /> Eksportuj zestaw pytań JSON</button>
          <button className="secondary w-full" onClick={() => downloadJson(exportName('raport-walidacji'), validationReport)}><Download size={16} /> Eksportuj raport walidacji</button>
        </div>
      </div>
      <div className="panel">
        <h2 className="section-title">Raport walidacji ekstrakcji</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <MiniStat label="Znalezione pytania" value={validationReport.totalQuestionsFound} />
          <MiniStat label="Pierwszy numer" value={validationReport.firstQuestionNumber ?? 'brak'} />
          <MiniStat label="Ostatni numer" value={validationReport.lastQuestionNumber ?? 'brak'} />
          <MiniStat label="Do sprawdzenia" value={validationReport.questionsWithExtractionWarnings.length} />
        </div>
        <p className="mt-4 text-sm"><strong>Brakujące numery:</strong> {validationReport.missingQuestionNumbers.length ? validationReport.missingQuestionNumbers.join(', ') : 'brak'}</p>
        <p className="mt-2 text-sm"><strong>Duplikaty:</strong> {validationReport.duplicateQuestionNumbers.length ? validationReport.duplicateQuestionNumbers.join(', ') : 'brak'}</p>
      </div>
    </section>
  );
}

function QuestionDetail({
  question,
  progress,
  close,
  update,
}: {
  question: QuestionRecord;
  progress: QuestionProgress;
  close: () => void;
  update: (updater: (current: QuestionProgress) => QuestionProgress) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <article className="modal" onClick={(event) => event.stopPropagation()}>
        <button className="close-button" onClick={close}><XCircle size={22} /></button>
        <div className="flex flex-wrap gap-2">
          <span className="badge badge-muted">#{question.number}</span>
          <span className={badgeClass(progress)}>{statusLabel(progress)}</span>
          {(!question.verified || progress.needsVerification) && <span className="badge badge-red">Do sprawdzenia</span>}
        </div>
        <h2 className="question-text">{question.question}</h2>
        <PreservedText text={question.answer} />
        <p className="muted">Źródło: str. {question.sourcePageStart}–{question.sourcePageEnd}, {question.chapter}</p>
        <textarea
          className="answer-input"
          value={progress.notes}
          onChange={(event) => update((item) => ({ ...item, notes: event.target.value }))}
          placeholder="Notatki własne..."
        />
        <Warning warnings={question.extractionWarnings} />
      </article>
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header>
      <h1 className="page-title">{title}</h1>
      <p className="page-subtitle">{subtitle}</p>
    </header>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: 'gold' }) {
  return (
    <div className={tone === 'gold' ? 'metric metric-gold' : 'metric'}>
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number | boolean | undefined | null }) {
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <strong>{String(value ?? 0)}</strong>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress">
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function Toolbar({ chapterId, setChapterId, compact }: { chapterId: string; setChapterId: (id: string) => void; compact?: boolean }) {
  return (
    <label className={compact ? 'field' : 'field max-w-md'}>
      Wybierz rozdział
      <select value={chapterId} onChange={(event) => setChapterId(event.target.value)}>
        {chapters.map((chapter) => (
          <option key={chapter.id} value={chapter.id}>{chapter.name} ({chapter.range})</option>
        ))}
      </select>
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function PreservedText({ text }: { text: string }) {
  return <pre className="preserved">{text}</pre>;
}

function Warning({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="warning-box">
      <strong>Do sprawdzenia</strong>
      {warnings.map((warning) => <p key={warning}>{warning}</p>)}
    </div>
  );
}

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <h2 className="section-title">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function computeStreak(dates: string[]) {
  const days = new Set(dates.map((date) => new Date(date).toISOString().slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
