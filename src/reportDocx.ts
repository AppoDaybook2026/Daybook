/**
 * Génération du rapport d'avancement au format Word.
 *
 * La page de garde reproduit le formulaire de l'école doctorale. Les champs
 * que l'utilisateur n'a pas renseignés restent visibles sous forme de mention
 * entre crochets : mieux vaut un emplacement manifestement vide qu'un rapport
 * qui paraît complet alors qu'il ne l'est pas.
 */
import {
  AlignmentType, Document, HeadingLevel, PageBreak, Packer, Paragraph,
  Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx'
import type { MessageKey, Translate } from './i18n'
import type { ReportCover, ReportData, ReportSectionKey, ReportSections } from './report'

const SECTION_KEYS: Record<ReportSectionKey, MessageKey> = {
  introduction: 'docSec1',
  timePlan: 'docSec2',
  contribution: 'docSec3',
  conducted: 'docSec4',
  notConducted: 'docSec5',
  methodologyChanges: 'docSec6',
  nextSixMonths: 'docSec7',
  publications: 'docSec8',
}

const ORDER: ReportSectionKey[] = [
  'introduction', 'timePlan', 'contribution', 'conducted',
  'notConducted', 'methodologyChanges', 'nextSixMonths', 'publications',
]

/** Emplacement à compléter, visible dans le document exporté. */
const placeholder = (label: string) => `[${label}]`

/**
 * Sens de lecture du document en cours de génération. La bibliothèque règle
 * cela paragraphe par paragraphe, pas au niveau de la section ; un drapeau de
 * module suffit puisqu'un navigateur n'exporte qu'un document à la fois.
 */
let rightToLeftDocument = false

const centered = (text: string, bold = false, size = 22) => new Paragraph({
  alignment: AlignmentType.CENTER,
  bidirectional: rightToLeftDocument,
  spacing: { after: 120 },
  children: [new TextRun({ text, bold, size, rightToLeft: rightToLeftDocument })],
})

const body = (text: string) => new Paragraph({
  bidirectional: rightToLeftDocument,
  spacing: { after: 120, line: 276 },
  children: [new TextRun({ text, size: 22, rightToLeft: rightToLeftDocument })],
})

function heading(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    bidirectional: rightToLeftDocument,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, size: 22, rightToLeft: rightToLeftDocument })],
  })
}

function cell(text: string, bold = false, width?: number) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      bidirectional: rightToLeftDocument,
      children: [new TextRun({ text, bold, size: 20, rightToLeft: rightToLeftDocument })],
    })],
  })
}

function table(headers: string[], rows: string[][], widths: number[]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((text, index) => cell(text, true, widths[index])),
      }),
      ...rows.map((row) => new TableRow({
        children: row.map((text, index) => cell(text, false, widths[index])),
      })),
    ],
  })
}

/* ------------------------------------------------------------------ */

function coverPage(cover: ReportCover, t: Translate): Paragraph[] {
  const value = (text: string, key: MessageKey) => text.trim() || placeholder(t(key))

  const committee = cover.committee.trim()
    ? cover.committee.split('\n').filter(Boolean)
    : [placeholder(`${t('docPhName')} — ${t('docPhInstitution')}`)]

  return [
    centered(value(cover.institution, 'docPhUniversity'), true, 26),
    centered(value(cover.school, 'docPhSchool'), true, 24),
    new Paragraph({ text: '', spacing: { after: 240 } }),
    centered(value(cover.reportNumber, 'docPhReportNumber'), true, 24),
    centered(value(cover.periodLabel, 'docPhPeriod'), true, 24),
    new Paragraph({ text: '', spacing: { after: 360 } }),
    centered(value(cover.thesisTitle, 'docPhThesisTitle'), true, 26),
    new Paragraph({ text: '', spacing: { after: 360 } }),

    body(`${t('docAdvisor')} : ${value(cover.advisor, 'docPhName')}`),
    body(`    ${value(cover.advisorInstitution, 'docPhInstitution')}`),
    body(`${t('docCoAdvisor')} : ${value(cover.coAdvisor, 'docPhName')}`),
    body(`    ${value(cover.coAdvisorInstitution, 'docPhInstitution')}`),
    new Paragraph({ text: '', spacing: { after: 120 } }),
    body(t('docCommittee')),
    ...committee.map((member) => body(`    ${member}`)),
    new Paragraph({ text: '', spacing: { after: 240 } }),

    body(`${t('docStudent')} : ${value(cover.studentName, 'docPhName')}`),
    body(`${t('docStudentId')} : ${value(cover.studentId, 'docPhStudentId')}`),
    body(`${t('docDepartment')} : ${value(cover.department, 'docPhDepartment')}`),
    body(`${t('docProgramme')} : ${value(cover.programme, 'docPhProgramme')}`),
    new Paragraph({ text: '', spacing: { after: 360 } }),
    centered(t('docReportTitle'), true, 28),
    new Paragraph({ children: [new PageBreak()] }),
  ]
}

function contentsPage(t: Translate): Paragraph[] {
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 240 },
      children: [new TextRun({ text: t('docContents'), bold: true, size: 24 })],
    }),
    ...ORDER.map((key) => new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: t(SECTION_KEYS[key]), size: 20 })],
    })),
    new Paragraph({ children: [new PageBreak()] }),
  ]
}

/** Tableaux de synthèse insérés en section 4, là où ils font sens. */
function evidenceTables(data: ReportData, t: Translate) {
  const blocks: (Paragraph | Table)[] = []

  if (data.tasks.length) {
    blocks.push(heading(t('docTable1')))
    blocks.push(table(
      [t('docColDate'), t('docColActivity'), t('docColTime'), t('docColNotes')],
      data.tasks.slice(0, 40).map((task) => [
        task.completedOn,
        task.text,
        task.minutes ? String(task.minutes) : '—',
        task.notes.slice(0, 180) || '—',
      ]),
      [12, 34, 12, 42],
    ))
  }

  const advanced = data.chapters.filter((chapter) => chapter.doneSections > 0)
  if (advanced.length) {
    blocks.push(heading(t('docTable2')))
    blocks.push(table(
      [t('docColChapter'), t('docColType'), t('docColSections'), t('docColProgress')],
      advanced.map((chapter) => [
        chapter.title,
        chapter.kind === 'moment' ? t('docProgrammeStep') : t('docChapter'),
        `${chapter.doneSections}/${chapter.totalSections}`,
        `${chapter.progress}%`,
      ]),
      [46, 18, 16, 20],
    ))
  }

  if (data.requirementsInPeriod.length) {
    blocks.push(heading(t('docTable3')))
    blocks.push(table(
      [t('docColItem'), t('docColCategory'), t('docColDeadline'), t('docColStatus')],
      data.requirementsInPeriod.map((item) => [
        item.name, item.category, item.deadline || '—', item.status,
      ]),
      [44, 18, 18, 20],
    ))
  }

  return blocks
}

/* ------------------------------------------------------------------ */

export async function buildReportDocx(
  cover: ReportCover,
  sections: ReportSections,
  data: ReportData,
  t: Translate,
  rightToLeft = false,
): Promise<Blob> {
  rightToLeftDocument = rightToLeft

  const content: (Paragraph | Table)[] = [
    ...coverPage(cover, t),
    ...contentsPage(t),
  ]

  for (const key of ORDER) {
    content.push(heading(t(SECTION_KEYS[key])))
    const text = sections[key].trim()
    if (text) {
      for (const paragraph of text.split(/\n{2,}/)) {
        for (const line of paragraph.split('\n')) if (line.trim()) content.push(body(line.trim()))
      }
    } else {
      content.push(body(placeholder(t('docToComplete'))))
    }
    // Les tableaux étayent la section 4, celle qui rend compte du travail fait.
    if (key === 'conducted') content.push(...evidenceTables(data, t))
  }

  const document = new Document({
    creator: 'Daybook',
    title: cover.thesisTitle || t('docReportTitle'),
    styles: { default: { document: { run: { font: 'Times New Roman', size: 22 } } } },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      children: content,
    }],
  })

  return Packer.toBlob(document)
}

/**
 * Estimation grossière du nombre de pages, pour prévenir avant export.
 * Une page A4 en Times 11 tient environ 3 000 signes ; les tableaux comptent
 * pour une ligne chacun. C'est approximatif, et présenté comme tel.
 */
export function estimatePages(sections: ReportSections, data: ReportData): number {
  const characters = Object.values(sections).reduce((sum, text) => sum + text.length, 0)
  const tableRows = Math.min(data.tasks.length, 40)
    + data.chapters.filter((chapter) => chapter.doneSections > 0).length
    + data.requirementsInPeriod.length
  const pages = 2 + characters / 3000 + tableRows / 30
  return Math.max(2, Math.ceil(pages))
}
