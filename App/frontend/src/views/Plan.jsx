import { useNavigate } from 'react-router-dom'
import { useState, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { DAYN, uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, confirmSheet, glyphPicker } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const user = useStore(s => s.user)
  const [expandedProg, setExpandedProg] = useState(null)
  const [editingProg, setEditingProg] = useState(null) // prog id being renamed
  const [editNameVal, setEditNameVal] = useState('')
  const nameInputRef = useRef(null)

  const getProgramForRoutine = rid => (S.programs || []).find(p => (p.dayIds || []).includes(rid))
  const getRoutine = rid => S.routines.find(x => x.id === rid)
  const getProgramDays = prog => (prog.dayIds || []).map(did => getRoutine(did)).filter(Boolean)

  const setProgIcon = pid => glyphPicker(
    (S.programs || []).find(p => p.id === pid)?.emoji,
    g => update(s => { const p = (s.programs || []).find(x => x.id === pid); if (p) p.emoji = g })
  )
  const setProgDesc = (pid, desc) => update(s => { const p = (s.programs || []).find(x => x.id === pid); if (p) p.desc = desc })

  /* === user program mutations === */
  const addProgram = () => {
    const prog = { id: uid(), name: 'New Program', desc: '', photo: null, emoji: 'forge', coach: user?.name || '', dayIds: [] }
    update(s => { s.programs = [...(s.programs || []), prog] })
    setExpandedProg(prog.id)
    setEditingProg(prog.id)
    setEditNameVal('New Program')
    setTimeout(() => nameInputRef.current?.focus(), 120)
  }

  const startRename = prog => {
    setEditingProg(prog.id)
    setEditNameVal(prog.name)
    setTimeout(() => nameInputRef.current?.select(), 80)
  }

  const commitRename = pid => {
    const n = editNameVal.trim()
    if (n) update(s => { const p = (s.programs || []).find(x => x.id === pid); if (p) p.name = n })
    setEditingProg(null)
  }

  const deleteProgram = pid => confirmSheet({
    title: t('Delete program?'), message: t('All routines in this program will be removed. Workout history is kept.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => update(s => {
      const prog = (s.programs || []).find(p => p.id === pid)
      if (prog) {
        s.routines = (s.routines || []).filter(r => !(prog.dayIds || []).includes(r.id))
        ;(prog.dayIds || []).forEach(rid => Object.keys(s.week || {}).forEach(k => { if (s.week[k] === rid) delete s.week[k] }))
      }
      s.programs = (s.programs || []).filter(p => p.id !== pid)
      if (expandedProg === pid) setExpandedProg(null)
    })
  })

  const addDay = pid => {
    const r = { id: uid(), name: 'New routine', emoji: 'plate', ex: [], desc: '', coachNote: '', video: '', photo: null }
    update(s => {
      s.routines = [...(s.routines || []), r]
      const prog = (s.programs || []).find(p => p.id === pid)
      if (prog) prog.dayIds = [...(prog.dayIds || []), r.id]
    })
    nav(`/plan/r/${r.id}`)
  }

  const deleteDay = (pid, rid) => confirmSheet({
    title: t('Remove routine?'), message: t('Removes this routine from the program. History is kept.'),
    confirmText: t('Remove'), danger: true,
    onConfirm: () => update(s => {
      s.routines = (s.routines || []).filter(r => r.id !== rid)
      const prog = (s.programs || []).find(p => p.id === pid)
      if (prog) prog.dayIds = (prog.dayIds || []).filter(did => did !== rid)
      Object.keys(s.week || {}).forEach(k => { if (s.week[k] === rid) delete s.week[k] })
    })
  })

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
    </div>
    <div className="cols"><div>
      <h4 className="sec">{t('Week schedule')}</h4>
      <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const r = getRoutine(S.week[d])
          const p = r ? getProgramForRoutine(r.id) : null
          const label = r && p ? `${p.name} > ${r.name}` : r?.name
          return <div key={d} className="item" onClick={() => dayAssignSheet(d)}>
            <div className="grow"><div className="tt">{t(DAYN[d])}</div></div>
            {r ? <span className="tag acc"><Icon name={glyphOf(r.emoji)} />{label}</span> : <span className="tag">{t('Rest')}</span>}
            <Icon name="chevronRight" className="chev" /></div>
        })}
      </div>
    </div><div>

      {/* Programs header + add button */}
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 22, marginBottom: 8 }}>
        <h4 className="sec" style={{ margin: 0, flex: 1 }}>{t('My Programs')}</h4>
        <button className="btn sm" onClick={addProgram} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon name="plus" style={{ width: 16, height: 16 }} />{t('New')}
        </button>
      </div>

      {(S.programs || []).length === 0 && <div className="empty" style={{ padding: '24px 0' }}>
        <div className="ico"><Icon name="clipboard" /></div>
        {t('No programs yet.')}<br />
        <span className="dim small">{t('Create a program and add routines to organize your training.')}</span>
      </div>}

      <div className="list">
        {(S.programs || []).map(prog => {
          const days = getProgramDays(prog)
          const isOpen = expandedProg === prog.id
          const isEditing = editingProg === prog.id
          return <div key={prog.id}>
            <div className="item" style={{ cursor: 'pointer' }} onClick={() => { if (!isEditing) setExpandedProg(isOpen ? null : prog.id) }}>
              <span className="lrow-i" style={{ cursor: 'pointer' }} title={t('Pick an icon')} onClick={e => { e.stopPropagation(); setProgIcon(prog.id) }}><Icon name={glyphOf(prog.emoji)} /></span>
              <div className="grow">
                {isEditing
                  ? <input ref={nameInputRef} className="input" style={{ margin: 0, padding: '4px 8px', height: 32, fontSize: '1rem' }} value={editNameVal} onChange={e => setEditNameVal(e.target.value)} onBlur={() => commitRename(prog.id)} onKeyDown={e => { if (e.key === 'Enter') commitRename(prog.id); if (e.key === 'Escape') setEditingProg(null) }} onClick={e => e.stopPropagation()} />
                  : <>
                    <div className="tt">{prog.name}</div>
                    <div className="ss">{t('{0} days', days.length)}{prog.coach ? ' · ' + prog.coach : ''}</div>
                  </>}
              </div>
              {!isEditing && <>
                <button className="icon-btn dim" title={t('Rename')} onClick={e => { e.stopPropagation(); startRename(prog) }}><Icon name="pencil" /></button>
                <button className="icon-btn dim" title={t('Delete')} onClick={e => { e.stopPropagation(); deleteProgram(prog.id) }} style={{ color: 'var(--red)' }}><Icon name="trash" /></button>
                <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} className="chev" />
              </>}
            </div>
            {isOpen && <>
              <div style={{ padding: '6px 14px 4px 14px' }}>
                <label className="dim small" style={{ display: 'block', marginBottom: 4 }}>{t('Description')}</label>
                <textarea className="input" rows={2} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: '0.9em', lineHeight: 1.5 }}
                  placeholder={t('What this program is for, goals, duration…')}
                  defaultValue={prog.desc || ''}
                  onBlur={e => setProgDesc(prog.id, e.target.value)} />
              </div>
              <div style={{ padding: '4px 12px 8px 12px' }}>
                {days.map(r => <div key={r.id} className="item" style={{ margin: '0 -12px 4px -12px', background: 'var(--surface-3)', cursor: 'pointer' }} onClick={() => nav(`/plan/r/${r.id}`)}>
                  {r.photo
                    ? <img src={r.photo} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                    : <span style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={glyphOf(r.emoji)} /></span>}
                  <div className="grow">
                    <div className="tt">{r.name}</div>
                    <div className="ss">{t('{0} exercises', r.ex.length)}</div>
                  </div>
                  <Icon name="pencil" className="dim" style={{ width: 16, height: 16 }} />
                  <button className="icon-btn dim" title={t('Remove')} onClick={e => { e.stopPropagation(); deleteDay(prog.id, r.id) }} style={{ color: 'var(--red)' }}><Icon name="trash" /></button>
                </div>)}
                <button className="btn sm ghost" style={{ marginTop: 6, width: '100%' }} onClick={() => addDay(prog.id)}>
                  <Icon name="plus" style={{ width: 16, height: 16, marginRight: 5 }} />{t('Add routine')}
                </button>
              </div>
            </>}
          </div>
        })}
      </div>
    </div></div>
  </>
}
