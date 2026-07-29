import { beforeEach, describe, expect, it } from 'vitest'
import { addDeadline, addMilestone, addSubactivities, addTask, db, setSubactivityCompleted, setTaskCompleted } from '../db'
import {
  EMPTY_COVER, gatherReportData, loadCover, loadDraft, saveCover, saveDraft,
  summariseForDrafting, EMPTY_SECTIONS,
} from '../report'

async function reset() {
  await Promise.all([
    db.tasks.clear(), db.dailyTasks.clear(), db.timeSessions.clear(),
    db.milestones.clear(), db.subactivities.clear(), db.deadlines.clear(),
    db.outbox.clear(), db.pendingRows.clear(), db.appMeta.clear(),
  ])
}

describe('rapport d avancement', () => {
  beforeEach(reset)

  it('ne retient que les taches accomplies dans la periode', async () => {
    await addTask('Dans la periode', '2027-03-10')
    await addTask('Hors periode', '2027-01-05')
    await addTask('Dans la periode mais inachevee', '2027-03-12')

    const entries = await db.dailyTasks.toArray()
    const inside = entries.find((entry) => entry.date === '2027-03-10')
    const outside = entries.find((entry) => entry.date === '2027-01-05')
    await setTaskCompleted(inside!.id!, true)
    await setTaskCompleted(outside!.id!, true)

    const data = await gatherReportData({ start: '2027-03-01', end: '2027-03-31' })
    expect(data.tasks.map((task) => task.text)).toEqual(['Dans la periode'])
    expect(data.completedTaskCount).toBe(1)
  })

  it('restitue les notes de travail en clair pour le rapport', async () => {
    await addTask('Analyser les entretiens', '2027-03-10')
    const entry = await db.dailyTasks.toCollection().first()
    await db.dailyTasks.update(entry!.id!, { notes: await (await import('../localCrypto')).encryptLocal('Codage ouvert termine sur 12 entretiens') })
    await setTaskCompleted(entry!.id!, true)

    const data = await gatherReportData({ start: '2027-03-01', end: '2027-03-31' })
    expect(data.tasks[0].notes).toBe('Codage ouvert termine sur 12 entretiens')
  })

  it('mesure l avancement des chapitres et distingue les moments du parcours', async () => {
    await addMilestone('III. Methodology')
    const milestone = await db.milestones.toCollection().first()
    await addSubactivities(milestone!.id!, '3.1 Research design\n3.2 Participants\n3.3 Data collection')
    const sections = await db.subactivities.toArray()
    await setSubactivityCompleted(sections[0].id!, true)

    const data = await gatherReportData({ start: '2027-01-01', end: '2027-12-31' })
    expect(data.chapters).toHaveLength(1)
    expect(data.chapters[0].totalSections).toBe(3)
    expect(data.chapters[0].doneSections).toBe(1)
    expect(data.chapters[0].progress).toBe(33)
    expect(data.chapters[0].completedTitles).toEqual(['3.1 Research design'])
    expect(data.chapters[0].kind).toBe('chapter')
  })

  it('separe les exigences echues dans la periode des autres', async () => {
    const base = {
      category: 'conference' as const, kind: 'presentation-submission',
      eventDate: '', eventType: 'conference' as const, location: '', presentationFormat: '',
      fee: '', organizer: '', source: '', status: 'submitted' as const, priority: 3,
    }
    await addDeadline({ ...base, name: 'Dans la periode', date: '2027-03-15' })
    await addDeadline({ ...base, name: 'Hors periode', date: '2027-09-15' })

    const data = await gatherReportData({ start: '2027-03-01', end: '2027-03-31' })
    expect(data.requirements).toHaveLength(2)
    expect(data.requirementsInPeriod.map((item) => item.name)).toEqual(['Dans la periode'])
  })

  it('le resume transmis au modele ne contient aucune identite', async () => {
    await saveCover({ ...EMPTY_COVER, studentName: 'Appolinaire Tonye', studentId: '123456', thesisTitle: 'Ma these secrete' })
    await addTask('Rediger la revue', '2027-03-10')
    const entry = await db.dailyTasks.toCollection().first()
    await setTaskCompleted(entry!.id!, true)

    const data = await gatherReportData({ start: '2027-03-01', end: '2027-03-31' })
    const summary = summariseForDrafting(data)

    expect(summary).toContain('Rediger la revue')
    expect(summary).not.toContain('Appolinaire Tonye')
    expect(summary).not.toContain('123456')
    expect(summary).not.toContain('Ma these secrete')
  })

  it('page de garde et brouillon sont chiffres au repos', async () => {
    await saveCover({ ...EMPTY_COVER, studentName: 'Nom Prenom', thesisTitle: 'Titre confidentiel' })
    const stored = await db.appMeta.get('reportCover')
    expect(stored?.value.startsWith('enc:v1:')).toBe(true)
    expect(stored?.value).not.toContain('Titre confidentiel')
    await expect(loadCover()).resolves.toMatchObject({ studentName: 'Nom Prenom', thesisTitle: 'Titre confidentiel' })

    await saveDraft({ ...EMPTY_SECTIONS, introduction: 'Mon introduction' })
    const draft = await db.appMeta.get('reportDraft')
    expect(draft?.value).not.toContain('Mon introduction')
    await expect(loadDraft()).resolves.toMatchObject({ introduction: 'Mon introduction' })
  })

  it('renvoie des valeurs par defaut quand rien n a ete enregistre', async () => {
    await expect(loadCover()).resolves.toEqual(EMPTY_COVER)
    await expect(loadDraft()).resolves.toEqual(EMPTY_SECTIONS)
  })
})

describe('export Word', () => {
  beforeEach(reset)

  it('produit un document Word non vide et de type correct', async () => {
    const { buildReportDocx } = await import('../reportDocx')
    await addTask('Analyser les entretiens', '2027-03-10')
    const entry = await db.dailyTasks.toCollection().first()
    await setTaskCompleted(entry!.id!, true)

    const data = await gatherReportData({ start: '2027-03-01', end: '2027-03-31' })
    const blob = await buildReportDocx(
      { ...EMPTY_COVER, studentName: 'Nom Prenom', thesisTitle: 'Titre de these' },
      { ...EMPTY_SECTIONS, introduction: 'This report covers the period.' },
      data,
    )

    expect(blob.size).toBeGreaterThan(3000)
    // Un .docx est une archive ZIP : elle commence par la signature PK.
    const head = new Uint8Array(await blob.arrayBuffer()).slice(0, 2)
    expect([head[0], head[1]]).toEqual([0x50, 0x4b])
  })

  it('estime la longueur et alerte au-dela de cinq pages', async () => {
    const { estimatePages } = await import('../reportDocx')
    const data = await gatherReportData({ start: '2027-01-01', end: '2027-12-31' })

    expect(estimatePages(EMPTY_SECTIONS, data)).toBeLessThanOrEqual(5)

    const verbose = Object.fromEntries(
      Object.keys(EMPTY_SECTIONS).map((key) => [key, 'x'.repeat(4000)]),
    ) as typeof EMPTY_SECTIONS
    expect(estimatePages(verbose, data)).toBeGreaterThan(5)
  })
})
