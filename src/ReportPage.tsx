import { AlertTriangle, Download, FileText, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import type { Language, MessageKey, Translate } from './i18n'
import {
  EMPTY_COVER, EMPTY_SECTIONS, gatherReportData, loadCover, loadDraft, REPORT_SECTIONS,
  saveCover, saveDraft, summariseForDrafting,
  type ReportCover, type ReportData, type ReportSectionKey, type ReportSections,
} from './report'

const SECTION_LABELS: Record<ReportSectionKey, MessageKey> = {
  introduction: 'sectionIntroduction',
  timePlan: 'sectionTimePlan',
  contribution: 'sectionContribution',
  conducted: 'sectionConducted',
  notConducted: 'sectionNotConducted',
  methodologyChanges: 'sectionMethodologyChanges',
  nextSixMonths: 'sectionNextSixMonths',
  publications: 'sectionPublications',
}

const COVER_FIELDS: { key: keyof ReportCover; label: MessageKey; wide?: boolean }[] = [
  { key: 'institution', label: 'coverInstitution', wide: true },
  { key: 'school', label: 'coverSchool', wide: true },
  { key: 'reportNumber', label: 'coverReportNumber' },
  { key: 'periodLabel', label: 'coverPeriodLabel' },
  { key: 'thesisTitle', label: 'coverThesisTitle', wide: true },
  { key: 'advisor', label: 'coverAdvisor' },
  { key: 'advisorInstitution', label: 'coverAdvisorInstitution' },
  { key: 'coAdvisor', label: 'coverCoAdvisor' },
  { key: 'coAdvisorInstitution', label: 'coverCoAdvisorInstitution' },
  { key: 'studentName', label: 'coverStudentName' },
  { key: 'studentId', label: 'coverStudentId' },
  { key: 'department', label: 'coverDepartment' },
  { key: 'programme', label: 'coverProgramme' },
]

/** Six mois en arrière, période par défaut d'un rapport d'avancement. */
function defaultPeriod() {
  const end = new Date()
  const start = new Date()
  start.setMonth(start.getMonth() - 6)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export default function ReportPage({ t, language }: { t: Translate; language: Language }) {
  const [period, setPeriod] = useState(defaultPeriod)
  const [data, setData] = useState<ReportData | null>(null)
  const [cover, setCover] = useState<ReportCover>(EMPTY_COVER)
  const [sections, setSections] = useState<ReportSections>(EMPTY_SECTIONS)
  const [gathering, setGathering] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [warningOpen, setWarningOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [pages, setPages] = useState(0)

  useEffect(() => {
    void loadCover().then(setCover)
    void loadDraft().then(setSections)
  }, [])

  // Le brouillon est réenregistré peu après chaque frappe : perdre une
  // rédaction de rapport parce qu'on a changé d'onglet serait inacceptable.
  useEffect(() => {
    const timer = window.setTimeout(() => void saveDraft(sections), 800)
    return () => window.clearTimeout(timer)
  }, [sections])

  useEffect(() => {
    if (!data) { setPages(0); return }
    void import('./reportDocx').then(({ estimatePages }) => setPages(estimatePages(sections, data)))
  }, [sections, data])

  const advancedChapters = useMemo(
    () => data?.chapters.filter((chapter) => chapter.doneSections > 0).length ?? 0,
    [data],
  )

  async function gather(event?: FormEvent) {
    event?.preventDefault()
    setGathering(true)
    setMessage('')
    try {
      setData(await gatherReportData(period))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'error')
    } finally {
      setGathering(false)
    }
  }

  async function draft() {
    if (!data) return
    setWarningOpen(false)
    setDrafting(true)
    setMessage('')
    try {
      const response = await fetch('/api/draft-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: summariseForDrafting(data), language }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? `http-${response.status}`)
      // On ne remplace jamais ce que l'utilisateur a déjà écrit.
      setSections((current) => {
        const merged = { ...current }
        for (const key of REPORT_SECTIONS) {
          if (!current[key].trim() && payload[key]) merged[key] = String(payload[key])
        }
        return merged
      })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      const known: Record<string, string> = {
        'drafting-not-configured': 'AI drafting is not configured on this deployment.',
        'drafting-failed': 'The drafting service could not produce a text. Write the sections yourself, or try again.',
        'empty-content': 'Gather the data for a period first.',
      }
      setMessage(known[code] ?? `Drafting failed${code ? ` (${code})` : ''}.`)
    } finally {
      setDrafting(false)
    }
  }

  async function exportDocx() {
    if (!data) return
    const { buildReportDocx } = await import('./reportDocx')
    const blob = await buildReportDocx(cover, sections, data, t, language === 'ar')
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `thesis-progress-report-${period.start}-${period.end}-${language}.docx`
    link.click()
    URL.revokeObjectURL(url)
  }

  function updateCover(key: keyof ReportCover, value: string) {
    const next = { ...cover, [key]: value }
    setCover(next)
    void saveCover(next)
  }

  return (
    <main className="main-content report-page">
      <div className="deadlines-heading">
        <div>
          <h1>{t('reportTitle')}</h1>
          <p className="heading-subtitle">{t('reportIntro')}</p>
        </div>
      </div>

      <form className="filter-bar" onSubmit={gather}>
        <label className="report-date"><span>{t('periodStart')}</span>
          <input onChange={(event) => setPeriod({ ...period, start: event.target.value })} type="date" value={period.start} />
        </label>
        <label className="report-date"><span>{t('periodEnd')}</span>
          <input onChange={(event) => setPeriod({ ...period, end: event.target.value })} type="date" value={period.end} />
        </label>
        <button className="add-event-button" disabled={gathering} type="submit">
          {gathering ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />} {t('gatherData')}
        </button>
      </form>

      {data && (
        <div className="report-summary">
          <div><strong>{data.completedTaskCount}</strong><span>{t('tasksDone')}</span></div>
          <div><strong>{(data.totalMinutes / 60).toFixed(1)}</strong><span>{t('hoursRecorded')}</span></div>
          <div><strong>{advancedChapters}</strong><span>{t('chaptersAdvanced')}</span></div>
          <div><strong>{data.requirementsInPeriod.length}</strong><span>{t('requirementsInPeriod')}</span></div>
        </div>
      )}

      <section className="report-block">
        <h2>{t('coverTitle')}</h2>
        <p className="account-hint">{t('coverHint')}</p>
        <div className="event-form-grid">
          {COVER_FIELDS.map((field) => (
            <label className={field.wide ? 'span-2' : ''} key={field.key}>
              <span>{t(field.label)}</span>
              <input onChange={(event) => updateCover(field.key, event.target.value)} value={cover[field.key]} />
            </label>
          ))}
          <label className="span-2">
            <span>{t('coverCommittee')}</span>
            <textarea onChange={(event) => updateCover('committee', event.target.value)} rows={3} value={cover.committee} />
          </label>
        </div>
      </section>

      <section className="report-block">
        <div className="report-block-head">
          <h2>{t('sectionsTitle')}</h2>
          <div className="report-actions">
            <button className="account-secondary" disabled={!data || drafting} onClick={() => setWarningOpen(true)} type="button">
              {drafting ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />} {drafting ? t('drafting') : t('draftWithAi')}
            </button>
            <button className="add-event-button" disabled={!data} onClick={() => void exportDocx()} type="button">
              <Download size={15} /> {t('exportDocx')}
            </button>
          </div>
        </div>

        {!data && <p className="import-message">{t('noDataYet')}</p>}
        {message && <p className="import-message" role="status">{message}</p>}
        {pages > 0 && (
          <p className={`report-pages ${pages > 5 ? 'report-pages-over' : ''}`}>
            <FileText size={14} /> {t('estimatedPages')} : {pages} {pages > 5 ? `— ${t('pagesTooLong')}` : ''}
          </p>
        )}

        {REPORT_SECTIONS.map((key) => (
          <label className="report-section" key={key}>
            <span>{t(SECTION_LABELS[key])}</span>
            <textarea
              onChange={(event) => setSections({ ...sections, [key]: event.target.value })}
              rows={4}
              value={sections[key]}
            />
          </label>
        ))}
      </section>

      {warningOpen && (
        <div aria-modal="true" className="account-overlay" onClick={(event) => { if (event.target === event.currentTarget) setWarningOpen(false) }} role="dialog">
          <div className="account-modal">
            <header><h2><AlertTriangle size={19} /> {t('aiWarningTitle')}</h2></header>
            <p className="account-warning">{t('aiWarningBody')}</p>
            <div className="account-actions">
              <button className="account-secondary" onClick={() => setWarningOpen(false)} type="button">{t('aiWarningCancel')}</button>
              <button className="account-primary" onClick={() => void draft()} type="button">{t('aiWarningConfirm')}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
