import { liveQuery } from 'dexie'
import { Bell, CalendarDays, ExternalLink, FileUp, MapPin, Plus, Trash2, WalletCards } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { addDeadline, db, deleteDeadline, type Deadline, type DeadlineCategory } from './db'
import { extractPdf, extractUrl, type ImportedEvent } from './eventImport'
import type { Translate } from './i18n'
import { decryptLocal } from './localCrypto'

const emptyDraft = (category: DeadlineCategory): ImportedEvent => ({
  category, name: '', date: '', location: '', presentationFormat: '', fee: '', source: '',
})

export default function DeadlinesPage({ t }: { t: Translate }) {
  const [category, setCategory] = useState<DeadlineCategory>('publication')
  const [deadlines, setDeadlines] = useState<Deadline[]>([])
  const [draft, setDraft] = useState<ImportedEvent>(() => emptyDraft('publication'))
  const [kind, setKind] = useState('abstract-submission')
  const [url, setUrl] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === 'undefined' ? 'denied' : Notification.permission)

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const records = await db.deadlines.orderBy('date').toArray()
      return Promise.all(records.map(async (record) => ({
        ...record,
        name: await decryptLocal(record.name),
        location: await decryptLocal(record.location),
        presentationFormat: await decryptLocal(record.presentationFormat),
        fee: await decryptLocal(record.fee),
        source: await decryptLocal(record.source),
      })))
    }).subscribe({
      next: setDeadlines,
      error: console.error,
    })
    return () => subscription.unsubscribe()
  }, [])

  const visible = useMemo(() => deadlines.filter((item) => item.category === category), [category, deadlines])
  const nextEvent = deadlines.find((item) => item.date >= new Date().toISOString().slice(0, 10))

  function switchCategory(next: DeadlineCategory) {
    setCategory(next)
    setDraft(emptyDraft(next))
    setKind(next === 'publication' ? 'abstract-submission' : next === 'conference' ? 'presentation-submission' : 'planned-participation')
    setImportMessage('')
  }

  function applyImport(result: ImportedEvent) {
    setCategory(result.category)
    setDraft(result)
    setKind(result.category === 'publication' ? 'abstract-submission' : result.category === 'conference' ? 'presentation-submission' : 'planned-participation')
    setImportMessage(t('reviewImport'))
  }

  async function importFromUrl(event: FormEvent) {
    event.preventDefault()
    if (!url.trim()) return
    setExtracting(true)
    setImportMessage('')
    try {
      applyImport(await extractUrl(url.trim()))
    } catch {
      setImportMessage('This page could not be read automatically. You can still enter its information below.')
    } finally {
      setExtracting(false)
    }
  }

  async function importFromPdf(file?: File) {
    if (!file) return
    setExtracting(true)
    setImportMessage('')
    try {
      applyImport(await extractPdf(file))
    } catch {
      setImportMessage('The PDF could not be read. Please enter the information below.')
    } finally {
      setExtracting(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim() || !draft.date) return
    await addDeadline({ ...draft, category, kind })
    setDraft(emptyDraft(category))
    setImportMessage('')
  }

  async function enableNotifications() {
    if (typeof Notification === 'undefined') return
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
    window.dispatchEvent(new Event('daybook-notification-permission'))
  }

  const categoryOptions: { value: DeadlineCategory; label: string }[] = [
    { value: 'publication', label: t('publications') },
    { value: 'conference', label: t('conferences') },
    { value: 'training', label: t('trainings') },
  ]

  return (
    <main className="main-content deadlines-page">
      <div className="deadlines-heading">
        <div>
          <p className="eyebrow">Schedule</p>
          <h1>{t('events')}</h1>
        </div>
        <button className={`reminder-control ${notificationPermission === 'granted' ? 'reminder-enabled' : ''}`} onClick={() => void enableNotifications()}>
          <Bell size={17} />
          <span>{notificationPermission === 'granted' ? t('remindersEnabled') : t('enableReminders')}<small>{t('reminders')}</small></span>
        </button>
      </div>

      {nextEvent && (
        <div className="next-event-strip">
          <span>{t('nextEvent')}</span><strong>{nextEvent.name}</strong><time>{nextEvent.date}</time>
        </div>
      )}

      <section className="import-panel" aria-labelledby="import-title">
        <div><FileUp size={18} /><h2 id="import-title">{t('importEvent')}</h2></div>
        <form onSubmit={importFromUrl}>
          <input onChange={(event) => setUrl(event.target.value)} placeholder={t('linkPlaceholder')} type="url" value={url} />
          <button disabled={extracting || !url.trim()} type="submit"><ExternalLink size={15} /> {t('extract')}</button>
        </form>
        <label className="pdf-button"><FileUp size={15} /> {t('choosePdf')}<input accept="application/pdf" onChange={(event) => void importFromPdf(event.target.files?.[0])} type="file" /></label>
        {importMessage && <p role="status">{importMessage}</p>}
      </section>

      <div className="category-tabs" role="tablist">
        {categoryOptions.map((option) => (
          <button aria-selected={category === option.value} className={category === option.value ? 'active' : ''} key={option.value} onClick={() => switchCategory(option.value)} role="tab">
            {option.label}<span>{deadlines.filter((item) => item.category === option.value).length}</span>
          </button>
        ))}
      </div>

      <form className="event-form" onSubmit={save}>
        <select aria-label="Submission type" onChange={(event) => setKind(event.target.value)} value={kind}>
          {category === 'publication' && <><option value="abstract-submission">{t('abstractSubmission')}</option><option value="full-paper-submission">{t('fullPaperSubmission')}</option></>}
          {category === 'conference' && <><option value="presentation-submission">{t('presentationSubmission')}</option><option value="presentation-finalization">{t('presentationFinalization')}</option></>}
          {category === 'training' && <option value="planned-participation">{t('plannedParticipation')}</option>}
        </select>
        <input aria-label={t('eventName')} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={t('eventName')} required value={draft.name} />
        <label><span>{t('eventDate')}</span><input aria-label={t('eventDate')} onChange={(event) => setDraft({ ...draft, date: event.target.value })} required type="date" value={draft.date} /></label>
        <input aria-label={t('location')} onChange={(event) => setDraft({ ...draft, location: event.target.value })} placeholder={t('location')} value={draft.location} />
        <select aria-label={t('format')} onChange={(event) => setDraft({ ...draft, presentationFormat: event.target.value })} value={draft.presentationFormat}>
          <option value="">{t('format')}</option><option value="in-person">{t('inPerson')}</option><option value="online">{t('online')}</option><option value="hybrid">{t('hybrid')}</option>
        </select>
        <input aria-label={t('fee')} onChange={(event) => setDraft({ ...draft, fee: event.target.value })} placeholder={t('fee')} value={draft.fee} />
        <input aria-label={t('source')} onChange={(event) => setDraft({ ...draft, source: event.target.value })} placeholder={t('source')} value={draft.source} />
        <button className="save-event-button" disabled={!draft.name.trim() || !draft.date} type="submit"><Plus size={17} /> {t('saveEvent')}</button>
      </form>

      <section className="event-list" aria-label={categoryOptions.find((option) => option.value === category)?.label}>
        {!visible.length && <div className="empty-state"><CalendarDays size={25} /><p>{t('noEvents')}</p></div>}
        {visible.map((event) => (
          <article className="event-row" key={event.id}>
            <time><strong>{new Date(`${event.date}T12:00:00`).toLocaleDateString(undefined, { day: '2-digit' })}</strong><span>{new Date(`${event.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span></time>
            <div><h3>{event.name}</h3><p><MapPin size={13} /> {event.location || '—'} <span>·</span> {event.presentationFormat || '—'}</p></div>
            <span className="event-fee"><WalletCards size={14} /> {event.fee || '—'}</span>
            <button aria-label={t('delete')} className="delete-button" onClick={() => void deleteDeadline(event.id!)}><Trash2 size={16} /></button>
          </article>
        ))}
      </section>
    </main>
  )
}
