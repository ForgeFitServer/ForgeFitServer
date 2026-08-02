import { ICON_NAMES } from '../components/Icon.jsx'

export const DEFAULT_GLYPH = 'figureStrength'

export const GLYPH_GROUPS = [
  { key: 'Strength',  items: ['figureStrength', 'arm', 'abs', 'legs', 'pullup'] },
  { key: 'Equipment', items: ['dumbbell', 'barbell', 'kettlebell', 'plate', 'machine'] },
  { key: 'Cardio',    items: ['figureRun', 'bike', 'swim', 'boxing', 'timer'] },
  { key: 'Recovery',  items: ['stretch', 'moon', 'heart', 'flame', 'bolt'] },
]
export const GLYPHS = GLYPH_GROUPS.flatMap(g => g.items)

const LEGACY = {
  '💪': 'arm', '🦾': 'arm', '🫸': 'figureStrength', '🫷': 'pullup',
  '🏋️': 'dumbbell', '🏋': 'dumbbell', '🏋️‍♀️': 'dumbbell',
  '🦵': 'legs', '🍑': 'legs',
  '🔥': 'flame', '⚡': 'bolt', '💥': 'bolt', '🧨': 'bolt', '😤': 'flame',
  '🏃': 'figureRun', '🏃‍♀️': 'figureRun', '🚴': 'bike', '🏊': 'swim',
  '🤸': 'stretch', '🧘': 'stretch', '🧘‍♀️': 'stretch',
  '🥊': 'boxing', '🧗': 'pullup', '⛰️': 'figureRun', '🏔️': 'figureRun', '🚀': 'bolt',
  '🎯': 'target', '🏆': 'trophy', '🥇': 'medal', '⭐': 'star', '🌟': 'star',
  '👑': 'crown', '🛡️': 'shield', '⚔️': 'shield', '❤️‍🔥': 'heart',
  '🦍': 'kettlebell', '🐂': 'barbell', '🐻': 'kettlebell', '🦁': 'boxing',
  '🐺': 'figureRun', '🦈': 'swim', '🤖': 'machine',
}

export function glyphOf(v) {
  if (!v) return DEFAULT_GLYPH
  if (ICON_NAMES.includes(v)) return v
  if (LEGACY[v]) return LEGACY[v]
  const base = [...v].filter(c => c !== '️' && c !== '‍')[0]
  return LEGACY[base] || DEFAULT_GLYPH
}
