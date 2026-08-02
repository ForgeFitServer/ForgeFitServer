import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, passwordLogin, passwordRegister, api, BIO } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { useState, useRef, useEffect } from 'react'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

export default function Login() {
  const { setUser, pullState, pushState, setGuest } = useStore()
  const [tab, setTab] = useState('signin')
  const [name, setName] = useState('')
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [code, setCode] = useState('')
  const [coachKey, setCoachKey] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [authMode, setAuthMode] = useState('all')
  const [inviteOnly, setInviteOnly] = useState(false)
  const nameRef = useRef(null)

  useEffect(() => {
    api('/api/config').then(c => {
      setAuthMode(c.auth_mode || 'all')
      setInviteOnly(!!c.invite_only)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    setError('')
    setTimeout(() => nameRef.current?.focus(), 120)
  }, [tab])

  const bothModes = authMode === 'all' || authMode === 'both'
  const canUsePasskey = webauthnOK() && (authMode === 'passkey' || bothModes)
  const canUsePassword = authMode === 'password' || bothModes

  const err = msg => { setError(msg); setBusy(false) }

  const signInPassword = async e => {
    e.preventDefault()
    if (!name.trim()) { err(t('Enter your name')); return }
    if (!pwd) { err(t('Enter your password')); return }
    setBusy(true); setError('')
    try {
      const u = await passwordLogin(name.trim(), pwd)
      setUser(u); await pullState()
      useUI.getState().toast(t('Welcome back, {0}', u.name))
    } catch (ex) { err(ex.message || t('Sign-in failed')) }
    setBusy(false)
  }

  const signInPasskey = async () => {
    setBusy(true); setError('')
    try {
      const u = await passkeyLogin()
      setUser(u); await pullState()
      useUI.getState().toast(t('Welcome back, {0}', u.name))
    } catch (ex) {
      if (ex.name !== 'NotAllowedError' && ex.name !== 'AbortError') err(ex.message || t('Sign-in failed'))
      else setBusy(false)
    }
    setBusy(false)
  }

  const registerPasskey = async () => {
    const n = name.trim()
    if (!n) { err(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { err(t('An invite code is required')); return }
    setBusy(true); setError('')
    try {
      const u = await passkeyRegister(n, code.trim(), coachKey.trim())
      setUser(u)
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created — data moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (ex) {
      if (ex.name !== 'NotAllowedError' && ex.name !== 'AbortError') err(ex.message || t('Registration failed'))
      else setBusy(false)
    }
    setBusy(false)
  }

  const registerPassword = async e => {
    e.preventDefault()
    const n = name.trim()
    if (!n) { err(t('Enter a name')); return }
    if (pwd.length < 8) { err(t('Password must be at least 8 characters')); return }
    if (pwd !== pwd2) { err(t('Passwords do not match')); return }
    if (inviteOnly && !code.trim()) { err(t('An invite code is required')); return }
    setBusy(true); setError('')
    try {
      const u = await passwordRegister(n, pwd, code.trim(), coachKey.trim())
      setUser(u)
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created — data moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (ex) { err(ex.message || t('Registration failed')) }
    setBusy(false)
  }

  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh' }

  if (DEMO) return (
    <div className="narrow" style={wrap}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 54, color: 'var(--acc)', marginBottom: 12 }}><Icon name="forge" /></div>
        <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '0 0 8px' }}>{__BRAND_NAME__}</h1>
        <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      </div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.5, textAlign: 'center' }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '11px 14px', fontSize: '1rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg)', outline: 'none', marginBottom: 10 }
  const dividerStyle = { display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0', color: 'var(--label)', fontSize: '.85rem' }

  return (
    <div className="narrow" style={wrap}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 54, color: 'var(--acc)', marginBottom: 8 }}><Icon name="forge" /></div>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.028em', margin: 0 }}>{__BRAND_NAME__}</h1>
      </div>

      <div style={{ display: 'flex', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 22 }}>
        <button onClick={() => setTab('signin')} style={{ flex: 1, padding: '11px 0', fontWeight: 600, fontSize: '.95rem', border: 'none', cursor: 'pointer', background: tab === 'signin' ? 'var(--acc)' : 'var(--surface-2)', color: tab === 'signin' ? '#fff' : 'var(--label)', transition: 'background .15s' }}>{t('Sign In')}</button>
        <button onClick={() => setTab('register')} style={{ flex: 1, padding: '11px 0', fontWeight: 600, fontSize: '.95rem', border: 'none', cursor: 'pointer', background: tab === 'register' ? 'var(--acc)' : 'var(--surface-2)', color: tab === 'register' ? '#fff' : 'var(--label)', transition: 'background .15s' }}>{t('Register')}</button>
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,.15)', color: 'var(--red,#f87171)', border: '1px solid var(--red,#f87171)', borderRadius: 10, padding: '9px 14px', marginBottom: 14, fontSize: '.92rem' }}>{error}</div>}

      {tab === 'signin' && <>
        {canUsePassword && <form onSubmit={signInPassword}>
          <input ref={nameRef} style={inputStyle} placeholder={t('Username')} autoComplete="username" value={name} onChange={e => setName(e.target.value)} disabled={busy} />
          <input style={inputStyle} type="password" placeholder={t('Password')} autoComplete="current-password" value={pwd} onChange={e => setPwd(e.target.value)} disabled={busy} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer', fontSize: '.9rem', color: 'var(--label)' }}>
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} style={{ accentColor: 'var(--acc)', width: 15, height: 15 }} />
            {t('Remember me')}
          </label>
          <Button variant="primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>{busy ? t('Signing in…') : t('Sign In')}</Button>
        </form>}

        {canUsePasskey && canUsePassword && <div style={dividerStyle}><div style={{ flex: 1, height: 1, background: 'var(--border)' }} />{t('or')}<div style={{ flex: 1, height: 1, background: 'var(--border)' }} /></div>}

        {canUsePasskey && <Button icon="key" disabled={busy} onClick={signInPasskey} style={{ width: '100%', justifyContent: 'center' }}>{'🔑 ' + t('Sign in with Passkey')}</Button>}

        {!canUsePasskey && !canUsePassword && <div className="card small muted" style={{ textAlign: 'center' }}>{t("This browser doesn't support passkeys and password auth is disabled.")}</div>}
      </>}

      {tab === 'register' && <>
        <input ref={nameRef} style={inputStyle} placeholder={t('Your name')} autoComplete="name" maxLength={40} value={name} onChange={e => setName(e.target.value)} disabled={busy} />

        {inviteOnly && <>
          <input style={{ ...inputStyle, letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} placeholder={t('Invite code')} maxLength={40} value={code} onChange={e => setCode(e.target.value.toUpperCase())} disabled={busy} />
          <div className="dim small" style={{ marginTop: -6, marginBottom: 10 }}>{t('This app is invite-only — enter the code you were given.')}</div>
        </>}

        {canUsePassword && <>
          <input style={inputStyle} type="password" placeholder={t('Password (min. 8 characters)')} autoComplete="new-password" value={pwd} onChange={e => setPwd(e.target.value)} disabled={busy} />
          <input style={inputStyle} type="password" placeholder={t('Confirm password')} autoComplete="new-password" value={pwd2} onChange={e => setPwd2(e.target.value)} disabled={busy} />
        </>}

        <input style={{ ...inputStyle, fontSize: '.9rem', letterSpacing: '.05em' }} placeholder={t('Coach key (optional)')} maxLength={40} value={coachKey} onChange={e => setCoachKey(e.target.value.toUpperCase())} disabled={busy} />
        <div className="dim small" style={{ marginTop: -6, marginBottom: 14 }}>{t('Have a coach invite key? Enter it to sign up as a coach.')}</div>

        {canUsePassword && <Button variant="primary" disabled={busy} onClick={registerPassword} style={{ width: '100%', justifyContent: 'center' }}>{busy ? t('Creating…') : t('Create account')}</Button>}

        {canUsePasskey && canUsePassword && <div style={dividerStyle}><div style={{ flex: 1, height: 1, background: 'var(--border)' }} />{t('or, skip the password')}<div style={{ flex: 1, height: 1, background: 'var(--border)' }} /></div>}

        {canUsePasskey && <>
          <div className="dim small" style={{ marginBottom: 10, textAlign: 'center' }}>{t('Use {0} — no password needed.', BIO)}</div>
          <Button icon="key" disabled={busy} onClick={registerPasskey} style={{ width: '100%', justifyContent: 'center' }}>{'🔑 ' + t('Register with Passkey')}</Button>
        </>}
      </>}

      {(canUsePasskey || canUsePassword) && <>
        <div style={{ ...dividerStyle, marginTop: 20 }}><div style={{ flex: 1, height: 1, background: 'var(--border)' }} /></div>
        <div className="dim small" style={{ marginBottom: 10, textAlign: 'center', lineHeight: 1.5 }}>{t('Guest sessions last up to 24 hours and are not saved permanently. For persistent data, create an account.')}</div>
        <Button variant="ghost" disabled={busy} onClick={() => setGuest(true)} style={{ width: '100%', justifyContent: 'center' }}>{t('Continue as Guest')}</Button>
      </>}
    </div>
  )
}
