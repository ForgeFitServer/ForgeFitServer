// SPDX-License-Identifier: AGPL-3.0-or-later
// Mobile/Capacitor platform detection and native integration
import { t } from './i18n.js'

const FILE = 'ffs-state.json'

// Detect if running in Capacitor mobile app (iOS/Android)
export const MOBILE = window.Capacitor !== undefined

// Load persisted state from native file storage (survives WebView eviction)
export async function nativeLoad() {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 })
    return JSON.parse(r.data)
  } catch (e) { return null }   // first launch, or unreadable — localStorage copy takes over
}

// Save state to native file storage (persistent across app backgrounding)
export async function nativeSave(state) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: FILE, directory: Directory.Data, data: JSON.stringify(state), encoding: Encoding.UTF8 })
  } catch (e) { /* keep the localStorage copy */ }
}

// Schedule daily workout reminder notifications
export async function syncReminder(S, interactive = false) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    if (!S.reminder?.on) { await LocalNotifications.cancel({ notifications: [{ id: 1 }] }); return true }
    const tz = S.reminder.tz || Intl.DateTimeFormat().resolvedOptions().timeZone
    const [h, m] = (S.reminder.time || '08:00').split(':').map(Number)
    const notifications = []
    for (const [day, rid] of Object.entries(S.week || {})) {
      if (!rid || S.dayPlan?.[day] === 'rest') continue
      notifications.push({
        id: 1 + Number(day),
        title: t('Workout day'),
        body: t('{0} is on the plan today — let\'s go!', S.routines.find(x => x.id === rid).name),
        // Capacitor weekdays are 1 (Sunday) … 7 (Saturday); S.week uses getDay() 0…6.
        schedule: { on: { weekday: Number(day) + 1, hour: h, minute: m }, allowWhileIdle: true },
      })
    }
    if (notifications.length) await LocalNotifications.schedule({ notifications })
    return true
  } catch (e) { return false }
}

// Share export for mobile (uses OS share sheet instead of download)
export async function shareExport(json, name) {
  try {
    const { Share } = await import('@capacitor/share')
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: name + '.json', directory: Directory.Cache, data: json, encoding: Encoding.UTF8 })
    const { uri } = await Filesystem.getUri({ path: name + '.json', directory: Directory.Cache })
    await Share.share({ url: uri, title: name })
  } catch (e) { /* user dismissed or unsupported */ }
}
