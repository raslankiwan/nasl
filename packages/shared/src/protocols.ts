import { addDays, daysBetween, toDateString } from './dates.ts';

/**
 * Herd health protocols (FR-HLT-07) — the schedule of routine doses, derived per animal.
 *
 * The library below is a *default*, assembled from published guidance and narrowed to what is
 * endemic in Palestine. It is not a prescription. Four of the six protocols here are delivered by
 * the Ministry of Agriculture as official campaigns rather than bought by the farm, and one of
 * them (Rev-1) is a live zoonotic vaccine that a farmer must never administer alone. The app's job
 * for those is to say *a dose is due and has not been recorded* — not to tell anyone to inject
 * anything. Every protocol carries its source so a vet can check the reasoning and a farm can
 * override it.
 *
 * Doses are derived, never stored: the same animal, the same day and the same completed history
 * must produce the same list on the server and on a phone with no signal.
 */

export const PROTOCOL_DISCLAIMER = {
  en: 'A suggested schedule based on published guidance for the region. Confirm timing, product and dose with your veterinarian and the Ministry of Agriculture before treating any animal.',
  ar: 'جدول مقترح مبني على إرشادات منشورة للمنطقة. أكّد المواعيد والمستحضر والجرعة مع الطبيب البيطري ووزارة الزراعة قبل معالجة أي حيوان.',
} as const;

/** What the step's date is measured from. */
export const PROTOCOL_TRIGGERS = [
  'age',
  'after-step',
  'pre-lambing',
  'post-lambing',
  'annual',
] as const;
export type ProtocolTrigger = (typeof PROTOCOL_TRIGGERS)[number];

/** Who puts the needle in. Drives whether the task reads as "buy and give" or "campaign due". */
export type ProtocolDelivery = 'farm' | 'official';

export interface ProtocolStep {
  id: string;
  nameEn: string;
  nameAr: string;
  trigger: ProtocolTrigger;
  /**
   * Days from the trigger. For `pre-lambing` this counts *backwards* from the due date, so 28
   * means four weeks before she is expected to lamb.
   */
  offsetDays: number;
  /**
   * The step this one follows. A second dose is measured from when the first was actually given,
   * not from a date on a calendar — a primary course started three weeks late is still a valid
   * course, and telling the farm otherwise would have them re-start it.
   *
   * Required by `after-step`; on an `annual` step it means the yearly clock does not start until
   * the primary has been recorded.
   */
  after?: string;
  /** How long the dose stays useful after its date before it is simply late. */
  windowDays: number;
  /** Restricts the step to part of the flock. Absent keys mean "no restriction". */
  appliesTo?: {
    sex?: 'female' | 'male';
    minAgeDays?: number;
    maxAgeDays?: number;
  };
  /** Shown on the task. Kept short — it has to be readable on a phone in a pen. */
  noteEn?: string;
  noteAr?: string;
}

export interface Protocol {
  id: string;
  nameEn: string;
  nameAr: string;
  /** The disease this protects against, matching a `SEED_DISEASES` id where one exists. */
  diseaseId?: string;
  deliveredBy: ProtocolDelivery;
  /** Enabled for a new Palestinian farm without anyone choosing it. */
  defaultOn: boolean;
  /**
   * The published guidance this schedule is drawn from, in both languages.
   *
   * Arabic too, and not only the English citation: this is the farm's answer to "why is the app
   * telling me this", and an Arabic-first product that hands a Palestinian herder an English
   * paragraph has not actually answered them.
   */
  source: { en: string; ar: string };
  steps: ProtocolStep[];
}

/**
 * The curated default library.
 *
 * Clostridial cover is the one a farm buys and gives itself, and the one with the clearest
 * published timing. PPR, sheep pox, FMD and brucellosis are endemic-region campaign vaccines.
 * Routine anthelmintic is deliberately off by default — blanket dosing on a calendar is how a
 * flock breeds resistant worms, and the guidance is to dose on evidence instead.
 */
export const PROTOCOL_LIBRARY: readonly Protocol[] = [
  {
    id: 'clostridial',
    nameEn: 'Clostridial and pasteurella cover',
    nameAr: 'التحصين ضد التسمم المعوي والباستوريلا',
    diseaseId: 'enterotoxaemia',
    deliveredBy: 'farm',
    defaultOn: true,
    source: {
      en: 'NADIS clostridial & pasteurella vaccination; Michigan State University and South Dakota State University extension guidance on enterotoxaemia timing.',
      ar: 'إرشادات NADIS للتحصين ضد الكلوستريديا والباستوريلا، وإرشادات جامعتي ميشيغان ستيت وساوث داكوتا ستيت بشأن توقيت التسمم المعوي.',
    },
    steps: [
      {
        id: 'clostridial-ewe-primary-1',
        nameEn: 'First dose (new breeding female)',
        nameAr: 'الجرعة الأولى (أنثى جديدة في القطيع)',
        trigger: 'age',
        offsetDays: 180,
        windowDays: 60,
        appliesTo: { sex: 'female', minAgeDays: 150 },
        noteEn: 'Primary course: two doses 4–6 weeks apart, before her first lambing.',
        noteAr: 'الجرعة الأساسية: جرعتان بفارق ٤–٦ أسابيع قبل أول ولادة.',
      },
      {
        id: 'clostridial-ewe-primary-2',
        nameEn: 'Second dose (new breeding female)',
        nameAr: 'الجرعة الثانية (أنثى جديدة في القطيع)',
        trigger: 'after-step',
        after: 'clostridial-ewe-primary-1',
        offsetDays: 35,
        windowDays: 21,
        appliesTo: { sex: 'female' },
        noteEn: 'Four to six weeks after the first dose.',
        noteAr: 'بعد ٤–٦ أسابيع من الجرعة الأولى.',
      },
      {
        id: 'clostridial-prelambing',
        nameEn: 'Pre-lambing booster',
        nameAr: 'الجرعة المنشطة قبل الولادة',
        trigger: 'pre-lambing',
        offsetDays: 28,
        windowDays: 14,
        appliesTo: { sex: 'female' },
        noteEn:
          'Four weeks before lambing, so the antibodies reach the lamb through the colostrum.',
        noteAr: 'قبل الولادة بأربعة أسابيع لتصل المناعة إلى المولود عبر اللبأ.',
      },
      {
        id: 'clostridial-lamb-1',
        nameEn: 'Lamb first dose',
        nameAr: 'الجرعة الأولى للمولود',
        trigger: 'age',
        offsetDays: 56,
        windowDays: 21,
        appliesTo: { maxAgeDays: 180 },
        noteEn:
          'From about eight weeks, once the cover from the mother’s colostrum is fading. Earlier (three weeks) if the mother was not vaccinated.',
        noteAr:
          'من عمر ثمانية أسابيع تقريباً مع تراجع مناعة اللبأ. أبكر (ثلاثة أسابيع) إذا لم تُحصّن الأم.',
      },
      {
        id: 'clostridial-lamb-2',
        nameEn: 'Lamb second dose',
        nameAr: 'الجرعة الثانية للمولود',
        trigger: 'after-step',
        after: 'clostridial-lamb-1',
        offsetDays: 28,
        windowDays: 21,
        noteEn: 'Four weeks after the first dose. One dose alone does not protect.',
        noteAr: 'بعد أربعة أسابيع من الجرعة الأولى. الجرعة الواحدة وحدها لا تحمي.',
      },
    ],
  },
  {
    id: 'ppr',
    nameEn: 'Peste des Petits Ruminants (PPR)',
    nameAr: 'طاعون المجترات الصغيرة',
    diseaseId: 'ppr',
    deliveredBy: 'official',
    defaultOn: true,
    source: {
      en: 'WOAH Terrestrial Manual ch. 3.7.9 (PPR) and the WOAH/FAO Global Strategy for the Control and Eradication of PPR; Nigeria 75/1 live attenuated strain.',
      ar: 'دليل المنظمة العالمية لصحة الحيوان (WOAH) الفصل ٣.٧.٩، والاستراتيجية العالمية لمكافحة طاعون المجترات الصغيرة واستئصاله (WOAH/FAO)؛ العترة الحية الموهنة نيجيريا ٧٥/١.',
    },
    steps: [
      {
        id: 'ppr-first',
        nameEn: 'First vaccination',
        nameAr: 'التحصين الأول',
        trigger: 'age',
        offsetDays: 90,
        windowDays: 60,
        noteEn:
          'From three months. Earlier than that the mother’s antibodies blunt the response, so a lamb done at one month needs repeating.',
        noteAr:
          'من عمر ثلاثة أشهر. قبل ذلك تعيق مناعة الأم الاستجابة، فالمولود المحصّن في الشهر الأول يحتاج إعادة.',
      },
      {
        id: 'ppr-annual',
        nameEn: 'Annual booster',
        nameAr: 'الجرعة السنوية',
        trigger: 'annual',
        after: 'ppr-first',
        offsetDays: 365,
        windowDays: 60,
        noteEn: 'One dose protects for at least a year. Usually given in the ministry campaign.',
        noteAr: 'الجرعة الواحدة تحمي سنة على الأقل. تُعطى عادة ضمن حملة الوزارة.',
      },
    ],
  },
  {
    id: 'sheep-pox',
    nameEn: 'Sheep pox and goat pox',
    nameAr: 'جدري الأغنام والماعز',
    diseaseId: 'sheep-pox',
    deliveredBy: 'official',
    defaultOn: true,
    source: {
      en: 'WOAH Terrestrial Manual, sheep pox and goat pox; combined PPR/sheep pox vaccine studies showing 12-month protection from a single dose.',
      ar: 'دليل المنظمة العالمية لصحة الحيوان، جدري الأغنام والماعز؛ ودراسات اللقاح المشترك مع طاعون المجترات التي تُظهر حماية اثني عشر شهراً من جرعة واحدة.',
    },
    steps: [
      {
        id: 'pox-first',
        nameEn: 'First vaccination',
        nameAr: 'التحصين الأول',
        trigger: 'age',
        offsetDays: 90,
        windowDays: 60,
        noteEn: 'Often given at the same visit as PPR.',
        noteAr: 'تُعطى غالباً في نفس زيارة طاعون المجترات.',
      },
      {
        id: 'pox-annual',
        nameEn: 'Annual booster',
        nameAr: 'الجرعة السنوية',
        trigger: 'annual',
        after: 'pox-first',
        offsetDays: 365,
        windowDays: 60,
      },
    ],
  },
  {
    id: 'brucellosis',
    nameEn: 'Brucellosis (Rev-1)',
    nameAr: 'البروسيلا (ريف-١)',
    diseaseId: 'brucellosis',
    deliveredBy: 'official',
    defaultOn: true,
    source: {
      en: 'B. melitensis Rev-1 conjunctival vaccination of replacement females, the mainstay of small-ruminant brucellosis control; West Bank seroprevalence work and the Jordanian national programme.',
      ar: 'التحصين الملتحمي بلقاح ريف-١ للإناث البديلة، وهو أساس مكافحة البروسيلا في المجترات الصغيرة؛ استناداً إلى دراسات الانتشار المصلي في الضفة الغربية والبرنامج الوطني الأردني.',
    },
    steps: [
      {
        id: 'brucellosis-rev1',
        nameEn: 'Rev-1, replacement females',
        nameAr: 'ريف-١ للإناث البديلة',
        trigger: 'age',
        offsetDays: 120,
        windowDays: 90,
        appliesTo: { sex: 'female', minAgeDays: 90, maxAgeDays: 240 },
        noteEn:
          'Once in her life, between three and eight months. A live vaccine that infects people: it is given by the veterinary service, never by the farm, and never to a pregnant animal.',
        noteAr:
          'مرة واحدة في العمر بين ثلاثة وثمانية أشهر. لقاح حي ينتقل للإنسان: تعطيه الخدمات البيطرية حصراً، ولا يُعطى للحامل.',
      },
    ],
  },
  {
    id: 'fmd',
    nameEn: 'Foot and mouth disease',
    nameAr: 'الحمى القلاعية',
    diseaseId: 'fmd',
    deliveredBy: 'official',
    defaultOn: true,
    source: {
      en: 'Regional practice for endemic settings; Jordanian field work showing twice-yearly vaccination of small ruminants gives materially better titres and fewer clinical cases than annual.',
      ar: 'الممارسة المتبعة إقليمياً في المناطق الموبوءة؛ ودراسات ميدانية أردنية تُظهر أن التحصين مرتين سنوياً للمجترات الصغيرة يعطي مناعة أعلى وحالات مرضية أقل من مرة واحدة.',
    },
    steps: [
      {
        id: 'fmd-round',
        nameEn: 'Vaccination round',
        nameAr: 'جولة التحصين',
        trigger: 'annual',
        offsetDays: 182,
        windowDays: 45,
        appliesTo: { minAgeDays: 120 },
        noteEn:
          'Twice a year where the campaign runs — protection fades well before twelve months.',
        noteAr: 'مرتان سنوياً حيث تتوفر الحملة — تتراجع المناعة قبل اكتمال السنة بكثير.',
      },
    ],
  },
  {
    id: 'parasites',
    nameEn: 'Worm control',
    nameAr: 'مكافحة الديدان',
    diseaseId: 'internal-parasites',
    deliveredBy: 'farm',
    // Off unless a farm turns it on: dosing the whole flock on a calendar is how resistant worms
    // are bred. The guidance is to dose on faecal egg counts and condition, not on a date.
    defaultOn: false,
    source: {
      en: 'Standard small-ruminant parasite guidance: treat on faecal egg counts and body condition rather than on a fixed calendar, to slow anthelmintic resistance.',
      ar: 'الإرشاد المعتاد لطفيليات المجترات الصغيرة: العلاج بناءً على فحص بيوض الديدان في الروث وحالة الجسم لا على جدول ثابت، للحد من مقاومة الأدوية.',
    },
    steps: [
      {
        id: 'parasites-prelambing',
        nameEn: 'Pre-lambing check',
        nameAr: 'فحص ما قبل الولادة',
        trigger: 'pre-lambing',
        offsetDays: 21,
        windowDays: 14,
        appliesTo: { sex: 'female' },
        noteEn: 'Check, then treat only what needs it. Withdrawal periods apply to milk as well.',
        noteAr: 'افحص ثم عالج ما يحتاج فقط. فترات الأمان تسري على الحليب أيضاً.',
      },
      {
        id: 'parasites-post-weaning',
        nameEn: 'Post-weaning check',
        nameAr: 'فحص بعد الفطام',
        trigger: 'age',
        offsetDays: 120,
        windowDays: 45,
        appliesTo: { maxAgeDays: 300 },
      },
    ],
  },
];

export function protocolById(id: string): Protocol | undefined {
  return PROTOCOL_LIBRARY.find((p) => p.id === id);
}

/** The protocols a new Palestinian farm starts with. */
export function defaultProtocolIds(): string[] {
  return PROTOCOL_LIBRARY.filter((p) => p.defaultOn).map((p) => p.id);
}

/** The minimum an animal must carry for its schedule to be derived. */
export interface ProtocolSubject {
  id: string;
  tagNumber: string;
  classLabel?: string | null;
  name?: string | null;
  sex: string;
  status: string;
  dateOfBirth?: string | Date | null;
  repro?: {
    state: string;
    dueDate?: string | Date | null;
    sinceDate?: string | Date | null;
  } | null;
}

/** A dose already given, matched back to the step that asked for it. */
export interface ProtocolCompletion {
  animalId: string;
  stepId: string;
  date: string | Date;
}

export interface ProtocolTask {
  animalId: string;
  tagNumber: string;
  classLabel?: string | null;
  name: string | null;
  protocolId: string;
  stepId: string;
  nameEn: string;
  nameAr: string;
  noteEn: string | null;
  noteAr: string | null;
  deliveredBy: ProtocolDelivery;
  dueOn: string;
  /** Negative once the date has passed. */
  daysUntilDue: number;
  status: 'upcoming' | 'due' | 'overdue';
}

function asDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function matches(step: ProtocolStep, animal: ProtocolSubject, ageDays: number | null): boolean {
  const rule = step.appliesTo;
  if (!rule) return true;
  if (rule.sex && animal.sex !== rule.sex) return false;
  if (rule.minAgeDays != null && (ageDays == null || ageDays < rule.minAgeDays)) return false;
  if (rule.maxAgeDays != null && (ageDays == null || ageDays > rule.maxAgeDays)) return false;
  return true;
}

const CARRYING = new Set(['mated', 'pregnant', 'due']);

/**
 * When is this step due for this animal, if at all?
 *
 * Returns null when the trigger has nothing to measure from — an unknown birth date, a ewe who is
 * not carrying, a second dose whose first has not been given. A missing date produces no task
 * rather than a guessed one.
 */
function dueDateFor(
  step: ProtocolStep,
  animal: ProtocolSubject,
  doneAt: (stepId: string) => Date | null,
  today: Date,
): Date | null {
  const dob = asDate(animal.dateOfBirth);
  const lastDone = doneAt(step.id);

  switch (step.trigger) {
    case 'age': {
      if (!dob) return null;
      // A one-off dose already given never comes round again.
      return lastDone ? null : addDays(dob, step.offsetDays);
    }
    case 'after-step': {
      if (lastDone) return null;
      const prerequisite = step.after ? doneAt(step.after) : null;
      // Nothing to follow yet. The first dose carries the reminder until it is given.
      if (!prerequisite) return null;
      return addDays(prerequisite, step.offsetDays);
    }
    case 'pre-lambing': {
      if (!animal.repro || !CARRYING.has(animal.repro.state)) return null;
      const due = asDate(animal.repro.dueDate);
      if (!due) return null;
      const dueOn = addDays(due, -step.offsetDays);
      // Already done for this pregnancy. Last year's booster does not cover this lamb.
      if (lastDone && daysBetween(lastDone, dueOn) <= step.windowDays) return null;
      return dueOn;
    }
    case 'post-lambing': {
      const since = asDate(animal.repro?.sinceDate);
      if (!since || !animal.repro || CARRYING.has(animal.repro.state)) return null;
      if (lastDone && lastDone >= since) return null;
      return addDays(since, step.offsetDays);
    }
    case 'annual': {
      if (lastDone) return addDays(lastDone, step.offsetDays);
      // The yearly clock starts at the primary dose, so an adult with no history owes the primary
      // first and is not asked for both at once.
      if (step.after) {
        const primary = doneAt(step.after);
        return primary ? addDays(primary, step.offsetDays) : null;
      }
      // No primary in this protocol: due as soon as the animal is old enough.
      const earliest = step.appliesTo?.minAgeDays;
      if (dob && earliest != null) return addDays(dob, earliest);
      return today;
    }
  }
}

/**
 * Everything a flock owes, from the protocols a farm has switched on.
 *
 * `horizonDays` bounds how far ahead to look — a task six months out is noise, and the phone shows
 * a fortnight. Overdue work is always returned regardless of the horizon.
 */
export function dueProtocolTasks(
  animals: readonly ProtocolSubject[],
  enabledProtocolIds: readonly string[],
  completions: readonly ProtocolCompletion[],
  today: Date,
  horizonDays = 30,
): ProtocolTask[] {
  const enabled = new Set(enabledProtocolIds);
  const protocols = PROTOCOL_LIBRARY.filter((p) => enabled.has(p.id));
  if (protocols.length === 0) return [];

  // Latest dose per animal per step — a step repeated is measured from the most recent one.
  const latest = new Map<string, Date>();
  for (const done of completions) {
    const date = asDate(done.date);
    if (!date) continue;
    const key = `${done.animalId}:${done.stepId}`;
    const current = latest.get(key);
    if (!current || date > current) latest.set(key, date);
  }

  const tasks: ProtocolTask[] = [];

  for (const animal of animals) {
    if (animal.status !== 'active') continue;
    const dob = asDate(animal.dateOfBirth);
    const ageDays = dob ? daysBetween(dob, today) : null;

    for (const protocol of protocols) {
      for (const step of protocol.steps) {
        if (!matches(step, animal, ageDays)) continue;

        const dueOn = dueDateFor(
          step,
          animal,
          (stepId) => latest.get(`${animal.id}:${stepId}`) ?? null,
          today,
        );
        if (!dueOn) continue;

        const daysUntilDue = daysBetween(today, dueOn);
        if (daysUntilDue > horizonDays) continue;

        tasks.push({
          animalId: animal.id,
          tagNumber: animal.tagNumber,
          ...(animal.classLabel ? { classLabel: animal.classLabel } : {}),
          name: animal.name ?? null,
          protocolId: protocol.id,
          stepId: step.id,
          nameEn: step.nameEn,
          nameAr: step.nameAr,
          noteEn: step.noteEn ?? null,
          noteAr: step.noteAr ?? null,
          deliveredBy: protocol.deliveredBy,
          dueOn: toDateString(dueOn),
          daysUntilDue,
          status:
            daysUntilDue < -step.windowDays ? 'overdue' : daysUntilDue <= 0 ? 'due' : 'upcoming',
        });
      }
    }
  }

  // Most overdue first: the phone shows the top of this list and nothing else.
  return tasks.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}
