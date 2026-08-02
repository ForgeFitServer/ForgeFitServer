import { EXDB } from './exercises-data.js'

export { EXDB }
// Index for O(1) lookup of exercise metadata by ID
export const EXIDX = {}
EXDB.forEach(e => { EXIDX[e.id] = e })
// Sorted list of unique body parts
export const BODYPARTS = [...new Set(EXDB.map(e => e.bp))].sort()

// Count equipment usage in a list of exercises
export function equipmentOf(list) {
  const c = {}
  list.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
}

// Register user-created custom exercises (add to lookup, remove old ones)
let customIds = []
export function registerCustom(list) {
  customIds.forEach(id => delete EXIDX[id])
  customIds = (list || []).map(e => e.id)
  ;(list || []).forEach(e => { EXIDX[e.id] = e })
}

// Base paths for exercise images and demo GIFs
const IMG_BASE = import.meta.env.VITE_IMG_BASE || 'img/'
const GIF_BASE = import.meta.env.VITE_GIF_BASE || 'gif/'
export const imgSrc = ex => IMG_BASE + ex.img
export const gifSrc = ex => GIF_BASE + ex.gif

// Check if exercise is cardio (vs strength/conditioning)
export const isCardio = idOrEx => (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.bp === 'cardio'

// Combine all available exercises (dataset + user-created custom exercises)
export const allExercises = (state) => [...EXDB, ...(state?.customEx || [])]
