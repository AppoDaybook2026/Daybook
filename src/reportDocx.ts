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
import type { ReportCover, ReportData, ReportSectionKey, ReportSections } from './report'

const SECTION_TITLES: Record<ReportSectionKey, string> = {
  introduction: '1. INTRODUCTION',
  timePlan: '2. TIME PLAN PRESENTED IN THESIS PROPOSAL',
  contribution: '3. CONTRIBUTION OF THE STUDIES CONDUCTED DURING THE LAST SIX MONTHS WITHIN THE WHOLE THESIS STUDY',
  conducted: '4. EXPLANATION OF THE STUDIES CONDUCTED DURING THE LAST SIX MONTHS IN ACCORDANCE WITH THE TIME PLAN AND THEIR RESULTS',
  notConducted: '5. STUDIES DURING THE LAST SIX MONTHS INCLUDED IN TIME PLAN BUT NOT CONDUCTED AND REASONS (if any)',
  methodologyChanges: '6. CHANGES IN THE METHODOLOGY AND THEIR REASONS (if any)',
  nextSixMonths: '7. EXPLANATION OF THE STUDIES PLANNED FOR THE NEXT SIX MONTHS',
  publications: '8. PUBLICATIONS ABOUT THE THESIS SUBJECT BEING PREPARED AND/OR SUBMITTED',
}

const ORDER: ReportSectionKey[] = [
  'introduction', 'timePlan', 'contribution', 'conducted',
  'notConducted', 'methodologyChanges', 'nextSixMonths', 'publications',
]

/** Emplacement à compléter, visible dans le document exporté. */
const placeholder = (label: string) => `[${label}]`

const centered = (text: string, bold = false, size = 22) => new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 120 },
  children: [new TextRun({ text, bold, size })],
})

const body = (text: string) => new Paragraph({
  spacing: { after: 120, line: 276 },
  children: [new TextRun({ text, size: 22 })],
})

function heading(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, size: 22 })],
  })
}

function cell(text: string, bold = false, width?: number) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text, bold, size: 20 })] })],
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

function coverPage(cover: ReportCover): Paragraph[] {
  const value = (text: string, label: string) => text.trim() || placeholder(label)

  const committee = cover.committee.trim()
    ? cover.committee.split('\n').filter(Boolean)
    : [placeholder('Prof. Dr. Name SURNAME — University/Institution')]

  return [
    centered(cover.institution || placeholder('UNIVERSITY'), true, 26),
    centered(cover.school || placeholder('GRADUATE SCHOOL'), true, 24),
    new Paragraph({ text: '', spacing: { after: 240 } }),
    centered(value(cover.reportNumber, 'REPORT NUMBER, e.g. 3rd REPORT'), true, 24),
    centered(value(cover.periodLabel, 'PERIOD AND YEAR, e.g. JANUARY/JUNE 2027'), true, 24),
    new Paragraph({ text: '', spacing: { after: 360 } }),
    centered(value(cover.thesisTitle, 'THESIS TITLE'), true, 26),
    new Paragraph({ text: '', spacing: { after: 360 } }),

    body(`Thesis Advisor: ${value(cover.advisor, 'Prof. Dr. Name SURNAME')}`),
    body(`                ${value(cover.advisorInstitution, 'University/Institution')}`),
    body(`Co-Advisor (if any): ${value(cover.coAdvisor, 'Prof. Dr. Name SURNAME')}`),
    body(`                     ${value(cover.coAdvisorInstitution, 'University/Institution')}`),
    new Paragraph({ text: '', spacing: { after: 120 } }),
    body('Steering Committee Members:'),
    ...committee.map((member) => body(`    ${member}`)),
    new Paragraph({ text: '', spacing: { after: 240 } }),

    body(`Student: ${value(cover.studentName, 'Name SURNAME')}`),
    body(`Student ID Number: ${value(cover.studentId, 'Student ID')}`),
    body(`Department: ${value(cover.department, 'Department')}`),
    body(`Programme: ${value(cover.programme, 'Programme')}`),
    new Paragraph({ text: '', spacing: { after: 360 } }),
    centered('THESIS PROGRESS REPORT', true, 28),
    new Paragraph({ children: [new PageBreak()] }),
  ]
}

function contentsPage(): Paragraph[] {
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 240 },
      children: [new TextRun({ text: 'CONTENTS', bold: true, size: 24 })],
    }),
    ...ORDER.map((key) => new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: SECTION_TITLES[key], size: 20 })],
    })),
    new Paragraph({ children: [new PageBreak()] }),
  ]
}

/** Tableaux de synthèse insérés en section 4, là où ils font sens. */
function evidenceTables(data: ReportData) {
  const blocks: (Paragraph | Table)[] = []

  if (data.tasks.length) {
    blocks.push(heading('Table 1 — Work completed during the period'))
    blocks.push(table(
      ['Date', 'Activity', 'Time (min)', 'Notes'],
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
    blocks.push(heading('Table 2 — Thesis outline progress'))
    blocks.push(table(
      ['Chapter or step', 'Type', 'Sections done', 'Progress'],
      advanced.map((chapter) => [
        chapter.title,
        chapter.kind === 'moment' ? 'Programme step' : 'Chapter',
        `${chapter.doneSections}/${chapter.totalSections}`,
        `${chapter.progress}%`,
      ]),
      [46, 18, 16, 20],
    ))
  }

  if (data.requirementsInPeriod.length) {
    blocks.push(heading('Table 3 — Doctoral school requirements in this period'))
    blocks.push(table(
      ['Item', 'Category', 'Deadline', 'Status'],
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
): Promise<Blob> {
  const content: (Paragraph | Table)[] = [
    ...coverPage(cover),
    ...contentsPage(),
  ]

  for (const key of ORDER) {
    content.push(heading(SECTION_TITLES[key]))
    const text = sections[key].trim()
    if (text) {
      for (const paragraph of text.split(/\n{2,}/)) {
        for (const line of paragraph.split('\n')) if (line.trim()) content.push(body(line.trim()))
      }
    } else {
      content.push(body(placeholder('To be completed')))
    }
    // Les tableaux étayent la section 4, celle qui rend compte du travail fait.
    if (key === 'conducted') content.push(...evidenceTables(data))
  }

  const document = new Document({
    creator: 'Daybook',
    title: cover.thesisTitle || 'Thesis progress report',
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
