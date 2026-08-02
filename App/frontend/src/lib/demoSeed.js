import { isoOf, uid } from './format.js'

// Deterministic PRNG — the demo should look the same on every visit and in screenshots.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round = (w, step) => Math.round(w / step) * step
const at = (date, h, m) => { const d = new Date(date); d.setHours(h, m, 0, 0); return d.getTime() }

// Real exercises from user backup — grouped by movement pattern
const PUSH_EXERCISES = [
  { id: '0025', name: 'barbell bench press', sets: 4, baseReps: 8 },      // compound: heavy
  { id: '0047', name: 'barbell incline bench press', sets: 3, baseReps: 10 },
  { id: '0289', name: 'dumbbell bench press', sets: 3, baseReps: 15 },    // volume/hypertrophy
  { id: '0308', name: 'dumbbell fly', sets: 3, baseReps: 15 },
]

const PULL_EXERCISES = [
  { id: '0032', name: 'barbell deadlift', sets: 3, baseReps: 5 },         // compound: heavy
  { id: '0203', name: 'cable rear delt row (with rope)', sets: 4, baseReps: 10 },
  { id: '0861', name: 'cable seated row', sets: 3, baseReps: 10 },
  { id: '0293', name: 'dumbbell bent over row', sets: 3, baseReps: 12 },   // accessory volume
]

const SHOULDER_EXERCISES = [
  { id: '0405', name: 'dumbbell seated shoulder press', sets: 3, baseReps: 10 },   // main compound
  { id: '0334', name: 'dumbbell lateral raise', sets: 3, baseReps: 12 },          // isolation
  { id: '0310', name: 'dumbbell front raise', sets: 3, baseReps: 12 },
  { id: '2137', name: 'dumbbell arnold press', sets: 3, baseReps: 10 },
]

const ARM_EXERCISES = [
  { id: '1646', name: 'dumbbell alternate hammer preacher curl', sets: 3, baseReps: 10 },    // biceps
  { id: '0447', name: 'ez barbell curl', sets: 3, baseReps: 10 },
  { id: '0430', name: 'dumbbell standing triceps extension', sets: 3, baseReps: 15 },       // triceps
  { id: '1749', name: 'ez bar standing french press', sets: 3, baseReps: 15 },
]

// VARIANT 1: Strength-focused (heavy compounds, low reps, slower progression)
const VARIANT_STRENGTH = {
  id: 1,
  name: 'Strength Builder',
  settings: { unit: 'lb', theme: 'dark', accent: 'orange', weightUnit: 'lb', heightUnit: 'in' },
  routines: [
    { id: uid(), name: 'Upper Power', emoji: 'barbell', ex: [
      { id: '0025', sets: 5, reps: 5, weight: 0 },         // barbell bench 5x5
      { id: '0032', sets: 5, reps: 5, weight: 0 },         // deadlift 5x5
      { id: '0293', sets: 4, reps: 6, weight: 0 },         // rows 4x6
    ]},
    { id: uid(), name: 'Lower Power', emoji: 'legs', ex: [
      { id: '0032', sets: 4, reps: 6, weight: 0 },         // deadlift again (different intensity)
      { id: '0405', sets: 4, reps: 8, weight: 0 },         // shoulder press
      { id: '0447', sets: 3, reps: 8, weight: 0 },         // pull compound
    ]},
  ],
  weekPlan: { 1: null, 3: null },  // filled after routine generation
  progression: { '0025': [125, 5], '0032': [185, 10], '0293': [65, 2], '0405': [40, 2], '0447': [80, 3] },
  startBW: 150,
  targetBW: 152,
  endBW: 151,  // lean maintenance
  weeksBack: 6,
  sessionsPerWeek: 4,
}

// VARIANT 2: Hypertrophy-focused (higher reps, more volume, faster progression)
const VARIANT_HYPERTROPHY = {
  id: 2,
  name: 'Muscle Gain',
  settings: { unit: 'lb', theme: 'light', accent: 'orange', weightUnit: 'lb', heightUnit: 'in' },
  routines: [
    { id: uid(), name: 'Push Day', emoji: 'barbell', ex: [
      { id: '0025', sets: 4, reps: 8, weight: 0 },         // bench 4x8
      { id: '0047', sets: 3, reps: 10, weight: 0 },        // incline press 3x10
      { id: '0289', sets: 3, reps: 12, weight: 0 },        // dumbbell bench 3x12
      { id: '0308', sets: 3, reps: 12, weight: 0 },        // fly 3x12
      { id: '0405', sets: 3, reps: 10, weight: 0 },        // shoulder press 3x10
      { id: '0334', sets: 3, reps: 12, weight: 0 },        // lateral raise 3x12
    ]},
    { id: uid(), name: 'Pull Day', emoji: 'pullup', ex: [
      { id: '0032', sets: 3, reps: 5, weight: 0 },         // deadlift 3x5
      { id: '0203', sets: 4, reps: 10, weight: 0 },        // rear delt row 4x10
      { id: '0861', sets: 3, reps: 12, weight: 0 },        // cable row 3x12
      { id: '0293', sets: 3, reps: 12, weight: 0 },        // dumbbell row 3x12
      { id: '1646', sets: 3, reps: 10, weight: 0 },        // hammer curl 3x10
      { id: '0447', sets: 3, reps: 12, weight: 0 },        // ez bar curl 3x12
    ]},
    { id: uid(), name: 'Arms & Delts', emoji: 'sparkles', ex: [
      { id: '0405', sets: 3, reps: 10, weight: 0 },        // shoulder press
      { id: '0334', sets: 4, reps: 12, weight: 0 },        // lateral raise 4x12
      { id: '0310', sets: 3, reps: 12, weight: 0 },        // front raise 3x12
      { id: '1646', sets: 4, reps: 10, weight: 0 },        // hammer curl 4x10
      { id: '0447', sets: 3, reps: 10, weight: 0 },        // ez curl 3x10
      { id: '0430', sets: 3, reps: 12, weight: 0 },        // tricep ext 3x12
      { id: '1749', sets: 3, reps: 12, weight: 0 },        // french press 3x12
    ]},
  ],
  weekPlan: { 1: null, 3: null, 5: null },  // filled after routine generation
  progression: { '0025': [105, 2], '0047': [75, 1.5], '0289': [35, 1], '0032': [145, 5], '0203': [100, 2], '0405': [32, 1] },
  startBW: 148,
  targetBW: 160,
  endBW: 152,  // small deficit at end
  weeksBack: 6,
  sessionsPerWeek: 3,
}

// VARIANT 3: Customized theme/settings (light theme, kg units)
const VARIANT_LIGHT_THEME = {
  id: 3,
  name: 'Light & Lean',
  settings: { unit: 'kg', theme: 'light', accent: 'blue', weightUnit: 'kg', heightUnit: 'cm', lang: 'en', sound: false },
  routines: [
    { id: uid(), name: 'Strength', emoji: 'dumbbell', ex: [
      { id: '0025', sets: 4, reps: 6, weight: 0 },
      { id: '0032', sets: 4, reps: 6, weight: 0 },
    ]},
    { id: uid(), name: 'Accessories', emoji: 'barbell', ex: [
      { id: '0293', sets: 4, reps: 8, weight: 0 },
      { id: '0405', sets: 3, reps: 8, weight: 0 },
    ]},
  ],
  weekPlan: { 1: null, 3: null },
  progression: { '0025': [70, 2], '0032': [100, 3], '0293': [35, 1], '0405': [20, 0.5] },  // kg values
  startBW: 82,
  targetBW: 78,
  endBW: 79,
  weeksBack: 6,
  sessionsPerWeek: 4,
}

const VARIANTS = [VARIANT_STRENGTH, VARIANT_STRENGTH, VARIANT_HYPERTROPHY, VARIANT_HYPERTROPHY, VARIANT_LIGHT_THEME]

function buildDemoVariant(variant) {
  const rnd = rng(variant.id * 1000 + 20260724)
  
  // Assign routine IDs to weekday plan
  const routineIds = variant.routines.map(r => r.id)
  if (variant.weekPlan[1] === null) variant.weekPlan[1] = routineIds[0]
  if (variant.weekPlan[3] === null) variant.weekPlan[3] = routineIds[Math.min(1, routineIds.length - 1)]
  if (variant.weekPlan[5] === null) variant.weekPlan[5] = routineIds[Math.min(2, routineIds.length - 1)]

  const nowH = new Date().getHours()
  const today = new Date(); today.setHours(12, 0, 0, 0)
  const start = new Date(today); start.setDate(start.getDate() - variant.weeksBack * 7)

  const workouts = []
  const bodyweight = []
  const exWeights = {}
  const best = {}

  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const day = new Date(d)
    const iso = isoOf(day)
    const weekIdx = Math.floor((day - start) / (7 * 86400000))
    const p = Math.min(1, weekIdx / variant.weeksBack)

    // Weigh-ins: multiple times per week (Mon, Wed, Fri, Sun) for more detailed tracking
    const dayOfWeekNum = day.getDay()
    if (dayOfWeekNum === 1 || dayOfWeekNum === 3 || dayOfWeekNum === 5 || dayOfWeekNum === 0) {
      const trend = variant.startBW + (variant.endBW - variant.startBW) * p
      const w = trend + (rnd() - 0.5) * 0.5
      bodyweight.push({ d: iso, w: Math.round(w * 10) / 10, t: at(day, 7, 30) })
    }

    // Session scheduling: spread evenly across week
    const dayOfWeek = day.getDay()
    const routineIdx = variant.weekPlan[dayOfWeek]
    if (routineIdx === null || routineIdx === undefined) continue

    const routine = variant.routines.find(r => r.id === routineIdx)
    if (!routine) continue

    if (rnd() < 0.12) continue  // ~12% session skip rate
    if (iso === isoOf(today) && nowH < 17) continue  // leave today open for user to try

    const prs = []
    const entries = routine.ex.map(cfg => {
      const progKey = cfg.id
      const [base, inc] = variant.progression[progKey] || [20, 0.5]
      const w = base ? Math.max(0, round(base + inc * weekIdx, inc >= 2 ? 2.5 : 0.5)) : 0
      
      const sets = []
      for (let i = 0; i < cfg.sets; i++) {
        const drop = i === cfg.sets - 1 && rnd() < 0.4 ? (rnd() < 0.3 ? 2 : 1) : 0
        sets.push({ w, r: Math.max(3, cfg.reps - drop), done: true })
      }

      if (w > (best[cfg.id] || 0)) { best[cfg.id] = w; prs.push(cfg.id) }
      exWeights[cfg.id] = { w: Math.max(w, exWeights[cfg.id]?.w || 0), d: iso }
      
      return { id: cfg.id, sets, topW: w || null }
    })

    const bw = bodyweight.length ? bodyweight[bodyweight.length - 1].w : variant.startBW
    const startMs = at(day, 18, 5 + Math.floor(rnd() * 25))
    const workout = {
      id: uid(), d: iso, start: startMs, end: startMs + (40 + Math.floor(rnd() * 30)) * 60000,
      routineId: routine.id, name: routine.name, bw,
      entries,
      prs: weekIdx === 0 ? [] : prs
    }
    workout.vol = entries.reduce((v, e) => v + e.sets.reduce((n, s) => n + s.w * s.r, 0), 0)
    workouts.push(workout)
  }

  const dayPlan = {}
  const tIso = isoOf(today)
  if (!workouts.some(w => w.d === tIso)) {
    const dayOfWeek = today.getDay()
    dayPlan[tIso] = variant.weekPlan[dayOfWeek]
  }

  return {
    routines: variant.routines,
    week: variant.weekPlan,
    dayPlan,
    workouts, bodyweight, exWeights,
    targetW: variant.targetBW,
    unit: variant.settings.unit,
    theme: variant.settings.theme,
    accent: variant.settings.accent,
  }
}

// Select a random variant on each demo load — keeps it fresh
export function buildDemoState() {
  // Clone variant to avoid mutating the template
  const variantTemplate = VARIANTS[Math.floor(Math.random() * VARIANTS.length)]
  const variant = JSON.parse(JSON.stringify(variantTemplate))
  variant.routines = variantTemplate.routines  // routines have non-serializable uid() calls, use original
  
  const state = buildDemoVariant(variant)
  
  // Merge in all settings from variant
  return {
    ...state,
    heightUnit: variant.settings.heightUnit,
    lang: variant.settings.lang || 'en',
    sound: variant.settings.sound !== false,
    body: 'male',
    gifSize: 'full',
    customEx: [],
    reminder: { on: false, time: '08:00', tz: null },
    programs: [],
  }
}
