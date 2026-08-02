// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { effectiveRoutine, effectiveRoutineId, streakWeeks, lastBW, setsDoneActive } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, isoOf, weekKey, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { getAssignedQuestionnaires } from '../lib/api.js'
import { bwSheet, dayOverrideSheet, calendarSheet, startFlow, loadStarterPlan, bwDeltaColor, questionnaireSheet } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import Avatar from '../components/Avatar.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'

// Home = what to do now + a quick glance. Deep charts & history live in Stats.
export default function Home() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const [weekOffset, setWeekOffset] = useState(0)
  const [monthOffset, setMonthOffset] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [pendingQuestions, setPendingQuestions] = useState([])

  useEffect(() => {
    const loadQuestions = async () => {
      try {
        const { assignments } = await getAssignedQuestionnaires()
        setPendingQuestions(assignments || [])
      } catch (e) {
        // Silent fail if not logged in or API error
      }
    }
    loadQuestions()
  }, [])

  const today = new Date()
  const routine = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineId(S, iso), ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} onClick={() => dayOverrideSheet(iso)}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`

  // Full-month grid (shown when the calendar is expanded). Monday-first, leading/trailing
  // days from adjacent months are rendered dimmed so the 7-column grid always stays aligned.
  const monthAnchor = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1)
  const monthLabel = monthAnchor.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })
  const firstDow = (monthAnchor.getDay() + 6) % 7 // 0 = Monday
  const gridStart = new Date(monthAnchor); gridStart.setDate(1 - firstDow)
  const monthCells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart); d.setDate(gridStart.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineId(S, iso), ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    const inMonth = d.getMonth() === monthAnchor.getMonth()
    monthCells.push(
      <div key={i} className={'mcell' + (iso === todayISO() ? ' today' : '') + (inMonth ? '' : ' out')} onClick={() => dayOverrideSheet(iso)}>
        <div className="mnum">{d.getDate()}</div><div className={'dot' + dot} />
      </div>
    )
    if (monthCells.length >= 35 && d.getMonth() !== monthAnchor.getMonth() && (i % 7 === 6)) break
  }

  const wThisWeek = S.workouts.filter(w => weekKey(w.d) === weekKey(todayISO())).length
  const plannedPerWeek = Object.keys(S.week).filter(k => S.week[k]).length
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))

  // today's session shown right under the week strip
  const onToday = () => { if (S.active) nav('/workout'); else if (routine) startFlow(routine.id); else dayOverrideSheet(todayISO()) }

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{user ? t('Hi {0}', user.name) : __BRAND_NAME__}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button className="avatarbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}>
        <Avatar id={user?.id || 'guest'} name={user?.name || '?'} src={S.avatar} size={38} />
      </button>
    </div>

    {pendingQuestions.length > 0 && (
      <div className="card" style={{ background: 'color-mix(in srgb, var(--acc) 10%, transparent)', borderColor: 'var(--acc)' }}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Icon name="clipboard" style={{ color: 'var(--acc)' }} />
            <div>
              <div className="tt">{t('Pending forms')}</div>
              <div className="small muted">{pendingQuestions.length} {pendingQuestions.length === 1 ? t('form waiting') : t('forms waiting')}</div>
            </div>
          </div>
        </div>
        {pendingQuestions.map(q => (
          <div key={q.id} className="row between" style={{ padding: 8, marginBottom: 6, background: 'var(--surface)', borderRadius: 6, cursor: 'pointer' }} onClick={() => questionnaireSheet(q, () => { setPendingQuestions(p => p.filter(x => x.id !== q.id)) })}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="tt" style={{ marginBottom: 2 }}>{q.title}</div>
              {q.description && <div className="small muted">{q.description}</div>}
            </div>
            <div className="small" style={{ color: 'var(--acc)', fontWeight: 500, marginLeft: 8, flex: 'none' }}>{t('Complete')}</div>
          </div>
        ))}
      </div>
    )}

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => expanded ? setMonthOffset(m => m - 1) : setWeekOffset(w => w - 1)} aria-label={expanded ? 'Previous month' : 'Previous week'}><Icon name="chevronLeft" /></button>
        <button className="btn plain" style={{ fontWeight: 600, padding: '2px 10px', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setExpanded(e => !e)}>
          {expanded ? monthLabel : wkLabel}
          <Icon name={expanded ? 'chevronUp' : 'chevronDown'} style={{ fontSize: 13 }} />
        </button>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => expanded ? setMonthOffset(m => m + 1) : setWeekOffset(w => w + 1)} aria-label={expanded ? 'Next month' : 'Next week'}><Icon name="chevronRight" /></button>
      </div>
      {expanded ? <>
        <div className="mdow">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d}>{t(d)}</div>)}</div>
        <div className="month">{monthCells}</div>
      </> : <div className="week">{strip}</div>}
      <div className="today-row" onClick={onToday}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={S.active ? 'timer' : routine ? glyphOf(routine.emoji) : 'moon'} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Today')}</div>
            <div className="ttl">{S.active ? t('{0} — in progress', S.active.name) : routine ? routine.name : t('Rest day')}{todayOvr && routine ? ' · ' + t('rescheduled') : ''}</div>
          </div>
        </div>
        {S.active ? <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{t('Resume')}</span>
          : routine ? <span className="tag acc">{t('Start')}</span>
          : <Icon name="plus" className="chev" />}
      </div>
    </div>

    {!S.routines.length && !S.active && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="sparkles" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going — or load the default \u2143\u018eVEL program to start training.')}</div>
        <Button variant="primary" icon="forge" onClick={loadStarterPlan}>{t('Load \u2143\u018eVEL - Class: Fighter')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}

    <div className="card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
        </div>
      </div>
      {bw ? <>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></div>
          {delta !== null && (
            <span className="small row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(delta, bw.w) }}>
              <Icon name={delta > 0 ? 'arrowUp' : delta < 0 ? 'arrowDown' : 'minus'} style={{ fontSize: 12 }} />
              {fmtNum(Math.abs(delta))}
            </span>
          )}
          <span className="dim small" style={{ marginLeft: 'auto' }}>{fmtDate(bw.d, true)}</span>
        </div>
        {S.targetW && (
          <div className="small row" style={{ color: 'var(--yellow)', marginTop: 4, gap: 5 }}>
            <Icon name="target" style={{ fontSize: 13 }} />
            <span>{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</span>
          </div>
        )}
        <div className="chart" style={{ marginTop: 8 }}><LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} /></div>
      </> : <div className="muted small">{t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}</div>}
    </div>

    <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => calendarSheet()}>
      <div className="row between">
        <div>
          <div className="row" style={{ gap: 7, fontSize: 22, fontWeight: 600, letterSpacing: '-.021em' }}>
            <Icon name="flame" style={{ color: 'var(--orange)' }} />
            {t('{0} week streak', streakWeeks(S))}
          </div>
          <div className="muted small" style={{ marginTop: 2 }}>{wThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {t(S.workouts.length === 1 ? '{0} workout total' : '{0} workouts total', S.workouts.length)}</div>
        </div>
        <Icon name="calendar" className="chev" style={{ fontSize: 20 }} />
      </div>
    </div>
  </div>
}
