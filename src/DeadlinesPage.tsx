import { liveQuery } from 'dexie'
import {
  Bell, CalendarDays, ChevronDown, ChevronUp, ExternalLink, FileUp, Loader2,
  Plus, RotateCcw, Star, Trash2,
} from 'lucide-react'
import { Fragment, type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  addDeadline, CLOSED_STATUSES, db, deleteDeadline, EVENT_TYPES, SUBMISSION_STATUSES,
  updateDeadline, type Deadline, type DeadlineCategory, type EventType, type SubmissionStatus,
} from './db'
import { extractPdf, extractUrl, type ImportedEvent } from './eventImport'
import type { MessageKey, Translate } from './i18n'
import { decryptLocal } from './localCrypto'

type SortKey = 'date' | 'eventDate' | 'priority' | 'status' | 'name'

const emptyDraft = (category: DeadlineCategory): ImportedEvent => ({
  category, eventType: 'conference', name: '', date: '', eventDate: '',
  location: '', presentationFormat: '', fee: '', organizer: '', source: '',
})

const TYPE_LABELS: Record<EventType, MessageKey> = {
  conference: 'typeConference', workshop: 'typeWorkshop', 'summer-school': 'typeSummerSchool',
  symposium: 'typeSymposium', seminar: 'typeSeminar', congress: 'typeCongress',
  journal: 'typeJournal', other: 'typeOther',
}

const STATUS_LABELS: Record<SubmissionStatus, MessageKey> = {
  interested: 'statusInterested', planning: 'statusPlanning', drafting: 'statusDrafting',
  submitted: 'statusSubmitted', accepted: 'statusAccepted', rejected: 'statusRejected',
  presented: 'statusPresented',
}

/** Jours restants avant une date, en tenant compte du fuseau local. */
function daysUntil(date: string): number | null {
  if (!date) return null
  const target = new Date(`${date}T12:00:00`).getTime()
  if (Number.isNaN(target)) return null
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  return Math.round((target - today.getTime()) / 86_400_000)
}

function DueBadge({ date, t }: { date: string; t: Translate }) {
  const days = daysUntil(date)
  if (days === null) return <span className="due-badge due-none">{t('unsetLabel')}</span>
  if (days < 0) return <span className="due-badge due-past">{Math.abs(days)} {t('daysLeft')} · {t('overdue')}</span>
  if (days === 0) return <span className="due-badge due-now">{t('dueToday')}</span>
  return <span className={`due-badge ${days <= 14 ? 'due-soon' : 'due-far'}`}>{days} {t('daysLeft')}</span>
}

/** Priorité de 0 à 5, modifiable au clic. Cliquer l'étoile courante remet à zéro. */
function PriorityStars({ value, onChange, label }: { value: number; onChange: (next: number) => void; label: string }) {
  return (
    <span aria-label={label} className="priority-stars" role="group">
      {[1, 2, 3, 4, 5].map((level) => (
        <button
          aria-label={`${label} ${level}`}
          aria-pressed={value >= level}
          className={value >= level ? 'star-on' : 'star-off'}
          key={level}
          onClick={() => onChange(value === level ? 0 : level)}
          type="button"
        >
          <Star size={14} fill={value >= level ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  )
}

export default function DeadlinesPage({ t }: { t: Translate }) {
  const [deadlines, setDeadlines] = useState<Deadline[]>([])
  const [draft, setDraft] = useState<ImportedEvent>(() => emptyDraft('publication'))
  const [kind, setKind] = useState('abstract-submission')
  const [url, setUrl] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === 'undefined' ? 'denied' : Notification.permission)

  const [categoryFilter, setCategoryFilter] = useState<DeadlineCategory | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<SubmissionStatus | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<EventType | 'all'>('all')
  const [minPriority, setMinPriority] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const records = await db.deadlines.orderBy('date').toArray()
      return Promise.all(records.map(async (record) => ({
        ...record,
        name: await decryptLocal(record.name),
        location: await decryptLocal(record.location),
        presentationFormat: await decryptLocal(record.presentationFormat),
        fee: await decryptLocal(record.fee),
        organizer: await decryptLocal(record.organizer ?? ''),
        source: await decryptLocal(record.source),
      })))
    }).subscribe({ next: setDeadlines, error: console.error })
    return () => subscription.unsubscribe()
  }, [])

  const visible = useMemo(() => {
    const filtered = deadlines.filter((item) =>
      (categoryFilter === 'all' || item.category === categoryFilter)
      && (statusFilter === 'all' || item.status === statusFilter)
      && (typeFilter === 'all' || item.eventType === typeFilter)
      && (item.priority ?? 0) >= minPriority)

    const direction = sortAsc ? 1 : -1
    return filtered.sort((a, b) => {
      if (sortKey === 'priority') return ((a.priority ?? 0) - (b.priority ?? 0)) * direction
      if (sortKey === 'name') return a.name.localeCompare(b.name) * direction
      if (sortKey === 'status') return SUBMISSION_STATUSES.indexOf(a.status) - SUBMISSION_STATUSES.indexOf(b.status) * direction
      // Les enregistrements sans date passent en dernier, quel que soit le sens.
      const left = (sortKey === 'eventDate' ? a.eventDate : a.date) || '9999'
      const right = (sortKey === 'eventDate' ? b.eventDate : b.date) || '9999'
      return left.localeCompare(right) * direction
    })
  }, [deadlines, categoryFilter, statusFilter, typeFilter, minPriority, sortKey, sortAsc])

  const activeCount = useMemo(
    () => deadlines.filter((item) => !CLOSED_STATUSES.includes(item.status)).length,
    [deadlines],
  )

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((value) => !value)
    else { setSortKey(key); setSortAsc(true) }
  }

  function resetFilters() {
    setCategoryFilter('all'); setStatusFilter('all'); setTypeFilter('all'); setMinPriority(0)
  }

  function applyImport(result: ImportedEvent) {
    setDraft(result)
    setKind(result.category === 'publication' ? 'abstract-submission' : result.category === 'conference' ? 'presentation-submission' : 'planned-participation')
    setImportMessage(t('reviewImport'))
    setFormOpen(true)
  }

  // Messages explicites : sans eux, un échec est indiscernable d'un autre.
  function explain(error: unknown, fallback: string) {
    const code = error instanceof Error ? error.message : ''
    const known: Record<string, string> = {
      'pdf-too-large': 'This PDF is too large (limit 15 MB). Try a smaller file.',
      'pdf-empty-file': 'This file appears to be empty.',
      'pdf-needs-gemini': 'PDF reading is unavailable right now (extraction service not configured).',
      'pdf-unreadable': 'The content of this PDF could not be interpreted. Please enter the information below.',
      'invalid-url': 'This address is not valid.',
      'fetch-failed': 'This page could not be reached. It may require a login.',
      'empty-content': 'No readable content was found.',
    }
    return known[code] ?? `${fallback}${code ? ` (${code})` : ''}`
  }

  async function importFromUrl(event: FormEvent) {
    event.preventDefault()
    if (!url.trim()) return
    setExtracting(true); setImportMessage('')
    try {
      applyImport(await extractUrl(url.trim()))
    } catch (error) {
      setImportMessage(explain(error, 'This page could not be read automatically. You can still enter its information below.'))
      setFormOpen(true)
    } finally {
      setExtracting(false)
    }
  }

  async function importFromPdf(file?: File) {
    if (!file) return
    setExtracting(true); setImportMessage('')
    try {
      applyImport(await extractPdf(file))
    } catch (error) {
      setImportMessage(explain(error, 'The PDF could not be read. Please enter the information below.'))
      setFormOpen(true)
    } finally {
      setExtracting(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim() || !draft.date) return
    await addDeadline({
      ...draft,
      category: draft.category,
      eventType: draft.eventType as EventType,
      kind,
      status: 'interested',
      priority: 0,
    })
    setDraft(emptyDraft(draft.category))
    setImportMessage('')
    setFormOpen(false)
  }

  async function enableNotifications() {
    if (typeof Notification === 'undefined') return
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
    window.dispatchEvent(new Event('daybook-notification-permission'))
    if (permission === 'granted') {
      void import('./push').then(({ enablePushReminders }) => enablePushReminders()).catch(() => undefined)
    }
  }

  const sortArrow = (key: SortKey) => sortKey !== key ? null : sortAsc ? <ChevronUp size={13} /> : <ChevronDown size={13} />

  return (
    <main className="main-content deadlines-page">
      <div className="deadlines-heading">
        <div>
          <p className="eyebrow">Schedule</p>
          <h1>{t('events')}</h1>
          <p className="heading-subtitle">{visible.length} {t('matchingEvents')} · {activeCount} {t('activeCount')}</p>
        </div>
        <button className={`reminder-control ${notificationPermission === 'granted' ? 'reminder-enabled' : ''}`} onClick={() => void enableNotifications()}>
          <Bell size={17} />
          <span>{notificationPermission === 'granted' ? t('remindersEnabled') : t('enableReminders')}<small>{t('reminders')}</small></span>
        </button>
      </div>

      <section className="import-panel" aria-labelledby="import-title">
        <div className="import-head"><FileUp size={18} /><h2 id="import-title">{t('importEvent')}</h2></div>
        <form onSubmit={importFromUrl}>
          <input disabled={extracting} onChange={(event) => setUrl(event.target.value)} placeholder={t('linkPlaceholder')} type="url" value={url} />
          <button disabled={extracting || !url.trim()} type="submit"><ExternalLink size={15} /> {t('extract')}</button>
          <label className={`pdf-button ${extracting ? 'is-disabled' : ''}`}>
            <FileUp size={15} /> {t('choosePdf')}
            <input accept="application/pdf" disabled={extracting} onChange={(event) => void importFromPdf(event.target.files?.[0])} type="file" />
          </label>
        </form>

        {extracting && (
          <div className="extracting-strip" role="status" aria-live="polite">
            <Loader2 className="spin" size={16} />
            <span><strong>{t('extractingLabel')}</strong><small>{t('extractingHint')}</small></span>
          </div>
        )}
        {!extracting && importMessage && <p className="import-message" role="status">{importMessage}</p>}
      </section>

      <div className="filter-bar">
        <span className="filter-label">{t('filters')}</span>
        <select aria-label={t('deadlines')} onChange={(event) => setCategoryFilter(event.target.value as DeadlineCategory | 'all')} value={categoryFilter}>
          <option value="all">{t('allTypes')}</option>
          <option value="publication">{t('publications')}</option>
          <option value="conference">{t('conferences')}</option>
          <option value="training">{t('trainings')}</option>
        </select>
        <select aria-label={t('statusLabel')} onChange={(event) => setStatusFilter(event.target.value as SubmissionStatus | 'all')} value={statusFilter}>
          <option value="all">{t('allStatuses')}</option>
          {SUBMISSION_STATUSES.map((status) => <option key={status} value={status}>{t(STATUS_LABELS[status])}</option>)}
        </select>
        <select aria-label={t('eventTypeLabel')} onChange={(event) => setTypeFilter(event.target.value as EventType | 'all')} value={typeFilter}>
          <option value="all">{t('allTypes')}</option>
          {EVENT_TYPES.map((type) => <option key={type} value={type}>{t(TYPE_LABELS[type])}</option>)}
        </select>
        <select aria-label={t('priorityLabel')} onChange={(event) => setMinPriority(Number(event.target.value))} value={minPriority}>
          <option value={0}>{t('allPriorities')}</option>
          {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{'★'.repeat(level)}</option>)}
        </select>
        <button className="reset-filters" onClick={resetFilters} type="button"><RotateCcw size={14} /> {t('resetFilters')}</button>
        <button className="add-event-button" onClick={() => setFormOpen((open) => !open)} type="button">
          <Plus size={15} /> {t('saveEvent')}
        </button>
      </div>

      {formOpen && (
        <form className="event-form" onSubmit={save}>
          <h2>{t('addEventTitle')}</h2>
          <div className="event-form-grid">
            <label className="span-2"><span>{t('eventName')}</span>
              <input onChange={(event) => setDraft({ ...draft, name: event.target.value })} required value={draft.name} />
            </label>
            <label><span>{t('deadlineDate')}</span>
              <input onChange={(event) => setDraft({ ...draft, date: event.target.value })} required type="date" value={draft.date} />
            </label>
            <label><span>{t('eventStartDate')}</span>
              <input onChange={(event) => setDraft({ ...draft, eventDate: event.target.value })} type="date" value={draft.eventDate} />
            </label>
            <label><span>{t('deadlines')}</span>
              <select onChange={(event) => setDraft({ ...draft, category: event.target.value as DeadlineCategory })} value={draft.category}>
                <option value="publication">{t('publications')}</option>
                <option value="conference">{t('conferences')}</option>
                <option value="training">{t('trainings')}</option>
              </select>
            </label>
            <label><span>{t('eventTypeLabel')}</span>
              <select onChange={(event) => setDraft({ ...draft, eventType: event.target.value })} value={draft.eventType}>
                {EVENT_TYPES.map((type) => <option key={type} value={type}>{t(TYPE_LABELS[type])}</option>)}
              </select>
            </label>
            <label><span>{t('abstractSubmission')}</span>
              <select onChange={(event) => setKind(event.target.value)} value={kind}>
                {draft.category === 'publication' && <><option value="abstract-submission">{t('abstractSubmission')}</option><option value="full-paper-submission">{t('fullPaperSubmission')}</option></>}
                {draft.category === 'conference' && <><option value="presentation-submission">{t('presentationSubmission')}</option><option value="presentation-finalization">{t('presentationFinalization')}</option></>}
                {draft.category === 'training' && <option value="planned-participation">{t('plannedParticipation')}</option>}
              </select>
            </label>
            <label><span>{t('location')}</span>
              <input onChange={(event) => setDraft({ ...draft, location: event.target.value })} value={draft.location} />
            </label>
            <label><span>{t('format')}</span>
              <select onChange={(event) => setDraft({ ...draft, presentationFormat: event.target.value })} value={draft.presentationFormat}>
                <option value="">{t('unsetLabel')}</option>
                <option value="in-person">{t('inPerson')}</option>
                <option value="online">{t('online')}</option>
                <option value="hybrid">{t('hybrid')}</option>
              </select>
            </label>
            <label><span>{t('organizer')}</span>
              <input onChange={(event) => setDraft({ ...draft, organizer: event.target.value })} value={draft.organizer} />
            </label>
            <label><span>{t('fee')}</span>
              <input onChange={(event) => setDraft({ ...draft, fee: event.target.value })} value={draft.fee} />
            </label>
            <label className="span-2"><span>{t('source')}</span>
              <input onChange={(event) => setDraft({ ...draft, source: event.target.value })} value={draft.source} />
            </label>
          </div>
          <div className="event-form-actions">
            <button className="secondary" onClick={() => { setFormOpen(false); setImportMessage('') }} type="button">{t('cancel')}</button>
            <button className="save-event-button" disabled={!draft.name.trim() || !draft.date} type="submit"><Plus size={16} /> {t('saveEvent')}</button>
          </div>
        </form>
      )}

      <div className="event-table-wrapper">
        {!visible.length ? (
          <div className="empty-state"><CalendarDays size={25} /><p>{t('noEvents')}</p></div>
        ) : (
          <table className="event-table">
            <thead>
              <tr>
                <th className="col-priority"><button onClick={() => toggleSort('priority')} type="button">{t('priorityLabel')} {sortArrow('priority')}</button></th>
                <th><button onClick={() => toggleSort('name')} type="button">{t('eventName')} {sortArrow('name')}</button></th>
                <th className="col-type">{t('eventTypeLabel')}</th>
                <th className="col-date"><button onClick={() => toggleSort('date')} type="button">{t('deadlineDate')} {sortArrow('date')}</button></th>
                <th className="col-date"><button onClick={() => toggleSort('eventDate')} type="button">{t('eventStartDate')} {sortArrow('eventDate')}</button></th>
                <th className="col-status"><button onClick={() => toggleSort('status')} type="button">{t('statusLabel')} {sortArrow('status')}</button></th>
                <th className="col-actions" aria-label={t('delete')} />
              </tr>
            </thead>
            <tbody>
              {visible.map((event) => (
                <Fragment key={event.id}>
                  <tr className={`event-row status-${event.status}`}>
                    <td className="col-priority">
                      <PriorityStars label={t('priorityLabel')} onChange={(next) => void updateDeadline(event.id!, { priority: next })} value={event.priority ?? 0} />
                    </td>
                    <td>
                      <button className="event-name" onClick={() => setExpanded(expanded === event.id ? null : event.id!)} type="button">
                        {event.name}
                      </button>
                      <small className="event-sub">{event.location || t('unsetLabel')}{event.organizer ? ` · ${event.organizer}` : ''}</small>
                    </td>
                    <td className="col-type"><span className="type-chip">{t(TYPE_LABELS[event.eventType] ?? 'typeOther')}</span></td>
                    <td className="col-date"><span className="date-value">{event.date || t('unsetLabel')}</span><DueBadge date={event.date} t={t} /></td>
                    <td className="col-date"><span className="date-value">{event.eventDate || t('unsetLabel')}</span></td>
                    <td className="col-status">
                      <select
                        aria-label={t('statusLabel')}
                        className={`status-select status-${event.status}`}
                        onChange={(change) => void updateDeadline(event.id!, { status: change.target.value as SubmissionStatus })}
                        value={event.status}
                      >
                        {SUBMISSION_STATUSES.map((status) => <option key={status} value={status}>{t(STATUS_LABELS[status])}</option>)}
                      </select>
                    </td>
                    <td className="col-actions">
                      <button aria-label={t('delete')} className="delete-button" onClick={() => void deleteDeadline(event.id!)} type="button"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                  {expanded === event.id && (
                    <tr className="event-details">
                      <td colSpan={7}>
                        <dl>
                          <div><dt>{t('format')}</dt><dd>{event.presentationFormat || t('unsetLabel')}</dd></div>
                          <div><dt>{t('fee')}</dt><dd>{event.fee || t('unsetLabel')}</dd></div>
                          <div><dt>{t('organizer')}</dt><dd>{event.organizer || t('unsetLabel')}</dd></div>
                          <div><dt>{t('location')}</dt><dd>{event.location || t('unsetLabel')}</dd></div>
                          <div className="span-all"><dt>{t('source')}</dt><dd>
                            {event.source
                              ? <a href={event.source} rel="noreferrer noopener" target="_blank">{t('openSource')} <ExternalLink size={12} /></a>
                              : t('unsetLabel')}
                          </dd></div>
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  )
}
