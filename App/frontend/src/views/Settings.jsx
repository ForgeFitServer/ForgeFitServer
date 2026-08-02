// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, DEF, hasData } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { ACCENTS, todayISO, localTZ } from '../lib/format.js'
import { webauthnOK, passkeyLogin, passkeyRegister, IS_ANDROID, getAuthMethods, addPasskeyOptions, addPasskeyVerify, setPassword, changePassword, removePasskey as removePasskeyAPI, removePassword } from '../lib/api.js'
import { pushSupported, enablePush, disablePush, sendTestPush } from '../lib/push.js'
import { t, LANGS, INSTR_LANGS } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { MOBILE, shareExport, syncReminder } from '../lib/mobile.js'
import { EXDB } from '../lib/exercises.js'
import { loadStarterPlan, confirmSheet, importFromApp } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import Avatar from '../components/Avatar.jsx'
import { Section, Row, SelectRow, Switch, Segmented, Button, TextField } from '../components/ui.jsx'

export default function Settings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const { update, replaceState, setUser, pullState, pushState, signOut, resetDemo } = useStore()
  const toast = useUI(s => s.toast)
  const fileRef = useRef(null)
  const importRef = useRef(null)
  const avatarRef = useRef(null)

  // Resize image to square data URL (offline)
  const doAvatar = ev => {
    const f = ev.target.files[0]; ev.target.value = ''
    if (!f) return
    if (f.size > 8 * 1024 * 1024) { toast(t('Image too large (max 8 MB)')); return }
    const rd = new FileReader()
    rd.onload = () => {
      const img = new Image()
      img.onload = () => {
        const S_ = 256
        const c = document.createElement('canvas'); c.width = S_; c.height = S_
        const g = c.getContext('2d')
        const min = Math.min(img.width, img.height)
        const sx = (img.width - min) / 2, sy = (img.height - min) / 2
        g.drawImage(img, sx, sy, min, min, 0, 0, S_, S_)
        update(s => { s.avatar = c.toDataURL('image/jpeg', 0.82) })
        toast(t('Photo updated'))
      }
      img.onerror = () => toast(t('Could not read image'))
      img.src = rd.result
    }
    rd.readAsDataURL(f)
  }

  // Export all user data as JSON backup (includes workouts with RPE)
  const doExport = async () => {
    // Format export data
    const exportData = {
      _info: {
        exportedAt: new Date().toISOString(),
        appName: 'Forge Fitness Server',
        appVersion: '1.0',
        backupType: 'complete_user_data'
      },
      settings: {
        weightUnit: S.unit,
        heightUnit: S.heightUnit || 'in',
        language: S.lang,
        theme: S.theme,
        accentColor: S.accent,
        bodyDiagramType: S.body,
        restTimerSeconds: S.restSec,
        soundEnabled: S.sound,
        gifSize: S.gifSize
      },
      profile: {
        goalWeightInUnit: S.targetW,
        heightInUnit: S.height,
        reminder: S.reminder,
        avatar: S.avatar || null
      },
      workouts: (S.workouts || []).map(w => ({
        date: w?.d || null,
        name: w?.name || null,
        exercises: (w?.entries || []).map(e => ({
          exerciseName: e?.name || EXDB[e?.id]?.n || null,
          exerciseId: e?.id || null,
          // Each set includes reps, weight, and RPE (if tracked)
          sets: (e?.sets || []).map(set => ({
            reps: set?.r || 0,
            weight: set?.w || null,
            bodyweightOnly: set?.bw === true,
            rpe: set?.rpe || null,
            note: set?.note || null
          }))
        }))
      })),
      routines: (S.routines || []).map(r => ({
        id: r?.id || null,
        name: r?.name || null,
        emoji: r?.emoji || null,
        exercises: (r?.ex || []).map(e => ({
          exerciseId: e?.id || null,
          exerciseName: (e?.name) || null,
          sets: e?.sets || 3,
          reps: e?.reps || 10,
          weight: e?.weight || 0,
          trackRpe: e?.trackRpe || false,
          supersetGroup: e?.sg || null
        }))
      })),
      bodyweightHistory: (S.bodyweight || []).map(b => ({
        date: b?.d || null,
        weightInUnit: b?.w || null
      })),
      customExercises: (S.customEx || []).map(e => ({
        id: e?.id || null,
        name: e?.n || null,
        bodyPart: e?.bp || null,
        equipment: e?.eq || 'custom',
        targetGroup: e?.tg || ''
      })),
      programs: (S.programs || []).map(p => ({
        id: p?.id || null,
        name: p?.name || null,
        desc: p?.desc || '',
        emoji: p?.emoji || '',
        coach: p?.coach || '',
        dayIds: p?.dayIds || []
      }))
    })
    const json = JSON.stringify(exportData, null, 2)
    const name = 'ffs-backup-' + todayISO() + '.json'
    // Mobile uses OS share sheet; desktop downloads file
    if (MOBILE) {
      try { await shareExport(json, name); toast(t('Backup exported')) } catch (e) { /* share sheet dismissed */ }
      return
    }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    toast(t('Backup exported'))
  }
  const doImport = ev => {
    const f = ev.target.files[0]; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result)
        // Support old/new backup formats
        const isNewFormat = !!data._info
        let stateData = data
        if (isNewFormat) {
          stateData = {
            unit: data.settings?.weightUnit || 'lb',
            heightUnit: data.settings?.heightUnit || 'in',
            lang: data.settings?.language || 'en',
            theme: data.settings?.theme || 'dark',
            accent: data.settings?.accentColor || 'red',
            body: data.settings?.bodyDiagramType || 'male',
            restSec: data.settings?.restTimerSeconds || 90,
            sound: data.settings?.soundEnabled !== false,
            gifSize: data.settings?.gifSize || 'full',
            targetW: data.profile?.goalWeightInUnit || null,
            height: data.profile?.heightInUnit || null,
            reminder: data.profile?.reminder || DEF.reminder,
            workouts: (data.workouts || []).map(w => {
              const entries = (w.exercises || []).map(e => {
                const sets = (e.sets || []).map(s => ({
                  r: s.reps || 0,
                  w: s.weight ?? null,
                  bw: s.bodyweightOnly || false,
                  done: true,
                  ...(s.rpe != null ? { rpe: s.rpe } : {}),
                  ...(s.note ? { note: s.note } : {}),
                }))
                const topW = sets.reduce((m, s) => Math.max(m, s.w || 0), 0)
                return { id: e.exerciseId, name: e.exerciseName, sets, topW: topW || null }
              })
              const base = new Date((w.date || '2000-01-01') + 'T12:00:00').getTime()
              const vol = entries.reduce((a, e) => a + e.sets.reduce((b, s) => b + (s.w || 0) * (s.r || 0), 0), 0)
              return {
                id: 'bk' + Math.random().toString(36).substr(2, 9),
                d: w.date,
                name: w.name || null,
                entries,
                prs: [],
                vol,
                start: base,
                end: base + 3600000,
                routineId: null,
              }
            }),
            routines: (data.routines || []).map(r => ({
              id: r.id || ('r' + Math.random().toString(36).substr(2, 9)),
              name: r.name,
              emoji: r.emoji || null,
              ex: (r.exercises || r.days || []).map(e => ({
                id: e.exerciseId || e.id,
                name: e.exerciseName || e.name || null,
                sets: e.sets || (e.setScheme?.length) || 3,
                reps: e.reps || (e.setScheme?.[0]?.reps) || 10,
                weight: e.weight || 0,
                trackRpe: e.trackRpe || false,
                ...(e.supersetGroup ? { sg: e.supersetGroup } : {})
              }))
            })),
            programs: (data.programs || []).map(p => ({
              id: p.id || ('prog' + Math.random().toString(36).substr(2, 9)),
              name: p.name || 'Program',
              desc: p.desc || '',
              emoji: p.emoji || '',
              coach: p.coach || '',
              dayIds: Array.isArray(p.dayIds) ? p.dayIds : [],
              photo: null
            })),
            bodyweight: (data.bodyweightHistory || []).map(b => ({
              d: b.date,
              w: b.weightInUnit
            })),
            customEx: (data.customExercises || []).map(e => ({
              id: e.id,
              n: e.name,
              bp: e.bodyPart || (e.muscleGroups?.[0]) || 'upper legs',
              eq: e.equipment || 'custom',
              tg: e.targetGroup || '',
              custom: true
            })),
            week: {},
            dayPlan: {},
            exWeights: {},
            active: null,
            avatar: data.profile?.avatar || null
          }
        }
        
        if (!stateData.workouts || !stateData.routines) throw new Error('not a ' + __BRAND_NAME__ + ' backup')
        confirmSheet({ title: t('Import backup?'), message: t('This replaces all current data with the backup file.'), confirmText: t('Import'), danger: true, onConfirm: () => { replaceState(Object.assign(JSON.parse(JSON.stringify(DEF)), stateData), true); toast(t('Backup imported')) } })
      } catch (e) { toast(t('Import failed: {0}', e.message)) }
    }
    rd.readAsText(f)
  }
  const signInHere = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Sign-in failed')) }
  }
  const registerHere = () => useUI.getState().openSheet(close => <RegisterInline close={close} setUser={setUser} pushState={pushState} pullState={pullState} toast={toast} />)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Settings')}</h1></div>
    </div>

    {/* ---------- account (demo and mobile builds have nothing to sign in to) ---------- */}
    <Section title={MOBILE ? t('Your data') : DEMO ? t('Demo') : t('Account')}>
      {MOBILE ? <>
        <Row icon="lock" iconTint="var(--acc)" title={t('All data stays on this phone')} subtitle={t('No account, no cloud — back it up anytime with Export below.')} />
        <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host ' + __BRAND_NAME__)} subtitle={t('Passkey sign-in, sync across your devices, your own data.')} accessory="chevron"
          onClick={() => window.open(REPO, '_blank', 'noopener')} />
      </> : DEMO ? <>
        <Row icon="sparkles" iconTint="var(--acc)" title={t('You’re in the demo')} subtitle={t('Example data, stored only in this browser — change anything you like.')} />
        <Row icon="reset" iconTint="var(--blue)" title={t('Reset demo data')} accessory="chevron"
          onClick={() => confirmSheet({ title: t('Reset demo data?'), message: t('Puts the example plan, workouts and weigh-ins back the way they started.'), confirmText: t('Reset'), onConfirm: () => { resetDemo(); nav('/home'); toast(t('Demo data reset')) } })} />
        <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host ' + __BRAND_NAME__)} subtitle={t('Passkey sign-in, sync across your devices, your own data.')} accessory="chevron"
          onClick={() => window.open(REPO, '_blank', 'noopener')} />
      </> : user ? <>
        <Row leftNode={<Avatar id={user.id} name={user.name} src={S.avatar} size={44} style={{ marginRight: 4 }} />}
          title={user.name} subtitle={t('Signed in with passkey — data syncs to this profile.')} />
        <Row icon="camera" iconTint="var(--teal)" title={S.avatar ? t('Change photo') : t('Add profile photo')} accessory="chevron" onClick={() => avatarRef.current.click()} />
        {S.avatar && <Row icon="trash" iconTint="var(--grey)" title={t('Remove photo')} onClick={() => update(s => { s.avatar = null })} />}
        {user.coach && <Row icon="award" iconTint="var(--acc)" title={t('Coach dashboard')} accessory="chevron" onClick={() => nav('/coach')} />}
        {user.admin && <Row icon="wrench" iconTint="var(--indigo)" title={t('Admin dashboard')} accessory="chevron" onClick={() => nav('/admin')} />}
        <Row icon="signOut" iconTint="var(--red)" title={t('Sign out')} danger onClick={() => confirmSheet({ title: t('Sign out?'), message: t('Your data is synced to your profile first, then cleared from this device.'), confirmText: t('Sign out'), danger: true, onConfirm: () => { signOut(); nav('/home') } })} />
      </> : webauthnOK() ? <>
        <Row leftNode={<Avatar id="guest" name="?" src={S.avatar} size={44} style={{ marginRight: 4 }} />} title={t('Guest')} subtitle={t('Keeps your data safe and separate per person.')} />
        <Row icon="sparkles" iconTint="var(--acc)" title={t('Create passkey profile')} accessory="chevron" onClick={registerHere} />
        <Row icon="person" iconTint="var(--blue)" title={t('Sign in with passkey')} accessory="chevron" onClick={signInHere} />
      </> : (
        <Row icon="lock" iconTint="var(--grey)" title={t('Passkeys not supported in this browser.')} />
      )}
    </Section>
    {!user && !DEMO && !MOBILE && <p className="sect-f" style={{ marginTop: -18, marginBottom: 22 }}>{t('Guest mode — data lives only in this browser.')}</p>}
    <input ref={avatarRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={doAvatar} />

    {/* ---------- auth methods (logged-in only) ---------- */}
    {user && !DEMO && !MOBILE && <AuthMethodsSection user={user} toast={toast} />}

    {/* ---------- profile: goals & body metrics ---------- */}
    <Section title={t('Profile')} footer={t('Your goal weight shows on the Home body-weight chart.')}>
      <Row icon="target" iconTint="var(--yellow)" title={t('Goal weight')}>
        <div className="row" style={{ gap: 8 }}>
          <input type="number" inputMode="decimal" className="timef" style={{ width: 96, textAlign: 'right' }}
            placeholder="—" value={S.targetW ?? ''} onChange={e => update(s => { s.targetW = e.target.value === '' ? null : +e.target.value })} />
          <span className="small muted">{S.unit}</span>
        </div>
      </Row>
      <Row icon="ruler" iconTint="var(--teal)" title={t('Height')}>
        <div className="row" style={{ gap: 8 }}>
          <input type="number" inputMode="decimal" className="timef" style={{ width: 96, textAlign: 'right' }}
            placeholder="—" value={S.height ?? ''} onChange={e => update(s => { s.height = e.target.value === '' ? null : +e.target.value })} />
          <Segmented className="seg-inline" style={{ flex: 'none' }}
            options={[{ value: 'cm', label: 'cm' }, { value: 'in', label: 'in' }]}
            value={S.heightUnit || 'in'} onChange={v => update(s => { s.heightUnit = v })} />
        </div>
      </Row>
    </Section>

    {/* ---------- appearance ---------- */}
    <Section title={t('Appearance')} footer={DEMO || MOBILE ? undefined : t('synced with your profile')}>
      <SelectRow
        icon="globe" iconTint="var(--blue)" title={t('Language')}
        value={S.lang || 'en'} onChange={v => update(s => { s.lang = v })}
        options={Object.entries(LANGS).map(([k, name]) => ({
          value: k, label: name,
          subtitle: INSTR_LANGS.includes(k) ? null : t("Exercise instructions aren't available in this language yet — they stay in English."),
        }))}
      />
      <Row icon="moon" iconTint="var(--indigo)" title={t('Theme')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'dark', icon: 'moon', label: t('Dark') }, { value: 'light', icon: 'sun', label: t('Light') }]}
          value={S.theme === 'light' ? 'light' : 'dark'}
          onChange={v => update(s => { s.theme = v })}
        />
      </Row>
      {/* Diagram display only (no app logic) */}
      <Row icon="figureStrength" iconTint="var(--teal)" title={t('Body diagram')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
          value={S.body === 'female' ? 'female' : 'male'}
          onChange={v => update(s => { s.body = v })}
        />
      </Row>
      <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, paddingTop: 13, paddingBottom: 14 }}>
        <span className="lrow-t">{t('Accent color')}</span>
        <div className="swatches">
          {Object.entries(ACCENTS).map(([k, c]) => (
            <button key={k} className={'swatch' + ((S.accent || 'lime') === k ? ' on' : '')}
              style={{ background: c }} onClick={() => update(s => { s.accent = k })} aria-label={k} />
          ))}
        </div>
      </div>
    </Section>

    {/* ---------- units & timer ---------- */}
    <Section title={t('Units & timer')} footer={t('Note: switching units only changes the label — logged numbers are not converted.')}>
      <Row icon="scale" iconTint="var(--teal)" title={t('Weight unit')}>
        <Segmented className="seg-inline"
          options={[{ value: 'lb', label: 'lb' }, { value: 'kg', label: 'kg' }]}
          value={S.unit} onChange={v => update(s => { s.unit = v })} />
      </Row>
      <SelectRow icon="timer" iconTint="var(--orange)" title={t('Rest timer')}
        value={S.restSec} onChange={v => update(s => { s.restSec = v })}
        options={[60, 90, 120, 150, 180].map(v => ({ value: v, label: v + 's' }))} />
      <Row icon="bell" iconTint="var(--pink)" title={t('Sounds')}>
        <Switch checked={!!S.sound} onChange={v => update(s => { s.sound = v })} />
      </Row>
    </Section>

    {(user || MOBILE) && <NotificationsCard S={S} update={update} toast={toast} />}

    {/* ---------- data ---------- */}
    <Section title={t('Data')}>
      <Row icon="download" iconTint="var(--blue)" title={t('Export backup (JSON)')} accessory="chevron" onClick={doExport} />
      <Row icon="upload" iconTint="var(--blue)" title={t('Import backup')} accessory="chevron" onClick={() => fileRef.current.click()} />
      <Row icon="shuffle" iconTint="var(--teal)" title={t('Import from another app')}
        subtitle={t('FitNotes, Strong, Hevy — or body weight from Apple Health')}
        accessory="chevron" onClick={() => importRef.current.click()} />
      <Row icon="sparkles" iconTint="var(--acc)" title={t('Load ⅃ƎVEL starter plan')} subtitle={t('Loads the default ⅃ƎVEL - Class: Fighter program as a starting point')} accessory="chevron" onClick={loadStarterPlan} />
      <Row icon="trash" iconTint="var(--red)" title={t('Reset everything')} danger onClick={() => confirmSheet({ title: t('Reset everything?'), message: t('Deletes your plan, workouts and body weight on this device. This cannot be undone.'), confirmText: t('Delete everything'), danger: true, onConfirm: () => { replaceState(JSON.parse(JSON.stringify(DEF)), true); nav('/home'); toast(t('All data reset')) } })} />
    </Section>
    <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={doImport} />
    {/* Reset input for file re-selection */}
    <input ref={importRef} type="file" accept=".csv,.xml,text/csv,text/xml" style={{ display: 'none' }}
      onChange={ev => { const f = ev.target.files[0]; if (f) importFromApp(f); ev.target.value = '' }} />

    <div className="dim small" style={{ textAlign: 'center', marginTop: 4, lineHeight: 1.6 }}>
      <a href="https://github.com/ForgeFitServer/ForgeFitServer" target="_blank" rel="noopener">Source Code</a> · Forge Fitness Server · {t('AGPL v3')}<br />
      <a href="https://github.com/hasaneyldrm/exercises-dataset" target="_blank" rel="noopener">Source Code</a> · Exercise Data · (CC)
    </div>
  </div>
}

function NotificationsCard({ S, update, toast }) {
  if (MOBILE) return <MobileReminderCard S={S} update={update} toast={toast} />
  return <PushCard S={S} update={update} toast={toast} />
}

// Owns OS permission prompt when toggled
function MobileReminderCard({ S, update, toast }) {
  const setReminder = patch => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), ...patch, tz: localTZ() } })
  const toggle = async () => {
    const on = !S.reminder?.on
    if (on) {
      const ok = await syncReminder({ ...S, reminder: { ...(S.reminder || DEF.reminder), on: true } }, true)
      if (!ok) { toast(t('Could not change notification settings')); return }
    }
    setReminder({ on })
  }
  return (
    <Section title={t('Notifications')}
      footer={S.reminder?.on ? t('Reminds you at this time on days that have a routine planned.') : null}>
      <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
        <Switch checked={!!S.reminder?.on} onChange={toggle} />
      </Row>
      {S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time}
            onChange={e => setReminder({ time: e.target.value })} />
        </Row>
      )}
    </Section>
  )
}

function PushCard({ S, update, toast }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const supported = pushSupported()

  useEffect(() => {
    if (!supported) return
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => setOn(!!sub)).catch(() => {})
  }, [supported])

  const toggle = async v => {
    setBusy(true)
    try {
      if (!v) { await disablePush(); setOn(false); toast(t('Notifications off')) }
      else { await enablePush(); setOn(true); toast(t('Notifications on')) }
    } catch (e) { toast(e.message || t('Could not change notification settings')) }
    setBusy(false)
  }
  const test = async () => {
    try { await sendTestPush(); toast(t('Test sent — should arrive any second')) }
    catch (e) { toast(e.message || t('Test failed')) }
  }

  if (!supported) return (
    <Section title={t('Notifications')}>
      <Row icon="bellSlash" iconTint="var(--grey)" title={t('Not supported in this browser.')} />
    </Section>
  )

  return <>
    <Section
      title={t('Notifications')}
      footer={on && S.reminder?.on
        ? t("Only sent on days you have a routine planned and haven't logged a workout yet.") +
          (S.reminder?.tz ? ' ' + t('Timezone: {0} (auto-detected, updates if you travel).', S.reminder.tz) : '')
        : null}
    >
      <Row icon="bell" iconTint="var(--red)" title={t('Push notifications')} subtitle={t('Rest-timer alerts, even if Forge Fitness Server is closed.')}>
        <Switch checked={on} disabled={busy} onChange={toggle} />
      </Row>
      {on && (
        <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
          <Switch checked={!!S.reminder?.on} onChange={() => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), on: !s.reminder?.on, tz: localTZ() } })} />
        </Row>
      )}
      {on && S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time}
            onChange={e => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), time: e.target.value, tz: localTZ() } })} />
        </Row>
      )}
    </Section>
    {on && <div style={{ marginTop: -12, marginBottom: 22 }}><Button size="sm" icon="bell" onClick={test}>{t('Send test notification')}</Button></div>}
  </>
}

function AuthMethodsSection({ user, toast }) {
  const [methods, setMethods] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showPasswordSheet, setShowPasswordSheet] = useState(false)

  useEffect(() => {
    getAuthMethods().then(m => { setMethods(m); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const addPasskey = async () => {
    try {
      const { cid, options } = await addPasskeyOptions()
      const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) })
      if (!cred) { toast(t('Passkey registration cancelled')); return }
      await addPasskeyVerify(cid, credToJSON(cred))
      toast(t('Passkey added successfully'))
      setMethods(prev => ({ ...prev, passkeys: [...(prev?.passkeys || []), { id: cred.id.slice(0, 8), transports: cred.response?.getTransports?.() || [] }] }))
    } catch (e) {
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Failed to add passkey'))
    }
  }

  const removePasskey = async (credId, isActive) => {
    if (isActive) { toast(t('This passkey is your active session — sign in with a different passkey first')); return }
    confirmSheet({
      title: t('Remove passkey?'),
      message: t('This will permanently remove this passkey from your account. You will not be able to use it to sign in.'),
      confirmText: t('Remove'),
      danger: true,
      onConfirm: async () => {
        try {
          await removePasskeyAPI(credId)
          toast(t('Passkey removed'))
          setMethods(prev => ({ ...prev, passkeys: (prev?.passkeys || []).filter(p => p.id !== credId) }))
        } catch (e) { toast(e.message || t('Failed to remove passkey')) }
      }
    })
  }

  const setPwd = async (password) => {
    try {
      await setPassword(password)
      toast(t('Password set successfully'))
      setMethods(prev => ({ ...prev, password: true }))
      setShowPasswordSheet(false)
    } catch (e) { toast(e.message || t('Failed to set password')) }
  }

  const removePwd = async () => {
    confirmSheet({
      title: t('Remove password?'),
      message: t('You will only be able to sign in using your passkeys.'),
      confirmText: t('Remove'),
      danger: true,
      onConfirm: async () => {
        try {
          await removePassword()
          toast(t('Password removed'))
          setMethods(prev => ({ ...prev, password: false }))
        } catch (e) { toast(e.message || t('Failed to remove password')) }
      }
    })
  }

  if (loading) return <Section title={t('Login methods')}><Row title={t('Loading...')} /></Section>

  return (
    <>
      <Section title={t('Login methods')} footer={t('Secure your account with multiple ways to sign in.')}>
        {methods?.passkeys?.map(pk => {
          const canDelete = (methods.passkeys.length > 1 || methods.password) && !pk.active
          return (
            <Row key={pk.id} icon="key" iconTint={pk.active ? "var(--acc)" : "var(--grey)"} title={t('Passkey')}
              subtitle={pk.active ? (pk.transports?.join(', ') || 'internal') + ' · ' + t('Active session') : (pk.transports?.join(', ') || 'internal')}
              accessory={canDelete ? 'trash' : null}
              onClick={canDelete ? () => removePasskey(pk.id, pk.active) : undefined} />
          )
        })}
        {webauthnOK() && <Row icon="plus" iconTint="var(--green)" title={t('Add another passkey')} accessory="chevron" onClick={addPasskey} />}

        {methods?.password ? (
          <Row icon="lock" iconTint="var(--blue)" title={t('Password')} subtitle={t('Set and secured')}
            accessory={methods.passkeys.length >= 1 ? 'trash' : null}
            onClick={methods.passkeys.length >= 1 ? removePwd : undefined} />
        ) : (
          <Row icon="plus" iconTint="var(--green)" title={t('Add a password')} subtitle={t('Another way to sign in')} accessory="chevron"
            onClick={() => useUI.getState().openSheet(close => <PasswordSheet close={close} onSet={setPwd} toast={toast} />)} />
        )}
      </Section>
    </>
  )
}

function PasswordSheet({ close, onSet, toast }) {
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const ref = useRef(null)
  
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])

  const go = async () => {
    if (pwd.length < 8) { toast(t('Password must be at least 8 characters')); return }
    if (pwd !== pwd2) { toast(t('Passwords do not match')); return }
    try {
      await onSet(pwd)
      close()
    } catch (e) { toast(e.message || t('Failed to set password')) }
  }

  return <>
    <h3>{t('Add a password')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Create a strong password — at least 8 characters.')}</div>
    <TextField ref={ref} type="password" placeholder={t('Password (min. 8 characters)')} value={pwd} onChange={e => setPwd(e.target.value)} />
    <TextField type="password" placeholder={t('Confirm password')} value={pwd2} onChange={e => setPwd2(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Set password')}</Button>
  </>
}

// Helper functions for converting between credential and Base64URL formats
function toCreationOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  o.user.id = b64uToBuf(o.user.id)
  ;(o.excludeCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}

const bufToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uToBuf = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer

function credToJSON(cred) {
  const r = cred.response
  const out = {
    id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    authenticatorAttachment: cred.authenticatorAttachment || null,
    response: { clientDataJSON: bufToB64u(r.clientDataJSON) }
  }
  if (r.attestationObject) {
    out.response.attestationObject = bufToB64u(r.attestationObject)
    out.response.transports = r.getTransports ? r.getTransports() : ['internal']
  }
  if (r.authenticatorData) {
    out.response.authenticatorData = bufToB64u(r.authenticatorData)
    out.response.signature = bufToB64u(r.signature)
    out.response.userHandle = r.userHandle ? bufToB64u(r.userHandle) : null
  }
  return out
}

function RegisterInline({ close, setUser, pushState, pullState, toast }) {
  const nameRef = useRef(null)
  const coachRef = useRef(null)
  const go = async () => {
    const n = (nameRef.current.value || '').trim()
    if (!n) { toast(t('Enter a name')); return }
    const coachKey = (coachRef.current?.value || '').trim()
    try {
      const u = await passkeyRegister(n, '', coachKey); setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); toast(t('Profile created — data moved into it')) }
      else { await pullState(); toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with your device.')}</div>
    <TextField ref={nameRef} placeholder={t('Your name')} maxLength={40} />
    <div style={{ height: 10 }} />
    <TextField ref={coachRef} placeholder={t('Coach key (optional)')} maxLength={40} />
    <div className="dim small" style={{ marginTop: 6 }}>{t('Have a coach invite key? Enter it to sign up as a coach.')}</div>
    <div style={{ height: 12 }} /><Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}
