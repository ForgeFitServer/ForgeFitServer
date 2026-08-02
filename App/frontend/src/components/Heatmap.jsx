import { useEffect, useRef, useState } from 'react'
import { fmtVol, isoOf, todayISO, MONTHS } from '../lib/format.js'
import { t } from '../lib/i18n.js'

export default function Heatmap({ S, onDay }) {
  const wrapRef = useRef(null)
  const [scrollOffset, setScrollOffset] = useState(0)
  
  const monthScrollDistance = 12 * 17 // ~204px per 3-month scroll
  
  useEffect(() => { 
    if (wrapRef.current) {
      wrapRef.current.scrollLeft = Math.max(0, scrollOffset * monthScrollDistance)
    }
  }, [scrollOffset])

  const agg = {}
  S.workouts.forEach(w => {
    const a = agg[w.d] = agg[w.d] || { n: 0, vol: 0, min: 0 }
    a.n++; a.vol += w.vol || 0
    a.min += Math.max(0, Math.round(((w.end || w.start) - w.start) / 60000))
  })
  const mins = Object.values(agg).map(a => a.min).filter(v => v > 0).sort((a, b) => a - b)
  const q = p => (mins.length ? mins[Math.min(mins.length - 1, Math.floor(p * mins.length))] : 0)
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75)
  const level = a => !a ? 0 : !a.min ? 1 : a.min >= t3 ? 4 : a.min >= t2 ? 3 : a.min >= t1 ? 2 : 1

  const today = new Date(); today.setHours(12, 0, 0, 0)
  const end = new Date(today); end.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  
  let earliestDate = new Date(end)
  if (S.workouts.length > 0) {
    const oldest = S.workouts.reduce((min, w) => {
      const d = new Date(w.d); return d < min ? d : min
    }, new Date(S.workouts[0].d))
    earliestDate = new Date(oldest)
  }
  
  const start = new Date(end); start.setDate(end.getDate() - 52 * 7)
  // If earliest data is older than 52 weeks, extend the start date
  if (earliestDate < start) {
    const weeksNeeded = Math.ceil((end - earliestDate) / (7 * 86400000))
    start.setDate(end.getDate() - weeksNeeded * 7)
  }
  
  const weeksToShow = Math.ceil((end - start) / (7 * 86400000))

  const months = [], years = [], cols = []
  let lastMonth = -1
  let lastYear = -1
  for (let wk = 0; wk <= weeksToShow; wk++) {
    const colStart = new Date(start); colStart.setDate(start.getDate() + wk * 7)
    const mo = colStart.getMonth()
    const yr = colStart.getFullYear()
    const yearChanged = yr !== lastYear
    const showM = mo !== lastMonth && colStart.getDate() <= 7 && wk < weeksToShow - 1
    
    // Track year changes for header (4 weeks per year segment)
    if (yearChanged) {
      years.push({ wk, yr })
      lastYear = yr
    }
    
    months.push(<span key={wk}>{showM ? t(MONTHS[mo]) : ''}</span>)
    if (colStart.getDate() <= 7) lastMonth = mo
    const cells = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(colStart); day.setDate(colStart.getDate() + d)
      const key = isoOf(day)
      const a = agg[key]
      const cls = 'hm-c l' + level(a) + (key === todayISO() ? ' today' : '') + (day > today ? ' future' : '')
      cells.push(<div key={d} className={cls}
        title={key + (a ? ` · ${t(a.n === 1 ? '{0} workout' : '{0} workouts', a.n)} · ${a.min} min · ${fmtVol(a.vol, S.unit)}` : '')}
        onClick={a ? () => onDay(key) : undefined} />)
    }
    cols.push(<div key={wk} className="hm-col">{cells}</div>)
  }

  return <>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
        <button onClick={() => setScrollOffset(Math.max(0, scrollOffset - 1))} 
          style={{ 
            padding: '8px 16px', 
            fontSize: 13,
            fontWeight: scrollOffset > 0 ? '600' : '400',
            opacity: scrollOffset > 0 ? 1 : 0.6,
            cursor: 'pointer',
            background: scrollOffset > 0 ? 'var(--surface-2)' : 'transparent',
            border: '0.5px solid var(--sep)',
            borderRadius: 6,
            color: 'inherit',
            transition: 'background 140ms, opacity 140ms'
          }}>{t('← Older')}</button>
        <button onClick={() => setScrollOffset(scrollOffset + 1)} 
          style={{ 
            padding: '8px 16px', 
            fontSize: 13,
            fontWeight: scrollOffset < 100 ? '600' : '400',
            opacity: scrollOffset < 100 ? 1 : 0.6,
            cursor: 'pointer',
            background: scrollOffset < 100 ? 'var(--surface-2)' : 'transparent',
            border: '0.5px solid var(--sep)',
            borderRadius: 6,
            color: 'inherit',
            transition: 'background 140ms, opacity 140ms'
          }}>{t('Newer →')}</button>
      </div>
      <span style={{ fontSize: 12, opacity: 0.5 }}>{t('Swipe or navigate by 3-month blocks')}</span>
    </div>
    <div className="hm-wrap" ref={wrapRef}>
      <div className="hm-years">
        {years.map((y, i) => {
          const nextWk = years[i + 1]?.wk || weeksToShow
          const weekSpan = nextWk - y.wk
          return <div key={y.yr} style={{ display: 'flex', alignItems: 'center', gap: 3, flex: `0 0 ${weekSpan * 14 + (weekSpan - 1) * 3}px` }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--label)' }}>{y.yr}</span>
          </div>
        })}
      </div>
      <div className="hm-months">{months}</div>
      <div className="hm-body">
        <div className="hm-days"><span>{t('Mon')}</span><span /><span>{t('Wed')}</span><span /><span>{t('Fri')}</span><span /><span /></div>
        <div className="hm-grid">{cols}</div>
      </div>
    </div>
    <div className="hm-legend">{t('Less time')} <div className="hm-c l0" /><div className="hm-c l1" /><div className="hm-c l2" /><div className="hm-c l3" /><div className="hm-c l4" /> {t('More time')}</div>
  </>
}
