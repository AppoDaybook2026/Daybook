import { liveQuery } from 'dexie'
import { CalendarDays, Check, CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import {
  addMilestone, addSubactivities, db, deleteMilestone, deleteSubactivity, prepareMilestones,
  setSubactivityCompleted, updateMilestone, updateSubactivity, type Milestone, type Subactivity,
} from './db'
import type { Language, Translate } from './i18n'
import demoData from './demo-data.json'
import { decryptLocal } from './localCrypto'

type MilestoneWithItems = Milestone & { subactivities: Subactivity[] }

function progressOf(items: Subactivity[]) {
  if (!items.length) return 0
  return Math.round((items.filter((item) => item.completed).length / items.length) * 100)
}

function useMilestones(demo = false) {
  const demoMilestones = (demoData.milestones as Milestone[])
    .sort((a, b) => a.position - b.position)
    .map((milestone) => ({
      ...milestone,
      subactivities: (demoData.subactivities as Subactivity[])
        .filter((item) => item.milestoneId === milestone.id)
        .sort((a, b) => a.position - b.position),
    }))
  const [milestones, setMilestones] = useState<MilestoneWithItems[]>(demo ? demoMilestones : [])
  const [loading, setLoading] = useState(!demo)

  useEffect(() => {
    if (demo) return
    void prepareMilestones().catch(console.error)
    const subscription = liveQuery(async () => {
      const records = await db.milestones.orderBy('position').toArray()
      const items = await db.subactivities.toArray()
      const readableRecords = await Promise.all(records.map(async (milestone) => ({
        ...milestone,
        title: await decryptLocal(milestone.title),
        notes: await decryptLocal(milestone.notes),
      })))
      const readableItems = await Promise.all(items.map(async (item) => ({ ...item, title: await decryptLocal(item.title) })))
      return readableRecords.map((milestone) => ({
        ...milestone,
        subactivities: readableItems
          .filter((item) => item.milestoneId === milestone.id)
          .sort((a, b) => a.position - b.position),
      }))
    }).subscribe({
      next: (items) => {
        setMilestones(items)
        setLoading(false)
      },
      error: (error) => {
        console.error(error)
        setLoading(false)
      },
    })
    return () => subscription.unsubscribe()
  }, [demo])

  return { milestones, loading }
}

function SubactivityRow({ item, readOnly }: { item: Subactivity; readOnly: boolean }) {
  const [title, setTitle] = useState(item.title)
  useEffect(() => setTitle(item.title), [item.title])

  return (
    <div className={`subactivity-row ${item.completed ? 'subactivity-complete' : ''}`}>
      <button
        aria-checked={item.completed}
        aria-label={item.completed ? 'Marquer comme non terminée' : 'Marquer comme terminée'}
        className={`subactivity-check ${item.completed ? 'subactivity-check-done' : ''}`}
        disabled={readOnly}
        onClick={() => void setSubactivityCompleted(item.id!, !item.completed)}
        role="checkbox"
      >
        {item.completed && <Check size={12} strokeWidth={2.7} />}
      </button>
      <input
        aria-label="Intitulé de la sous-activité"
        onBlur={() => void updateSubactivity(item.id!, title)}
        onChange={(event) => setTitle(event.target.value)}
        readOnly={readOnly}
        value={title}
      />
      <button aria-label={`Supprimer ${item.title}`} className="subactivity-delete" disabled={readOnly} onClick={() => void deleteSubactivity(item.id!)} title="Supprimer">
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function MilestoneBlock({ milestone, index, t, readOnly }: { milestone: MilestoneWithItems; index: number; t: Translate; readOnly: boolean }) {
  const [title, setTitle] = useState(milestone.title)
  const [notes, setNotes] = useState(milestone.notes)
  const [bulkItems, setBulkItems] = useState('')
  const progress = progressOf(milestone.subactivities)
  const completed = milestone.subactivities.filter((item) => item.completed).length

  useEffect(() => setTitle(milestone.title), [milestone.title])
  useEffect(() => setNotes(milestone.notes), [milestone.notes])

  async function submitItem(event: FormEvent) {
    event.preventDefault()
    if (!bulkItems.trim()) return
    await addSubactivities(milestone.id!, bulkItems)
    setBulkItems('')
  }

  async function remove() {
    if (window.confirm(`Supprimer l’étape « ${milestone.title} » et ses sous-activités ?`)) {
      await deleteMilestone(milestone.id!)
    }
  }

  return (
    <article className={`milestone-block ${progress === 100 ? 'milestone-complete' : ''}`}>
      <header className="milestone-block-header">
        <span className="milestone-status" aria-hidden="true">
          {progress === 100 ? <CheckCircle2 size={19} /> : index + 1}
        </span>
        <div className="milestone-identity">
          <input
            aria-label="Titre de l’étape"
            className="milestone-title"
            onBlur={() => void updateMilestone(milestone.id!, { title })}
            onChange={(event) => setTitle(event.target.value)}
            readOnly={readOnly}
            value={title}
          />
          <div className="milestone-schedule">
            <span className="date-fields"><CalendarDays size={13} />
              <label><span>{t('startMonth')}</span><input aria-label={t('startMonth')} disabled={readOnly} onChange={(event) => void updateMilestone(milestone.id!, { startDate: event.target.value })} type="month" value={milestone.startDate || ''} /></label>
              <span className="date-separator">→</span>
              <label><span>{t('endMonth')}</span><input aria-label={t('endMonth')} disabled={readOnly} onChange={(event) => void updateMilestone(milestone.id!, { endDate: event.target.value })} type="month" value={milestone.endDate || ''} /></label>
            </span>
            {!milestone.startDate && !milestone.endDate && <span className="dates-missing">{t('datesMissing')}</span>}
            <span className={`status-pill status-${milestone.status}`}>{t(milestone.status === 'on-track' ? 'onTrack' : milestone.status === 'in-progress' ? 'inProgress' : milestone.status)}</span>
          </div>
        </div>
        <div className="milestone-score">
          <strong>{progress}%</strong>
          <span>{completed}/{milestone.subactivities.length}</span>
        </div>
        <button aria-label={`Supprimer ${milestone.title}`} className="delete-button" disabled={readOnly} onClick={() => void remove()} title="Supprimer l’étape">
          <Trash2 size={16} />
        </button>
      </header>

      <div className="milestone-progress-track" aria-label={`${progress} % terminé`}>
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="subactivity-list">
        {milestone.subactivities.map((item) => <SubactivityRow item={item} key={item.id} readOnly={readOnly} />)}
      </div>

      {!readOnly && <form className="subactivity-add" onSubmit={submitItem}>
        <Plus size={15} />
        <div className="bulk-field">
          <textarea
            aria-label={t('bulkPlaceholder')}
            onChange={(event) => setBulkItems(event.target.value)}
            placeholder={t('bulkPlaceholder')}
            rows={bulkItems.includes('\n') ? 5 : 2}
            value={bulkItems}
          />
          <span>{t('bulkHint')}</span>
        </div>
        <button disabled={!bulkItems.trim()} type="submit">{t('add')}</button>
      </form>}

      <textarea
        aria-label={`Notes pour ${milestone.title}`}
        className="milestone-notes"
        onBlur={() => void updateMilestone(milestone.id!, { notes })}
        onChange={(event) => setNotes(event.target.value)}
        placeholder={t('optionalNotes')}
        readOnly={readOnly}
        rows={2}
        value={notes}
      />
    </article>
  )
}

export default function MilestonesPage({ language: _language, t, readOnly }: { language: Language; t: Translate; readOnly: boolean }) {
  const { milestones, loading } = useMilestones(readOnly)
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const allItems = milestones.flatMap((milestone) => milestone.subactivities)
  const completedItems = allItems.filter((item) => item.completed).length
  const overall = allItems.length ? Math.round((completedItems / allItems.length) * 100) : 0
  const completedMilestones = milestones.filter((item) => progressOf(item.subactivities) === 100).length

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    await addMilestone(title)
    setTitle('')
    inputRef.current?.focus()
  }

  return (
    <main className="main-content milestones-page">
      <div className="milestones-heading">
        <div>
          <p className="eyebrow">{t('dissertation')}</p>
          <h1>{t('thesisPlan')}</h1>
          <p className="heading-subtitle">{completedMilestones} {t('stages')} {milestones.length}</p>
        </div>
        <div className="overall-progress" aria-label={`Progression générale ${overall} %`}>
          <strong>{overall}%</strong>
          <span>{completedItems} / {allItems.length} {t('subactivities')}</span>
        </div>
      </div>

      <div className="dissertation-progress" aria-hidden="true"><span style={{ width: `${overall}%` }} /></div>

      <form className="new-task-form milestone-add-form" onSubmit={submit}>
        <input
          aria-label="Nouvelle étape"
          className="new-task-input"
          disabled={loading}
          readOnly={readOnly}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('addStage')}
          ref={inputRef}
          value={title}
        />
        <button aria-label="Ajouter l’étape" disabled={readOnly || !title.trim() || loading} type="submit"><Plus size={20} /></button>
      </form>

      <section aria-label="Calendrier de la thèse" className="milestone-list">
        {milestones.map((milestone, index) => <MilestoneBlock index={index} key={milestone.id} milestone={milestone} readOnly={readOnly} t={t} />)}
      </section>
    </main>
  )
}
