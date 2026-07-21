export type Language = 'en' | 'fr' | 'ar'

const messages = {
  fr: {
    daily: 'Quotidien', milestones: 'Jalons', deadlines: 'Échéances', today: 'Aujourd’hui',
    newTask: 'Qu’est-ce qui mérite votre attention ?', addTask: 'Ajouter la tâche', done: 'terminées',
    running: 'En cours', clearDay: 'Votre journée est libre. Ajoutez ce qui compte.',
    high: 'Haute', medium: 'Normale', low: 'Basse', notes: 'Notes', taskNotes: 'Notes de travail pour cette tâche…',
    edit: 'Modifier', moveUp: 'Monter', moveDown: 'Descendre', startTimer: 'Démarrer le chronomètre', pause: 'Mettre en pause',
    carried: 'Reportée depuis', day: 'jour', days: 'jours', dissertation: 'Doctorat · 2026–2028',
    thesisPlan: 'Plan de progression de la thèse', stages: 'étapes terminées sur', overall: 'progression générale',
    subactivities: 'sous-activités', addStage: 'Ajouter une étape au calendrier…', add: 'Ajouter',
    startMonth: 'Mois de début', endMonth: 'Mois de fin', datesMissing: 'Dates à renseigner',
    bulkPlaceholder: 'Collez plusieurs sous-sections ici, une par ligne…', bulkHint: 'Une ligne créera une sous-activité.',
    optionalNotes: 'Notes facultatives pour cette étape…', delete: 'Supprimer', completed: 'terminé',
    drafted: 'Rédigé', onTrack: 'En bonne voie', inProgress: 'En cours', upcoming: 'À venir',
    language: 'Langue', theme: 'Couleur', green: 'Vert', blue: 'Bleu', coral: 'Corail', violet: 'Violet', demo: 'Démonstration · lecture seule', previousDay: 'Jour précédent', nextDay: 'Jour suivant', backToday: 'Revenir à aujourd’hui', chooseDate: 'Choisir une date', noHistory: 'Aucune tâche enregistrée pour cette date.', history: 'Historique en lecture seule', events: 'Événements et échéances', publications: 'Publications', conferences: 'Conférences', trainings: 'Formations', eventName: 'Nom', eventDate: 'Date de l’événement', location: 'Lieu', format: 'Format de présentation', fee: 'Frais de participation', source: 'Source', saveEvent: 'Enregistrer', abstractSubmission: 'Soumission du résumé', fullPaperSubmission: 'Soumission de l’article complet', presentationSubmission: 'Soumission de la présentation', presentationFinalization: 'Finalisation de la présentation', plannedParticipation: 'Participation prévue', inPerson: 'Présentiel', online: 'En ligne', hybrid: 'Hybride', importEvent: 'Importer depuis un PDF ou un lien', extract: 'Extraire', linkPlaceholder: 'Coller le lien de l’événement…', choosePdf: 'Choisir un PDF', reviewImport: 'Vérifiez les informations extraites avant de les enregistrer.', reminders: 'Rappels à 09h, 15h et 21h', enableReminders: 'Activer les rappels', remindersEnabled: 'Rappels activés', nextEvent: 'Prochain événement', noEvents: 'Aucun événement enregistré dans cette catégorie.',
  },
  en: {
    daily: 'Daily', milestones: 'Milestones', deadlines: 'Deadlines', today: 'Today',
    newTask: 'What deserves your attention?', addTask: 'Add task', done: 'completed', running: 'In progress',
    clearDay: 'Your day is clear. Add what matters.', high: 'High', medium: 'Normal', low: 'Low', notes: 'Notes',
    taskNotes: 'Working notes for this task…', edit: 'Edit', moveUp: 'Move up', moveDown: 'Move down',
    startTimer: 'Start timer', pause: 'Pause', carried: 'Carried over for', day: 'day', days: 'days',
    dissertation: 'PhD · 2026–2028', thesisPlan: 'Dissertation progress plan', stages: 'stages completed out of',
    overall: 'overall progress', subactivities: 'subactivities', addStage: 'Add a stage to the timeline…', add: 'Add',
    startMonth: 'Start month', endMonth: 'End month', datesMissing: 'Dates to be entered',
    bulkPlaceholder: 'Paste several subsections here, one per line…', bulkHint: 'Each line will create one subactivity.',
    optionalNotes: 'Optional notes for this stage…', delete: 'Delete', completed: 'completed', drafted: 'Drafted',
    onTrack: 'On track', inProgress: 'In progress', upcoming: 'Upcoming', language: 'Language', theme: 'Color',
    green: 'Green', blue: 'Blue', coral: 'Coral', violet: 'Violet', demo: 'Demo · read only', previousDay: 'Previous day', nextDay: 'Next day', backToday: 'Back to today', chooseDate: 'Choose a date', noHistory: 'No tasks recorded for this date.', history: 'Read-only history', events: 'Events and deadlines', publications: 'Publications', conferences: 'Conferences', trainings: 'Training', eventName: 'Name', eventDate: 'Event date', location: 'Location', format: 'Presentation format', fee: 'Participation fee', source: 'Source', saveEvent: 'Save event', abstractSubmission: 'Abstract submission', fullPaperSubmission: 'Full paper submission', presentationSubmission: 'Presentation submission', presentationFinalization: 'Presentation finalization', plannedParticipation: 'Planned participation', inPerson: 'In person', online: 'Online', hybrid: 'Hybrid', importEvent: 'Import from PDF or link', extract: 'Extract', linkPlaceholder: 'Paste the event link…', choosePdf: 'Choose a PDF', reviewImport: 'Review the extracted information before saving it.', reminders: 'Reminders at 09:00, 15:00 and 21:00', enableReminders: 'Enable reminders', remindersEnabled: 'Reminders enabled', nextEvent: 'Next event', noEvents: 'No events recorded in this category.',
  },
  ar: {
    daily: 'اليومي', milestones: 'المراحل', deadlines: 'المواعيد', today: 'اليوم',
    newTask: 'ما الذي يستحق اهتمامك؟', addTask: 'إضافة المهمة', done: 'مكتملة', running: 'قيد التنفيذ',
    clearDay: 'يومك خالٍ. أضف ما يهمك.', high: 'عالية', medium: 'عادية', low: 'منخفضة', notes: 'ملاحظات',
    taskNotes: 'ملاحظات العمل الخاصة بهذه المهمة…', edit: 'تعديل', moveUp: 'نقل لأعلى', moveDown: 'نقل لأسفل',
    startTimer: 'بدء المؤقت', pause: 'إيقاف مؤقت', carried: 'مؤجلة منذ', day: 'يوم', days: 'أيام',
    dissertation: 'الدكتوراه · 2026–2028', thesisPlan: 'خطة تقدم الأطروحة', stages: 'مراحل مكتملة من',
    overall: 'التقدم العام', subactivities: 'أنشطة فرعية', addStage: 'إضافة مرحلة إلى الجدول…', add: 'إضافة',
    startMonth: 'شهر البداية', endMonth: 'شهر النهاية', datesMissing: 'أدخل التواريخ',
    bulkPlaceholder: 'الصق عدة عناوين فرعية هنا، عنوانا في كل سطر…', bulkHint: 'كل سطر ينشئ نشاطا فرعيا.',
    optionalNotes: 'ملاحظات اختيارية لهذه المرحلة…', delete: 'حذف', completed: 'مكتمل', drafted: 'تمت الصياغة',
    onTrack: 'في المسار', inProgress: 'قيد التنفيذ', upcoming: 'قادم', language: 'اللغة', theme: 'اللون',
    green: 'أخضر', blue: 'أزرق', coral: 'مرجاني', violet: 'بنفسجي', demo: 'نسخة تجريبية · للقراءة فقط', previousDay: 'اليوم السابق', nextDay: 'اليوم التالي', backToday: 'العودة إلى اليوم', chooseDate: 'اختر تاريخا', noHistory: 'لا توجد مهام مسجلة لهذا التاريخ.', history: 'سجل للقراءة فقط', events: 'الأحداث والمواعيد', publications: 'المنشورات', conferences: 'المؤتمرات', trainings: 'الدورات التدريبية', eventName: 'الاسم', eventDate: 'تاريخ الحدث', location: 'المكان', format: 'صيغة العرض', fee: 'رسوم المشاركة', source: 'المصدر', saveEvent: 'حفظ الحدث', abstractSubmission: 'تقديم الملخص', fullPaperSubmission: 'تقديم البحث الكامل', presentationSubmission: 'تقديم العرض', presentationFinalization: 'إتمام العرض', plannedParticipation: 'المشاركة المخطط لها', inPerson: 'حضوري', online: 'عبر الإنترنت', hybrid: 'هجين', importEvent: 'استيراد من PDF أو رابط', extract: 'استخراج', linkPlaceholder: 'الصق رابط الحدث…', choosePdf: 'اختر ملف PDF', reviewImport: 'راجع المعلومات المستخرجة قبل حفظها.', reminders: 'تذكيرات الساعة 09 و15 و21', enableReminders: 'تفعيل التذكيرات', remindersEnabled: 'تم تفعيل التذكيرات', nextEvent: 'الحدث القادم', noEvents: 'لا توجد أحداث مسجلة في هذه الفئة.',
  },
} as const

export type MessageKey = keyof typeof messages.fr
export type Translate = (key: MessageKey) => string

export function translator(language: Language): Translate {
  return (key) => messages[language][key]
}
