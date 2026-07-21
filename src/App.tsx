import {
  ArrowDown, ArrowUp, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Edit3, NotebookPen, Pause, Play, Plus, Timer,
} from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import {
  addTask, daysBetween, localDate, moveTask, setTaskCompleted, setTaskPriority,
  startTimer, stopTimer, updateDailyTaskNotes, updateTaskText, type Priority,
} from './db'
import { type TodayTask, useTodayTasks } from './useTodayTasks'
import MilestonesPage from './MilestonesPage'
import DeadlinesPage from './DeadlinesPage'
import { translator, type Language, type Translate } from './i18n'
import { useDeadlineReminders } from './useDeadlineReminders'

type Page = 'daily' | 'milestones' | 'deadlines'
type Theme = 'green' | 'blue' | 'coral' | 'violet'
const demoMode = import.meta.env.VITE_DEMO === 'true'

const priorities: Priority[] = ['high', 'medium', 'low']

function elapsedSeconds(entry: TodayTask, now: number) {
  return entry.sessions.reduce((total, session) => {
    const end = session.endedAt ? new Date(session.endedAt).getTime() : now
    return total + Math.max(0, Math.floor((end - new Date(session.startedAt).getTime()) / 1000))
  }, 0)
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remaining = seconds % 60
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
}

function TaskRow({ entry, index, count, today, now, t, readOnly }: {
  entry: TodayTask
  index: number
  count: number
  today: string
  now: number
  t: Translate
  readOnly: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.task.text)
  const [notes, setNotes] = useState(entry.notes ?? entry.task.notes ?? '')
  const [notesOpen, setNotesOpen] = useState(false)
  const editRef = useRef<HTMLInputElement>(null)
  const isRunning = entry.sessions.some((session) => !session.endedAt)
  const carriedDays = daysBetween(entry.task.createdOn, today)

  useEffect(() => {
    if (editing) editRef.current?.select()
  }, [editing])
  useEffect(() => setNotes(entry.notes ?? entry.task.notes ?? ''), [entry.notes, entry.task.notes])

  async function saveEdit() {
    if (draft.trim()) await updateTaskText(entry.taskId, draft)
    else setDraft(entry.task.text)
    setEditing(false)
  }

  function submitEdit(event: FormEvent) {
    event.preventDefault()
    void saveEdit()
  }

  return (
    <article className={`task-row priority-${entry.priority} ${entry.completed ? 'task-completed' : ''}`}>
      <button
        aria-checked={entry.completed}
        aria-label={entry.completed ? t('completed') : t('completed')}
        className={`task-check ${entry.completed ? 'task-check-done' : ''}`}
        disabled={readOnly}
        onClick={() => void setTaskCompleted(entry.id!, !entry.completed)}
        role="checkbox"
      >
        {entry.completed && <Check size={14} strokeWidth={2.5} />}
      </button>

      <div className="task-content">
        {editing ? (
          <form className="edit-form" onSubmit={submitEdit}>
            <input
              aria-label="Modifier la tâche"
              onBlur={() => void saveEdit()}
              onChange={(event) => setDraft(event.target.value)}
              ref={editRef}
              value={draft}
            />
          </form>
        ) : (
          <button className="task-title" onDoubleClick={() => !readOnly && setEditing(true)} type="button">
            {entry.task.text}
          </button>
        )}
        <div className="task-meta">
          {carriedDays > 0 && <span>{t('carried')} {carriedDays} {t(carriedDays === 1 ? 'day' : 'days')}</span>}
          <span className={isRunning ? 'time-running' : ''}>
            <Timer size={13} /> {formatDuration(elapsedSeconds(entry, now))}
          </span>
        </div>
      </div>

      <div className="task-actions">
        <select
          aria-label="Priority"
          className="priority-select"
          disabled={readOnly}
          onChange={(event) => void setTaskPriority(entry.id!, event.target.value as Priority)}
          value={entry.priority}
        >
          {priorities.map((priority) => <option key={priority} value={priority}>{t(priority)}</option>)}
        </select>
        <button className="action-button" disabled={readOnly || index === 0} onClick={() => void moveTask(entry.id!, -1)} title={t('moveUp')}>
          <ArrowUp size={17} />
        </button>
        <button className="action-button" disabled={readOnly || index === count - 1} onClick={() => void moveTask(entry.id!, 1)} title={t('moveDown')}>
          <ArrowDown size={17} />
        </button>
        <button className="action-button" disabled={readOnly} onClick={() => setEditing(true)} title={t('edit')}>
          <Edit3 size={16} />
        </button>
        <button className={`action-button ${notesOpen ? 'action-button-active' : ''}`} onClick={() => setNotesOpen((open) => !open)} title={t('notes')}>
          <NotebookPen size={16} />
        </button>
        <button
          className={`timer-button ${isRunning ? 'timer-button-active' : ''}`}
          disabled={readOnly || entry.completed}
          onClick={() => void (isRunning ? stopTimer(entry.taskId) : startTimer(entry.taskId))}
          title={isRunning ? t('pause') : t('startTimer')}
        >
          {isRunning ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
      </div>
      {notesOpen && (
        <div className="task-notes-panel">
          <NotebookPen size={15} />
          <textarea
            aria-label={t('notes')}
            onBlur={() => void updateDailyTaskNotes(entry.id!, notes)}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t('taskNotes')}
            readOnly={readOnly}
            rows={4}
            value={notes}
          />
        </div>
      )}
    </article>
  )
}

function DailyPage({ language, t, readOnly }: { language: Language; t: Translate; readOnly: boolean }) {
  const todayKey = localDate()
  const [selectedDate, setSelectedDate] = useState(todayKey)
  const { tasks, loading } = useTodayTasks(readOnly, selectedDate)
  const [newTask, setNewTask] = useState('')
  const [saving, setSaving] = useState(false)
  const [now, setNow] = useState(Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const completedCount = tasks.filter((entry) => entry.completed).length
  const runningTask = tasks.find((entry) => entry.sessions.some((session) => !session.endedAt))
  const isToday = selectedDate === todayKey
  const selectedDay = new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : language === 'ar' ? 'ar-MA' : 'en', {
    weekday: 'long', month: 'long', day: 'numeric',
  }).format(new Date(`${selectedDate}T12:00:00`))

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!newTask.trim() || saving || loading || !isToday) return
    setSaving(true)
    try {
      await addTask(newTask)
      setNewTask('')
      inputRef.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  function shiftDate(days: number) {
    const date = new Date(`${selectedDate}T12:00:00`)
    date.setDate(date.getDate() + days)
    const nextDate = localDate(date)
    if (nextDate <= todayKey) setSelectedDate(nextDate)
  }

  return (
      <main className="main-content">
        <div className="day-heading">
          <div>
            <p className="eyebrow">{isToday ? t('today') : t('history')}</p>
            <h1>{selectedDay}</h1>
          </div>
          {tasks.length > 0 && <span className="day-progress">{completedCount} / {tasks.length} {t('done')}</span>}
        </div>

        <div className="calendar-toolbar" aria-label={t('chooseDate')}>
          <button aria-label={t('previousDay')} onClick={() => shiftDate(-1)} title={t('previousDay')}><ChevronLeft size={17} /></button>
          <label>
            <CalendarDays size={16} />
            <input aria-label={t('chooseDate')} max={todayKey} onChange={(event) => setSelectedDate(event.target.value)} type="date" value={selectedDate} />
          </label>
          <button aria-label={t('nextDay')} disabled={isToday} onClick={() => shiftDate(1)} title={t('nextDay')}><ChevronRight size={17} /></button>
          {!isToday && <button className="today-button" onClick={() => setSelectedDate(todayKey)}>{t('backToday')}</button>}
        </div>

        {runningTask && (
          <div className="focus-strip" role="status">
            <span className="pulse-dot" />
            <span className="focus-label">{t('running')}</span>
            <strong>{runningTask.task.text}</strong>
            <span className="focus-time">{formatDuration(elapsedSeconds(runningTask, now))}</span>
            <button aria-label={t('pause')} onClick={() => void stopTimer(runningTask.taskId)}><Pause size={15} fill="currentColor" /></button>
          </div>
        )}

        <form className="new-task-form" onSubmit={handleSubmit}>
          <input
            aria-label="Nouvelle tâche"
            autoFocus
            className="new-task-input"
            disabled={readOnly || !isToday || saving || loading}
            onChange={(event) => setNewTask(event.target.value)}
            placeholder={t('newTask')}
            ref={inputRef}
            value={newTask}
          />
          <button aria-label={t('addTask')} disabled={readOnly || !isToday || !newTask.trim() || saving || loading} type="submit">
            <Plus size={20} />
          </button>
        </form>

        <section aria-labelledby="tasks-heading">
          <h2 id="tasks-heading" className="sr-only">Tâches du jour</h2>
          {!loading && tasks.length === 0 ? (
            <div className="empty-state"><CheckCircle2 size={28} /><p>{isToday ? t('clearDay') : t('noHistory')}</p></div>
          ) : (
            <div className="task-list">
              {tasks.map((entry, index) => (
                <TaskRow count={tasks.length} entry={entry} index={index} key={entry.id} now={now} readOnly={readOnly || !isToday} t={t} today={selectedDate} />
              ))}
            </div>
          )}
        </section>
      </main>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>('daily')
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem('daybook-language') as Language) || 'en')
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('daybook-theme') as Theme) || 'green')
  const t = translator(language)
  useDeadlineReminders()

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
  }, [language])

  function changeLanguage(value: Language) {
    setLanguage(value)
    localStorage.setItem('daybook-language', value)
  }

  function changeTheme(value: Theme) {
    setTheme(value)
    localStorage.setItem('daybook-theme', value)
  }

  return (
    <div className="app-shell" data-theme={theme} dir={language === 'ar' ? 'rtl' : 'ltr'} lang={language}>
      <header className="topbar">
        {demoMode && <div className="demo-ribbon">{t('demo')}</div>}
        <div className="topbar-inner">
          <button className="brand" onClick={() => setPage('daily')}><CheckCircle2 size={21} /> Daybook</button>
          <div className="header-tools">
            <nav aria-label="Navigation">
              <button className={`nav-item ${page === 'daily' ? 'nav-item-active' : ''}`} onClick={() => setPage('daily')}>{t('daily')}</button>
              <button className={`nav-item ${page === 'milestones' ? 'nav-item-active' : ''}`} onClick={() => setPage('milestones')}>{t('milestones')}</button>
              <button className={`nav-item ${page === 'deadlines' ? 'nav-item-active' : ''}`} onClick={() => setPage('deadlines')}>{t('deadlines')}</button>
            </nav>
            <div className="preference-controls">
              <select aria-label={t('theme')} onChange={(event) => changeTheme(event.target.value as Theme)} value={theme}>
                <option value="green">● {t('green')}</option><option value="blue">● {t('blue')}</option>
                <option value="coral">● {t('coral')}</option><option value="violet">● {t('violet')}</option>
              </select>
              <select aria-label={t('language')} onChange={(event) => changeLanguage(event.target.value as Language)} value={language}>
                <option value="en">English</option><option value="fr">Français</option><option value="ar">العربية</option>
              </select>
            </div>
          </div>
        </div>
      </header>
      {page === 'daily' && <DailyPage language={language} readOnly={demoMode} t={t} />}
      {page === 'milestones' && <MilestonesPage language={language} readOnly={demoMode} t={t} />}
      {page === 'deadlines' && <DeadlinesPage t={t} />}
    </div>
  )
}
