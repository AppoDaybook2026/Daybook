/**
 * Rapport d'avancement de thèse.
 *
 * Ce module ne fait que rassembler et mettre en forme ce qui existe déjà dans
 * la base locale : tâches accomplies sur la période, avancement des chapitres,
 * exigences remplies. Rien n'est inventé, et rien ne quitte l'appareil ici —
 * l'envoi éventuel vers le modèle de rédaction est déclenché ailleurs, et
 * explicitement.
 */
import { db, type DeadlineCategory, type MilestoneKind, type SubmissionStatus } from './db'
import { decryptLocal, encryptLocal } from './localCrypto'

/* ------------------------------------------------------------------ */
/* Période et données réunies                                          */
/* ------------------------------------------------------------------ */

export interface ReportPeriod {
  start: string
  end: string
}

export interface ReportTask {
  text: string
  notes: string
  completedOn: string
  minutes: number
}

export interface ReportChapter {
  title: string
  kind: MilestoneKind
  progress: number
  doneSections: number
  totalSections: number
  /** Sections achevées, pour détailler ce qui a réellement avancé. */
  completedTitles: string[]
}

export interface ReportRequirement {
  name: string
  category: DeadlineCategory
  kind: string
  deadline: string
  eventDate: string
  status: SubmissionStatus
  priority: number
}

export interface ReportData {
  period: ReportPeriod
  tasks: ReportTask[]
  completedTaskCount: number
  totalMinutes: number
  chapters: ReportChapter[]
  requirements: ReportRequirement[]
  /** Exigences dont l'échéance tombe dans la période. */
  requirementsInPeriod: ReportRequirement[]
}

/** Minutes travaillées sur une tâche, toutes sessions confondues. */
function minutesOf(sessions: { startedAt: string; endedAt?: string }[]): number {
  const total = sessions.reduce((sum, session) => {
    if (!session.endedAt) return sum
    const from = new Date(session.startedAt).getTime()
    const to = new Date(session.endedAt).getTime()
    if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return sum
    return sum + (to - from)
  }, 0)
  return Math.round(total / 60_000)
}

/**
 * Rassemble tout ce que la période contient. Les tâches sont filtrées avec
 * précision par leur date ; les chapitres et les exigences sont donnés dans
 * leur état actuel, faute d'historique daté — c'est une limite assumée, et
 * l'interface le dit à l'utilisateur.
 */
export async function gatherReportData(period: ReportPeriod): Promise<ReportData> {
  const { start, end } = period

  const entries = (await db.dailyTasks.toArray())
    .filter((entry) => entry.date >= start && entry.date <= end && entry.completed)
    .sort((a, b) => a.date.localeCompare(b.date))

  const allSessions = await db.timeSessions.toArray()
  const tasks: ReportTask[] = []
  for (const entry of entries) {
    const task = await db.tasks.get(entry.taskId)
    if (!task) continue
    const sessions = allSessions.filter((session) => {
      if (session.taskId !== entry.taskId) return false
      const day = session.startedAt.slice(0, 10)
      return day >= start && day <= end
    })
    tasks.push({
      text: await decryptLocal(task.text),
      notes: await decryptLocal(entry.notes ?? task.notes ?? ''),
      completedOn: entry.date,
      minutes: minutesOf(sessions),
    })
  }

  const milestoneRows = await db.milestones.orderBy('position').toArray()
  const sectionRows = await db.subactivities.toArray()
  const chapters: ReportChapter[] = []
  for (const milestone of milestoneRows) {
    const sections = sectionRows.filter((section) => section.milestoneId === milestone.id)
    const done = sections.filter((section) => section.completed)
    chapters.push({
      title: await decryptLocal(milestone.title),
      kind: milestone.kind ?? 'chapter',
      progress: sections.length ? Math.round((done.length / sections.length) * 100) : 0,
      doneSections: done.length,
      totalSections: sections.length,
      completedTitles: await Promise.all(done.map((section) => decryptLocal(section.title))),
    })
  }

  const deadlineRows = await db.deadlines.orderBy('date').toArray()
  const requirements: ReportRequirement[] = await Promise.all(deadlineRows.map(async (row) => ({
    name: await decryptLocal(row.name),
    category: row.category,
    kind: row.kind,
    deadline: row.date,
    eventDate: row.eventDate ?? '',
    status: row.status,
    priority: row.priority ?? 0,
  })))

  return {
    period,
    tasks,
    completedTaskCount: tasks.length,
    totalMinutes: tasks.reduce((sum, task) => sum + task.minutes, 0),
    chapters,
    requirements,
    requirementsInPeriod: requirements.filter((item) => item.deadline >= start && item.deadline <= end),
  }
}

/* ------------------------------------------------------------------ */
/* Sections du rapport                                                 */
/* ------------------------------------------------------------------ */

/** Les huit sections imposées par le formulaire de l'école doctorale. */
export const REPORT_SECTIONS = [
  'introduction',
  'timePlan',
  'contribution',
  'conducted',
  'notConducted',
  'methodologyChanges',
  'nextSixMonths',
  'publications',
] as const

export type ReportSectionKey = (typeof REPORT_SECTIONS)[number]

export type ReportSections = Record<ReportSectionKey, string>

export const EMPTY_SECTIONS: ReportSections = {
  introduction: '', timePlan: '', contribution: '', conducted: '',
  notConducted: '', methodologyChanges: '', nextSixMonths: '', publications: '',
}

/* ------------------------------------------------------------------ */
/* Page de garde                                                       */
/* ------------------------------------------------------------------ */

export interface ReportCover {
  institution: string
  school: string
  reportNumber: string
  periodLabel: string
  thesisTitle: string
  advisor: string
  advisorInstitution: string
  coAdvisor: string
  coAdvisorInstitution: string
  committee: string
  studentName: string
  studentId: string
  department: string
  programme: string
}

export const EMPTY_COVER: ReportCover = {
  // Rien n'est pré-rempli : l'établissement varie d'un utilisateur à l'autre,
  // et une valeur héritée d'un autre serait pire qu'un champ vide.
  institution: '',
  school: '',
  reportNumber: '',
  periodLabel: '',
  thesisTitle: '',
  advisor: '',
  advisorInstitution: '',
  coAdvisor: '',
  coAdvisorInstitution: '',
  committee: '',
  studentName: '',
  studentId: '',
  department: '',
  programme: '',
}

const COVER_KEY = 'reportCover'
const DRAFT_KEY = 'reportDraft'

/** Lecture d'une valeur chiffrée dans appMeta, tolérante aux données absentes. */
async function readEncrypted<T>(key: string, fallback: T): Promise<T> {
  const row = await db.appMeta.get(key)
  if (!row?.value) return fallback
  try {
    return { ...fallback, ...JSON.parse(await decryptLocal(row.value)) }
  } catch {
    return fallback
  }
}

export const loadCover = () => readEncrypted<ReportCover>(COVER_KEY, EMPTY_COVER)

export async function saveCover(cover: ReportCover) {
  await db.appMeta.put({ key: COVER_KEY, value: await encryptLocal(JSON.stringify(cover)) })
}

export const loadDraft = () => readEncrypted<ReportSections>(DRAFT_KEY, EMPTY_SECTIONS)

export async function saveDraft(sections: ReportSections) {
  await db.appMeta.put({ key: DRAFT_KEY, value: await encryptLocal(JSON.stringify(sections)) })
}

/* ------------------------------------------------------------------ */
/* Résumé transmis au modèle de rédaction                              */
/* ------------------------------------------------------------------ */

/**
 * Condensé envoyé au serveur quand l'utilisateur demande une rédaction
 * assistée. Volontairement limité : ni identité, ni page de garde, ni
 * exigences hors période. C'est ce texte exact que l'avertissement annonce.
 */
export function summariseForDrafting(data: ReportData): string {
  const hours = (data.totalMinutes / 60).toFixed(1)
  const lines: string[] = [
    `Reporting period: ${data.period.start} to ${data.period.end}`,
    `Tasks completed: ${data.completedTaskCount}. Recorded working time: ${hours} hours.`,
    '',
    'COMPLETED TASKS AND THE DOCTORAL CANDIDATE OWN NOTES:',
  ]

  for (const task of data.tasks.slice(0, 120)) {
    const time = task.minutes ? ` (${task.minutes} min)` : ''
    lines.push(`- [${task.completedOn}] ${task.text}${time}`)
    if (task.notes.trim()) lines.push(`  note: ${task.notes.trim().slice(0, 400)}`)
  }

  lines.push('', 'THESIS OUTLINE PROGRESS:')
  for (const chapter of data.chapters) {
    const label = chapter.kind === 'moment' ? 'programme step' : 'chapter'
    lines.push(`- ${chapter.title} (${label}): ${chapter.progress}% — ${chapter.doneSections}/${chapter.totalSections} sections done`)
    if (chapter.completedTitles.length) {
      lines.push(`  completed: ${chapter.completedTitles.slice(0, 12).join('; ')}`)
    }
  }

  lines.push('', 'DOCTORAL SCHOOL REQUIREMENTS AND SUBMISSIONS:')
  for (const item of data.requirements.slice(0, 60)) {
    lines.push(`- ${item.name} — ${item.category}, ${item.kind}, deadline ${item.deadline || 'n/a'}, status ${item.status}`)
  }

  return lines.join('\n')
}
