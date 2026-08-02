// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { coachTrainees, coachTrainee, coachSaveTrainee, coachInvite, coachInvites, coachSetRole, coachQuestionnaires, createQuestionnaire, updateQuestionnaire, deleteQuestionnaire, assignQuestionnaire, coachTemplates, coachSaveTemplate, coachUpdateTemplate, coachDeleteTemplate, coachTraineeResponses, coachSetDefaultQuestionnaire } from '../lib/api.js'
import { EXIDX, isCardio } from '../lib/exercises.js'
import { fmtNum, fmtDate, fmtVol, uid, DAYN } from '../lib/format.js'
import { setsDone, bestWeightFor } from '../lib/history.js'
import { Thumb } from '../components/Media.jsx'
import Avatar from '../components/Avatar.jsx'
import Icon from '../components/Icon.jsx'
import { exercisePicker, confirmSheet, questionnaireEditorSheet } from '../sheets.jsx'
import { glyphOf } from '../lib/glyphs.js'


const clone = o => JSON.parse(JSON.stringify(o))
const copy = (txt, toast) => { try { navigator.clipboard?.writeText(txt) } catch { /* */ } toast('Copied ' + txt) }

/* == dashboard == */
export function Coach() {
  const nav = useNavigate()
  const isCoach = useStore(s => s.isCoach())
  const me = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [trainees, setTrainees] = useState(null)
  const [invites, setInvites] = useState([])
  const [questionnaires, setQuestionnaires] = useState([])
  const [templates, setTemplates] = useState([])
  const [tab, setTab] = useState('trainees')
  const [busy, setBusy] = useState(false)
  const [qBusy, setQBusy] = useState(false)
  const [applyingTemplate, setApplyingTemplate] = useState(null)
  const [applyBusy, setApplyBusy] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [editDraft, setEditDraft] = useState({})
  const [assigningQuestionnaire, setAssigningQuestionnaire] = useState(null)
  const [assignBusy, setAssignBusy] = useState(false)
  const tmplImportRef = useRef(null)

  useEffect(() => { if (!isCoach) { nav('/home'); return } reload() }, [isCoach])
  const reload = async () => {
    try {
      setTrainees(await coachTrainees())
      setInvites(await coachInvites())
      setQuestionnaires(await coachQuestionnaires())
      setTemplates(await coachTemplates())
    }
    catch (e) { toast(e.message || 'Failed to load') }
  }
  const genKey = async () => {
    setBusy(true)
    try { const code = await coachInvite(); setInvites(await coachInvites()); copy(code, toast) }
    catch (e) { toast(e.message || 'Could not generate key') }
    setBusy(false)
  }
  const toggleRole = t => confirmSheet({
    title: t.coach ? `Remove ${t.name} coach role?` : `Make ${t.name} a coach?`,
    message: t.coach ? 'They will go back to being a regular trainee.' : 'They will be able to view and manage every trainee.',
    confirmText: t.coach ? 'Remove role' : 'Make coach', danger: t.coach,
    onConfirm: async () => { try { await coachSetRole(t.id, !t.coach); await reload(); toast('Updated ' + t.name) } catch (e) { toast(e.message || 'Failed') } }
  })
  const createQ = () => questionnaireEditorSheet(null, reload)
  const editQ = q => questionnaireEditorSheet(q, reload)
  const deleteQ = q => confirmSheet({
    title: `Delete "${q.title}"?`,
    message: 'This will remove the questionnaire but not any already-submitted responses.',
    confirmText: 'Delete', danger: true,
    onConfirm: async () => {
      try { await deleteQuestionnaire(q.id); await reload(); toast('Deleted') }
      catch (e) { toast(e.message || 'Failed') }
    }
  })

  const deleteTmpl = tmpl => confirmSheet({
    title: `Delete template "${tmpl.name}"?`, message: 'Removes it from the shared library. Trainees who already received it are unaffected.',
    confirmText: 'Delete', danger: true,
    onConfirm: async () => {
      try { await coachDeleteTemplate(tmpl.id); setTemplates(await coachTemplates()); toast('Deleted') }
      catch (e) { toast(e.message || 'Failed') }
    }
  })
  const exportTmpl = tmpl => {
    const blob = new Blob([JSON.stringify({ _type: 'ffs_plan_template', name: tmpl.name, ...tmpl.data }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = tmpl.name.replace(/[^a-z0-9]/gi, '_') + '.json'; a.click(); URL.revokeObjectURL(a.href)
  }
  const handleTmplImport = ev => {
    const f = ev.target.files[0]; ev.target.value = ''
    if (!f) return
    const rd = new FileReader()
    rd.onload = async () => {
      try {
        const data = JSON.parse(rd.result)
        if (!data.name || !Array.isArray(data.days)) throw new Error('not a valid plan template file')
        await coachSaveTemplate({ name: data.name, data: { desc: data.desc || '', emoji: data.emoji || 'forge', photo: data.photo || null, days: data.days } })
        setTemplates(await coachTemplates()); toast('Template imported: ' + data.name)
      } catch (e) { toast('Import failed: ' + e.message) }
    }
    rd.readAsText(f)
  }
  const applyTemplateToTrainee = async (tmpl, trainee) => {
    setApplyBusy(true)
    try {
      const { state } = await coachTrainee(trainee.id)
      const draft = Object.assign(clone(DEF), state || {})
      const newDays = (tmpl.data?.days || []).map(d => ({
        id: uid(), name: d.name || 'Day', emoji: d.emoji || 'plate',
        desc: d.desc || '', coachNote: d.coachNote || '', video: d.video || '',
        ex: (d.ex || []).map(e => ({ ...e })), photo: d.photo || null, coach: me?.name || 'Coach'
      }))
      const newProg = { id: uid(), name: tmpl.name, desc: tmpl.data?.desc || '', emoji: tmpl.data?.emoji || 'forge', coach: me?.name || 'Coach', photo: tmpl.data?.photo || null, dayIds: newDays.map(d => d.id) }
      draft.routines = [...(draft.routines || []), ...newDays]
      draft.programs = [...(draft.programs || []), newProg]
      await coachSaveTrainee(trainee.id, draft)
      toast(`Applied "${tmpl.name}" to ${trainee.name}`)
      setApplyingTemplate(null)
    } catch (e) { toast(e.message || 'Failed to apply') }
    setApplyBusy(false)
  }

  // == Template inline editing ==
  const editTmpl = tmpl => {
    setEditDraft({ name: tmpl.name, desc: tmpl.data?.desc || '', days: (tmpl.data?.days || []).map(d => ({ ...d })) })
    setEditingTemplate(tmpl.id)
  }
  const saveTmplEdit = async tmplId => {
    const tmpl = templates.find(t => t.id === tmplId)
    if (!tmpl) return
    try {
      await coachUpdateTemplate(tmplId, editDraft.name || tmpl.name, { ...tmpl.data, desc: editDraft.desc, days: editDraft.days })
      setTemplates(await coachTemplates())
      setEditingTemplate(null)
      toast('Template updated')
    } catch (e) { toast(e.message || 'Save failed') }
  }

  // == Questionnaire assign + set-default ==
  const doAssignQuestionnaire = async traineeId => {
    if (!assigningQuestionnaire) return
    setAssignBusy(true)
    try {
      await assignQuestionnaire(assigningQuestionnaire.id, traineeId, true)
      toast(`Assigned "${assigningQuestionnaire.title}"`)
      setAssigningQuestionnaire(null)
    } catch (e) { toast(e.message || 'Failed to assign') }
    setAssignBusy(false)
  }
  const toggleDefaultQ = async q => {
    try {
      await coachSetDefaultQuestionnaire(q.id)
      setQuestionnaires(await coachQuestionnaires())
      toast(q.isDefault ? 'Default cleared' : `"${q.title}" set as registration questionnaire`)
    } catch (e) { toast(e.message || 'Failed') }
  }

  if (!isCoach) return null

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')}>x</button>
      <div style={{ flex: 1, marginLeft: 12 }}><h1>Coaching</h1><div className="sub">Trainees, programs & templates</div></div>
    </div>

    <div className="tabs" style={{ marginBottom: 12, borderBottom: '1px solid var(--bg2)', gap: 8 }}>
      <button className={tab === 'trainees' ? 'active' : ''} onClick={() => setTab('trainees')}>Trainees</button>
      <button className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>Templates</button>
      <button className={tab === 'questionnaires' ? 'active' : ''} onClick={() => setTab('questionnaires')}>Questionnaires</button>
      <button className={tab === 'invites' ? 'active' : ''} onClick={() => setTab('invites')}>Invite Keys</button>
    </div>

    {tab === 'invites' && <div className="card">
      <h2>Coach invite keys</h2>
      <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.5 }}>Generate a single-use, 10-character key and share it with a new coach -- they enter it on the Create profile screen to sign up as a coach.</div>
      <button className="btn primary" onClick={genKey} disabled={busy}>+ Generate invite key</button>
      {invites.length > 0 && <div className="list" style={{ marginTop: 12, gap: 0 }}>
        {invites.map(i => <div key={i.code} className="row between" style={{ padding: '10px 2px', borderBottom: '1px solid var(--bg2)' }}>
          <span style={{ fontFamily: 'ui-monospace,monospace', letterSpacing: '.14em', fontWeight: 700, opacity: i.used ? .45 : 1, textDecoration: i.used ? 'line-through' : 'none' }}>{i.code}</span>
          {i.used ? <span className="small muted">used by {i.usedBy}</span> : <button className="tag acc" onClick={() => copy(i.code, toast)}>Copy</button>}
        </div>)}
      </div>}
    </div>}

    {tab === 'questionnaires' && <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 8 }}>
        <h2 style={{ flex: 1, margin: 0 }}>Questionnaires</h2>
        <button className="btn sm primary" onClick={createQ} disabled={qBusy}>+ New</button>
      </div>
      <div className="small muted" style={{ marginBottom: 12, lineHeight: 1.5 }}>Mark one questionnaire as <strong>Registration</strong> to automatically send it to new sign-ups. Use Assign to send any questionnaire to a specific trainee.</div>
      {questionnaires.length === 0 ? <div className="empty">No questionnaires yet</div> : <div className="cch-q-list">
        {questionnaires.map(q => <div key={q.id} className="cch-q-card">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="tt" style={{ marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {q.isDefault && <span className="tag" style={{ background: 'var(--acc)', color: 'var(--bg)', fontSize: 10, padding: '2px 7px' }}>Registration</span>}
              {q.title}
            </div>
            {q.description && <div className="ss">{q.description}</div>}
            <div className="small muted" style={{ marginTop: 4 }}>{q.fields?.length || 0} fields</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
            <button className="tag acc" onClick={() => editQ(q)}>Edit</button>
            <button className="tag" onClick={() => setAssigningQuestionnaire(q)}>Assign</button>
            <button className={q.isDefault ? 'tag acc' : 'tag'} onClick={() => toggleDefaultQ(q)} title={q.isDefault ? 'Remove as registration form' : 'Set as registration form'}>{q.isDefault ? '★ Default' : 'Set default'}</button>
            {!q.isDefault && <button className="tag" style={{ color: 'var(--red)' }} onClick={() => deleteQ(q)}>Delete</button>}
          </div>
        </div>)}
      </div>}

      {assigningQuestionnaire && <div className="cch-apply-overlay">
        <div className="cch-apply-sheet">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Assign "{assigningQuestionnaire.title}" to:</div>
          <div className="small muted" style={{ marginBottom: 12 }}>Sends this questionnaire to the trainee to complete in their app.</div>
          {trainees == null ? <div className="empty">Loading…</div> : <div className="cch-apply-trainee-list">
            {trainees.map(t => <button key={t.id} className="cch-apply-trainee-btn" disabled={assignBusy} onClick={() => doAssignQuestionnaire(t.id)}>
              <Avatar id={t.id} name={t.name} src={t.avatar} size={32} style={{ flexShrink: 0 }} />
              <span>{t.name}</span>
            </button>)}
          </div>}
          <button className="btn sm ghost" style={{ marginTop: 12 }} onClick={() => setAssigningQuestionnaire(null)}>Cancel</button>
        </div>
      </div>}
    </div>}

    {tab === 'templates' && <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 8 }}>
        <h2 style={{ flex: 1, margin: 0 }}>Plan Templates</h2>
        <input ref={tmplImportRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleTmplImport} />
        <button className="btn sm" onClick={() => tmplImportRef.current?.click()}>Import</button>
      </div>
      <div className="small muted" style={{ marginBottom: 14, lineHeight: 1.55 }}>Shared library visible to all coaches. Open a trainee's program and tap <strong>Save as template</strong> to add one here.</div>
      {templates.length === 0
        ? <div className="cch-empty-state"><Icon name="clipboard" /><div>No templates yet</div><div className="cch-empty-sub">Open a trainee → open a program → Save as template</div></div>
        : <div className="cch-template-list">
          {templates.map(tmpl => {
            const dayCount = tmpl.data?.days?.length || 0
            return <div key={tmpl.id} className="cch-template-card">
              {editingTemplate === tmpl.id
                ? <div style={{ flex: 1 }}>
                    <input className="cch-input" value={editDraft.name} onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))} placeholder="Template name" style={{ marginBottom: 8 }} />
                    <textarea className="cch-textarea" rows={2} value={editDraft.desc} onChange={e => setEditDraft(d => ({ ...d, desc: e.target.value }))} placeholder="Description…" style={{ marginBottom: 8 }} />
                    {editDraft.days?.map((day, i) => <input key={i} className="cch-input" value={day.name} onChange={e => setEditDraft(d => { const days = [...d.days]; days[i] = { ...days[i], name: e.target.value }; return { ...d, days } })} placeholder={`Day ${i + 1} name`} style={{ marginBottom: 6 }} />)}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button className="btn sm primary" onClick={() => saveTmplEdit(tmpl.id)}>Save</button>
                      <button className="btn sm" onClick={() => setEditingTemplate(null)}>Cancel</button>
                    </div>
                  </div>
                : <>
                    <div className="cch-template-info">
                      <div className="cch-template-name">{tmpl.name}</div>
                      {tmpl.data?.desc && <div className="cch-template-desc">{tmpl.data.desc}</div>}
                      <div className="cch-template-meta">{dayCount} day{dayCount !== 1 ? 's' : ''}{dayCount > 0 ? ' · ' + tmpl.data.days.map(d => d.name).join(', ') : ''}</div>
                    </div>
                    <div className="cch-template-actions">
                      <button className="tag acc" onClick={() => setApplyingTemplate(tmpl)}>Apply</button>
                      {tmpl.coachId === me?.id && <button className="tag" onClick={() => editTmpl(tmpl)}>Edit</button>}
                      <button className="tag" onClick={() => exportTmpl(tmpl)}>Export</button>
                      {tmpl.coachId === me?.id && <button className="tag" style={{ color: 'var(--red)' }} onClick={() => deleteTmpl(tmpl)}>Delete</button>}
                    </div>
                  </>}
            </div>
          })}
        </div>}

      {applyingTemplate && <div className="cch-apply-overlay">
        <div className="cch-apply-sheet">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Apply "{applyingTemplate.name}" to:</div>
          <div className="small muted" style={{ marginBottom: 12 }}>Adds the program to the trainee's plan — does not remove anything.</div>
          {trainees == null ? <div className="empty">Loading…</div> : <div className="cch-apply-trainee-list">
            {trainees.map(t => <button key={t.id} className="cch-apply-trainee-btn" disabled={applyBusy} onClick={() => applyTemplateToTrainee(applyingTemplate, t)}>
              <Avatar id={t.id} name={t.name} src={t.avatar} size={32} style={{ flexShrink: 0 }} />
              <span>{t.name}</span>
            </button>)}
          </div>}
          <button className="btn sm ghost" style={{ marginTop: 12 }} onClick={() => setApplyingTemplate(null)}>Cancel</button>
        </div>
      </div>}
    </div>}

    {tab === 'trainees' && <div>
      <h4 className="sec">Trainees</h4>
      {trainees == null ? <div className="empty">Loading...</div> : trainees.length === 0 ? <div className="empty">No accounts yet.</div> :
        <div className="list">{trainees.map(u => <div key={u.id} className="item" onClick={() => nav('/coach/t/' + u.id)} style={u.disabled ? { opacity: .55 } : null}>
          <Avatar id={u.id} name={u.name} src={u.avatar} size={40} style={{ flex: 'none' }} />
          <div className="grow">
            <div className="tt">{u.name} {u.self && <span className="small dim">(you)</span>}{u.admin && <span className="tag" style={{ marginLeft: 4 }}>admin</span>}{u.coach && !u.admin && <span className="tag acc" style={{ marginLeft: 4 }}>coach</span>}{u.disabled && <span className="tag" style={{ marginLeft: 4, color: 'var(--red)' }}>off</span>}</div>
            <div className="ss">{u.workouts} workout{u.workouts === 1 ? '' : 's'}{u.lastWorkout ? ' - last ' + fmtDate(u.lastWorkout) : ''}{u.weight ? ' - W ' + fmtNum(u.weight) : ''}</div>
          </div>
          {!u.self && <button className="tag" onClick={e => { e.stopPropagation(); toggleRole(u) }}>{u.coach ? 'Coach' : 'Make coach'}</button>}
          <span className="chev">&gt;</span>
        </div>)}</div>}
    </div>}
    <div style={{ height: 40 }} />
  </div>
}

/* == trainee editor == */
const DAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const ACCENT_COLORS = ['var(--acc)', 'var(--blue)', 'var(--purple)', 'var(--orange)', 'var(--red)', 'var(--teal)']

const defaultScheme = (sets = 3, reps = 10, weight = 0) =>
  Array.from({ length: sets }, () => ({ r: reps, w: weight }))

function resizeToCover(file, maxW = 600, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader()
    rd.onerror = reject
    rd.onload = () => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width)
        const W = Math.round(img.width * scale)
        const H = Math.round(img.height * scale)
        const c = document.createElement('canvas'); c.width = W; c.height = H
        c.getContext('2d').drawImage(img, 0, 0, W, H)
        resolve(c.toDataURL('image/jpeg', quality))
      }
      img.src = rd.result
    }
    rd.readAsDataURL(file)
  })
}

export function CoachTrainee() {
  const nav = useNavigate()
  const { id } = useParams()
  const isCoach = useStore(s => s.isCoach())
  const me = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [tuser, setTuser] = useState(null)
  const [draft, setDraft] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [openProg, setOpenProg] = useState(null)   // expanded program id
  const [openDay, setOpenDay] = useState(null)     // expanded day (routine) id
  const [responses, setResponses] = useState([])
  const coverRefs = useRef({})       // day cover photo inputs
  const progCoverRefs = useRef({})   // program cover photo inputs

  useEffect(() => {
    if (!isCoach) { nav('/home'); return }
    let live = true
    ;(async () => {
      try {
        const { user, state } = await coachTrainee(id)
        if (!live) return
        setTuser(user)
        setDraft(Object.assign(clone(DEF), state || {}))
        try { const r = await coachTraineeResponses(id); if (live) setResponses(r || []) } catch { /* optional */ }
      }
      catch (e) { toast(e.message || 'Failed to load'); nav('/coach') }
    })()
    return () => { live = false }
  }, [id, isCoach])

  const mut = fn => { setDraft(d => { const n = clone(d); fn(n); return n }); setDirty(true) }
  // Mutate a routine (day) by its id
  const setR = (rid, fn) => mut(s => { const r = (s.routines || []).find(x => x.id === rid); if (r) fn(r) })
  // Mutate a program by its id
  const setP = (pid, fn) => mut(s => { const p = (s.programs || []).find(x => x.id === pid); if (p) fn(p) })
  const editEx = (rid, fn) => setR(rid, r => fn(r.ex))
  const moveEx = (rid, i, dir) => editEx(rid, ex => {
    const j = i + dir; if (j < 0 || j >= ex.length) return;[ex[i], ex[j]] = [ex[j], ex[i]]
  })

  const save = async () => {
    setSaving(true)
    try { await coachSaveTrainee(id, draft); setDirty(false); toast('Saved to ' + (tuser?.name || 'trainee')) }
    catch (e) { toast(e.message || 'Save failed') }
    setSaving(false)
  }
  const leave = () => {
    if (dirty) confirmSheet({ title: 'Leave without saving?', message: 'Changes to this trainee plan are not saved.', confirmText: 'Discard', danger: true, onConfirm: () => nav('/coach') })
    else nav('/coach')
  }

  if (!isCoach || !draft) return <div className="narrow"><div className="empty">Loading…</div></div>

  const routines = draft.routines || []
  const programs = draft.programs || []
  const unit = draft.unit || 'lb'
  const recentWks = [...(draft.workouts || [])].reverse().slice(0, 5)
  const lastBw = draft.bodyweight?.length ? draft.bodyweight[draft.bodyweight.length - 1] : null
  const streakCount = (() => {
    let s = 0; const now = new Date()
    for (let i = 0; i < 7; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i)
      const iso = d.toISOString().slice(0, 10)
      if ((draft.workouts || []).some(w => w.d === iso)) s++; else break
    }
    return s
  })()

  // Days that belong to a program
  const allDayIds = programs.flatMap(p => p.dayIds || [])
  // Routines not yet inside any program (backward compat / ungrouped)
  const ungrouped = routines.filter(r => !allDayIds.includes(r.id))
  // Get the ordered day routines for a program
  const progDays = prog => (prog.dayIds || []).map(dayId => routines.find(r => r.id === dayId)).filter(Boolean)
  // Find which program a routine belongs to
  const dayProgram = rid => programs.find(p => (p.dayIds || []).includes(rid))

  // == Program mutations ==
  const addProgram = () => {
    const p = { id: uid(), name: 'New Program', desc: '', photo: null, emoji: 'forge', coach: me?.name || 'Coach', dayIds: [] }
    mut(s => { s.programs = [...(s.programs || []), p] })
    setOpenProg(p.id)
  }
  const delProgram = pid => confirmSheet({
    title: 'Delete program?', message: 'All days and exercises in this program will be removed. Workout history is kept.',
    confirmText: 'Delete', danger: true,
    onConfirm: () => mut(s => {
      const prog = (s.programs || []).find(p => p.id === pid)
      if (prog) {
        s.routines = (s.routines || []).filter(r => !(prog.dayIds || []).includes(r.id))
        ;(prog.dayIds || []).forEach(rid => Object.keys(s.week || {}).forEach(k => { if (s.week[k] === rid) delete s.week[k] }))
      }
      s.programs = (s.programs || []).filter(p => p.id !== pid)
    })
  })

  // == Day mutations ==
  const addDay = pid => {
    const r = { id: uid(), name: 'New day', emoji: 'plate', ex: [], desc: '', coachNote: '', video: '', coach: me?.name || 'Coach', photo: null }
    mut(s => {
      s.routines = [...(s.routines || []), r]
      const prog = (s.programs || []).find(p => p.id === pid)
      if (prog) prog.dayIds = [...(prog.dayIds || []), r.id]
    })
    setOpenDay(r.id)
  }
  const delDay = (pid, rid) => confirmSheet({
    title: 'Remove day?', message: 'Removes this day from the program. History is kept.',
    confirmText: 'Remove', danger: true,
    onConfirm: () => mut(s => {
      s.routines = (s.routines || []).filter(r => r.id !== rid)
      const prog = (s.programs || []).find(p => p.id === pid)
      if (prog) prog.dayIds = (prog.dayIds || []).filter(did => did !== rid)
      Object.keys(s.week || {}).forEach(k => { if (s.week[k] === rid) delete s.week[k] })
    })
  })
  const delUngrouped = rid => confirmSheet({
    title: 'Remove day?', message: 'Removes this ungrouped day. History is kept.',
    confirmText: 'Remove', danger: true,
    onConfirm: () => mut(s => {
      s.routines = (s.routines || []).filter(r => r.id !== rid)
      Object.keys(s.week || {}).forEach(k => { if (s.week[k] === rid) delete s.week[k] })
    })
  })

  // == Cover photos ==─
  const pickCover = rid => { const inp = coverRefs.current[rid]; if (inp) inp.click() }
  const handleCover = async (rid, file) => {
    if (!file) return
    if (file.size > 12 * 1024 * 1024) { toast('Image too large (max 12 MB)'); return }
    try { const url = await resizeToCover(file); setR(rid, r => { r.photo = url }) }
    catch { toast('Could not read image') }
  }
  const pickProgCover = pid => { const inp = progCoverRefs.current[pid]; if (inp) inp.click() }
  const handleProgCover = async (pid, file) => {
    if (!file) return
    if (file.size > 12 * 1024 * 1024) { toast('Image too large (max 12 MB)'); return }
    try { const url = await resizeToCover(file); setP(pid, p => { p.photo = url }) }
    catch { toast('Could not read image') }
  }

  // == Exercise picker ==
  const addExercise = rid => exercisePicker(ex => {
    const scheme = defaultScheme(3, 10, 0)
    editEx(rid, list => list.push({ id: ex.id, setScheme: scheme, trackRpe: false }))
  })

  // == Save as template ==─
  const saveAsTemplate = async pid => {
    const prog = programs.find(p => p.id === pid)
    if (!prog) return
    const days = progDays(prog).map(d => ({ name: d.name, emoji: d.emoji || '', desc: d.desc || '', coachNote: d.coachNote || '', video: d.video || '', photo: d.photo || null, ex: d.ex || [] }))
    try {
      await coachSaveTemplate({ name: prog.name, data: { desc: prog.desc || '', emoji: prog.emoji || 'forge', photo: prog.photo || null, days } })
      toast('Saved template: ' + prog.name)
    } catch (e) { toast(e.message || 'Could not save template') }
  }

  // == Render a single exercise row inside a day ==
  const renderExRow = (r, e, i) => {
    const ex = EXIDX[e.id]
    if (!ex) return null
    const scheme = e.setScheme || defaultScheme(e.sets || 3, e.reps || 10, e.weight || 0)
    const cardio = isCardio(e.id)
    return <div key={i} className="cch-ex-card">
      <div className="cch-ex-top">
        <Thumb ex={ex} style={{ width: 44, height: 44, borderRadius: 9, flexShrink: 0 }} />
        <div className="cch-ex-info">
          <div className="cch-ex-name">{ex.n}</div>
          <div className="cch-ex-meta">{ex.bp} · {ex.eq}</div>
        </div>
        <div className="cch-ex-order">
          <button className="cch-order-btn" disabled={i === 0} onClick={() => moveEx(r.id, i, -1)}><Icon name="chevronUp" /></button>
          <button className="cch-order-btn" disabled={i === r.ex.length - 1} onClick={() => moveEx(r.id, i, 1)}><Icon name="chevronDown" /></button>
        </div>
        <button className="cch-ex-del" onClick={() => editEx(r.id, list => list.splice(i, 1))} title="Remove"><Icon name="trash" /></button>
      </div>
      {cardio
        ? <div className="cch-cardio-cfg">
            <div className="cch-set-row" style={{ fontWeight: 600, fontSize: 12, color: 'var(--label-2)' }}>
              <span>Sets</span><span>Min</span><span>km/h</span>
            </div>
            {scheme.map((s, si) => <div key={si} className="cch-set-row">
              <span className="cch-set-num">{si + 1}</span>
              <input type="number" className="cch-set-input" value={s.min ?? 20} min={1} max={180}
                onChange={v => setR(r.id, x => { const sc = [...(x.ex[i].setScheme || scheme)]; sc[si] = { ...sc[si], min: +v.target.value || 20 }; x.ex[i].setScheme = sc })} />
              <input type="number" className="cch-set-input" value={s.speed ?? 8} min={0} max={50} step={0.5}
                onChange={v => setR(r.id, x => { const sc = [...(x.ex[i].setScheme || scheme)]; sc[si] = { ...sc[si], speed: +v.target.value || 8 }; x.ex[i].setScheme = sc })} />
            </div>)}
          </div>
        : <div className="cch-sets-table">
            <div className="cch-sets-thead"><span>Set</span><span>Reps</span><span>{unit}</span></div>
            {scheme.map((s, si) => <div key={si} className="cch-set-row">
              <span className="cch-set-num">{si + 1}</span>
              <input type="number" className="cch-set-input" value={s.r ?? 10} min={1} max={200}
                onChange={v => setR(r.id, x => { const sc = [...(x.ex[i].setScheme || scheme)]; sc[si] = { ...sc[si], r: +v.target.value || 10 }; x.ex[i].setScheme = sc })} />
              <input type="number" className="cch-set-input" value={s.w ?? 0} min={0} max={2000} step={2.5}
                onChange={v => setR(r.id, x => { const sc = [...(x.ex[i].setScheme || scheme)]; sc[si] = { ...sc[si], w: +v.target.value || 0 }; x.ex[i].setScheme = sc })} />
            </div>)}
            <div className="cch-set-actions">
              <button className="cch-set-action-btn" onClick={() => setR(r.id, x => { const sc = x.ex[i].setScheme || [...scheme]; x.ex[i].setScheme = [...sc, { ...sc[sc.length - 1] }] })}><Icon name="plus" /> Set</button>
              {scheme.length > 1 && <button className="cch-set-action-btn danger" onClick={() => setR(r.id, x => { const sc = [...(x.ex[i].setScheme || scheme)]; sc.pop(); x.ex[i].setScheme = sc })}><Icon name="minus" /></button>}
            </div>
          </div>}
    </div>
  }

  // == Render an expanded day body ==
  const renderDayBody = (r, onDelete) => <div className="cch-plan-body">
    <div className="cch-field-group">
      <label className="cch-field-label">Description</label>
      <textarea className="cch-textarea" rows={2} value={r.desc || ''} placeholder="What this session is for…" onChange={e => setR(r.id, x => { x.desc = e.target.value })} />
    </div>
    <div className="cch-field-group">
      <label className="cch-field-label">Coach notes <span className="cch-field-hint">(visible to trainee)</span></label>
      <textarea className="cch-textarea" rows={2} value={r.coachNote || ''} placeholder="Cues, tempo, form reminders…" onChange={e => setR(r.id, x => { x.coachNote = e.target.value })} />
    </div>
    <div className="cch-field-group">
      <label className="cch-field-label">Video URL</label>
      <input className="cch-input" type="url" value={r.video || ''} placeholder="https://youtube.com/…" onChange={e => setR(r.id, x => { x.video = e.target.value.trim() })} />
    </div>
    <div className="cch-exercises-header">
      <span className="cch-section-label">Exercises</span>
      <button className="btn sm" onClick={() => addExercise(r.id)}><Icon name="plus" /> Add</button>
    </div>
    {r.ex.length === 0
      ? <div className="cch-ex-empty">No exercises yet — tap Add to begin</div>
      : <div className="cch-ex-list">{r.ex.map((e, i) => renderExRow(r, e, i))}</div>}
    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      <button className="btn sm" onClick={() => pickCover(r.id)}><Icon name="camera" /> {r.photo ? 'Change cover' : 'Add cover photo'}</button>
      {r.photo && <button className="btn sm" onClick={() => setR(r.id, x => { x.photo = null })}>Remove cover</button>}
      <button className="btn sm danger" onClick={onDelete} style={{ marginLeft: 'auto' }}>Remove day</button>
    </div>
  </div>

  // == Render a day card ==
  const renderDayCard = (r, onDelete) => {
    const dayOpen = openDay === r.id
    const exCount = r.ex?.length || 0
    return <div key={r.id} className={'cch-day-card' + (dayOpen ? ' open' : '')}>
      <input ref={el => { coverRefs.current[r.id] = el }} type="file" accept="image/*" style={{ display: 'none' }} onChange={ev => handleCover(r.id, ev.target.files[0])} />
      {r.photo && <div className="cch-day-cover-strip" onClick={() => pickCover(r.id)}>
        <img src={r.photo} alt="" style={{ width: '100%', objectFit: 'cover', maxHeight: 80, display: 'block' }} />
        <button className="cch-cover-remove" onClick={e => { e.stopPropagation(); setR(r.id, x => { x.photo = null }) }}><Icon name="xmark" style={{ width: 14, height: 14 }} /></button>
      </div>}
      <div className="cch-day-card-header">
        <input className="cch-plan-name-input" value={r.name} placeholder="Day name"
          onChange={e => setR(r.id, x => { x.name = e.target.value || 'Day' })} />
        <div className="cch-day-meta">{exCount} ex{exCount !== 1 ? '' : ''}</div>
        <button className={'cch-expand-btn' + (dayOpen ? ' open' : '')} onClick={() => setOpenDay(dayOpen ? null : r.id)}>
          <Icon name={dayOpen ? 'chevronUp' : 'chevronDown'} />
        </button>
      </div>
      {dayOpen && renderDayBody(r, onDelete)}
    </div>
  }

  return <div className="narrow">
    {/* == Header ==─ */}
    <div className="hdr" style={{ marginBottom: 14 }}>
      <button className="iconbtn" onClick={leave}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 6 }}>
        <h1 style={{ marginBottom: 2 }}>{tuser?.name || '…'}</h1>
        <div className="sub">{me?.name ? me.name + ' · ' : ''}Coaching view</div>
      </div>
      <button className={'btn sm' + (dirty ? ' primary' : '')} style={{ minWidth: 72, opacity: dirty ? 1 : 0.4 }}
        disabled={saving || !dirty} onClick={save}>
        {saving ? '…' : dirty ? 'Save' : 'Saved'}
      </button>
    </div>

    {/* == Activity ==─ */}
    <div className="cch-activity">
      <div className="cch-stats-row">
        <div className="cch-stat-tile"><div className="cch-stat-n">{draft.workouts?.length || 0}</div><div className="cch-stat-l">Workouts</div></div>
        <div className="cch-stat-tile"><div className="cch-stat-n">{streakCount}</div><div className="cch-stat-l">Day streak</div></div>
        <div className="cch-stat-tile"><div className="cch-stat-n">{lastBw ? fmtNum(lastBw.w) : '—'}</div><div className="cch-stat-l">{lastBw ? unit : 'No weight'}</div></div>
      </div>
      {recentWks.length > 0 && <div className="cch-recent">
        <div className="cch-section-label">Recent workouts</div>
        {recentWks.map(w => {
          const thumbs = (w.entries || []).slice(0, 4).map(e => EXIDX[e.id]).filter(Boolean)
          return <div key={w.id || w.d} className="cch-workout-row">
            <div className="cch-workout-thumbs">
              {thumbs.length > 0
                ? thumbs.map((ex, i) => <Thumb key={i} ex={ex} style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />)
                : <div className="cch-workout-icon"><Icon name="forge" /></div>}
            </div>
            <div className="cch-workout-info">
              <div className="cch-workout-name">{w.name || 'Workout'}</div>
              <div className="cch-workout-meta">{fmtDate(w.d)} · {setsDone(w)} sets · {fmtVol(w.vol || 0, unit)}</div>
            </div>
          </div>
        })}
      </div>}
    </div>

    {/* == Profile responses ==─ */}
    {responses.length > 0 && <div className="cch-activity" style={{ marginBottom: 4 }}>
      <div className="cch-section-label" style={{ marginBottom: 10 }}>Profile responses</div>
      {responses.map(r => <div key={r.id} style={{ marginBottom: 10, background: 'var(--surface)', borderRadius: 10, padding: 12, border: 'var(--hair) solid var(--sep-op)' }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: 'var(--label-2)', display: 'flex', justifyContent: 'space-between' }}>
          <span>{r.title}</span>
          <span style={{ fontWeight: 400, fontSize: 12 }}>{fmtDate(r.completedAt)}</span>
        </div>
        {r.fields.filter(f => r.responses[f.id]).map(f => <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, marginBottom: 4 }}>
          <span style={{ color: 'var(--label-2)' }}>{f.label}</span>
          <span style={{ fontWeight: 500 }}>{r.responses[f.id]}</span>
        </div>)}
      </div>)}
    </div>}

    {/* == Programs ==─ */}
    <div className="cch-section-header">
      <span className="cch-section-label">Programs</span>
      <button className="btn sm primary" onClick={addProgram}><Icon name="plus" /> New program</button>
    </div>

    {programs.length === 0 && ungrouped.length === 0
      ? <div className="cch-empty-state"><Icon name="clipboard" /><div>No programs yet</div><div className="cch-empty-sub">Create a program, add days to it, then assign days to the weekly schedule below</div></div>
      : <>
          {programs.map(prog => {
            const days = progDays(prog)
            const progOpen = openProg === prog.id
            return <div key={prog.id} className={'cch-program-card' + (progOpen ? ' open' : '')}>
              {/* Program cover photo */}
              <input ref={el => { progCoverRefs.current[prog.id] = el }} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleProgCover(prog.id, e.target.files[0])} />
              <div className="cch-plan-cover" onClick={() => pickProgCover(prog.id)}>
                {prog.photo
                  ? <img src={prog.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div className="cch-plan-cover-empty"><Icon name="camera" style={{ width: 28, height: 28 }} /><span>Add cover photo</span></div>}
                {prog.photo && <button className="cch-cover-remove" onClick={e => { e.stopPropagation(); setP(prog.id, p => { p.photo = null }) }}><Icon name="xmark" style={{ width: 14, height: 14 }} /></button>}
                <div className="cch-cover-edit-hint"><Icon name="camera" style={{ width: 14, height: 14 }} /> Edit</div>
              </div>
              {/* Program header */}
              <div className="cch-plan-header">
                <div className="cch-plan-title-row">
                  <input className="cch-plan-name-input" value={prog.name} placeholder="Program name"
                    onChange={e => setP(prog.id, p => { p.name = e.target.value || 'Program' })} />
                  <button className={'cch-expand-btn' + (progOpen ? ' open' : '')} onClick={() => setOpenProg(progOpen ? null : prog.id)}>
                    <Icon name={progOpen ? 'chevronUp' : 'chevronDown'} />
                  </button>
                </div>
                <div className="cch-plan-meta">{days.length} day{days.length !== 1 ? 's' : ''}{prog.coach ? ` · by ${prog.coach}` : ''}{prog.coach && tuser?.name && prog.coach === tuser.name ? <span className="tag" style={{ marginLeft: 6, fontSize: 10, opacity: 0.75 }}>user</span> : null}</div>
              </div>
              {/* Expanded program editor */}
              {progOpen && <div className="cch-prog-body">
                <div className="cch-field-group">
                  <label className="cch-field-label">Program description</label>
                  <textarea className="cch-textarea" rows={2} value={prog.desc || ''} placeholder="Program overview, goals, duration…" onChange={e => setP(prog.id, p => { p.desc = e.target.value })} />
                </div>
                {/* Days list */}
                <div className="cch-days-header">
                  <span className="cch-section-label" style={{ fontSize: 13 }}>Days</span>
                  <button className="btn sm" onClick={() => addDay(prog.id)}><Icon name="plus" /> Add day</button>
                </div>
                {days.length === 0
                  ? <div className="cch-ex-empty">No days yet — tap Add day to begin. Each day is a workout session you can assign to week days below.</div>
                  : <div className="cch-days-list">
                      {days.map(r => renderDayCard(r, () => delDay(prog.id, r.id)))}
                    </div>}
                {/* Program actions */}
                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', borderTop: '1px solid var(--surface-3)', paddingTop: 12 }}>
                  <button className="btn sm" onClick={() => saveAsTemplate(prog.id)}><Icon name="bookmark" /> Save as template</button>
                  <button className="btn sm danger" style={{ marginLeft: 'auto' }} onClick={() => delProgram(prog.id)}>Delete program</button>
                </div>
              </div>}
            </div>
          })}

          {/* Ungrouped routines (backward compat) */}
          {ungrouped.length > 0 && <div className="cch-ungrouped">
            <div className="cch-section-label" style={{ marginBottom: 8, opacity: 0.65 }}>Ungrouped days</div>
            {ungrouped.map(r => renderDayCard(r, () => delUngrouped(r.id)))}
          </div>}
        </>}

    {/* == Weekly schedule == */}
    <div className="cch-section-header" style={{ marginTop: 28 }}>
      <span className="cch-section-label">Weekly schedule</span>
    </div>
    <div className="cch-week-grid">
      {[1, 2, 3, 4, 5, 6, 0].map(d => {
        const assigned = routines.find(r => r.id === (draft.week?.[d] || ''))
        const prog = assigned ? dayProgram(assigned.id) : null
        const color = assigned ? ACCENT_COLORS[routines.indexOf(assigned) % ACCENT_COLORS.length] : null
        const nextPlan = () => {
          const cur = draft.week?.[d]
          const ci = routines.findIndex(r => r.id === cur)
          const next = routines[(ci + 1) % (routines.length + 1)]
          mut(s => { if (next) s.week[d] = next.id; else delete s.week[d] })
        }
        return <button key={d} className={'cch-day-cell' + (assigned ? ' assigned' : '')} onClick={nextPlan} style={assigned ? { '--day-color': color } : {}}>
          <div className="cch-day-abbr">{DAY_SHORT[d]}</div>
          {assigned
            ? <>
                {prog && <div className="cch-day-prog-label">{prog.name}</div>}
                <div className="cch-day-plan" style={{ color }}>{assigned.name}</div>
              </>
            : <div className="cch-day-rest">Rest</div>}
        </button>
      })}
    </div>

    <div style={{ height: 20 }} />
    <button className={'btn' + (dirty ? ' primary' : ' ghost')} style={{ opacity: dirty ? 1 : 0.4 }} disabled={saving || !dirty} onClick={save}>
      {saving ? 'Saving…' : dirty ? 'Save changes' : 'All saved'}
    </button>
    <div style={{ height: 48 }} />
  </div>
}
