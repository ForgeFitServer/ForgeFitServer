// SPDX-License-Identifier: AGPL-3.0-or-later
export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)
export const BIO = IS_APPLE ? 'Face ID / Touch ID' : IS_ANDROID ? 'fingerprint or face unlock' : 'your fingerprint, face or PIN'
export const VAULT = IS_APPLE ? 'iCloud Keychain' : IS_ANDROID ? 'Google Password Manager' : 'your password manager'
export const webauthnOK = () => !!(window.PublicKeyCredential && navigator.credentials)

export async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e }
  return data
}

const bufToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uToBuf = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer

function toCreationOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  o.user.id = b64uToBuf(o.user.id)
  ;(o.excludeCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
function toRequestOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  ;(o.allowCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
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
export async function passkeyRegister(name, code, coachKey) {
  const { cid, options } = await api('/api/register/options', { method: 'POST', body: JSON.stringify({ name, code: code || '', coachKey: coachKey || undefined }) })
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) })
  const res = await api('/api/register/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
export async function passkeyLogin() {
  const { cid, options } = await api('/api/login/options', { method: 'POST', body: '{}' })
  const cred = await navigator.credentials.get({ publicKey: toRequestOptions(options) })
  const res = await api('/api/login/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}

// Coaching: manage trainees, plans, invite codes
export const coachTrainees = () => api('/api/coach/trainees').then(r => r.trainees)
export const coachTrainee = id => api('/api/coach/trainee?id=' + encodeURIComponent(id))
export const coachSaveTrainee = (id, state) => api('/api/coach/trainee?id=' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ state }) })
export const coachInvite = () => api('/api/coach/invite', { method: 'POST', body: '{}' }).then(r => r.code)
export const coachInvites = () => api('/api/coach/invites').then(r => r.invites)
export const coachSetRole = (id, coach) => api('/api/coach/role', { method: 'POST', body: JSON.stringify({ id, coach }) })

// Questionnaires: create and manage for trainees
export const coachQuestionnaires = () => api('/api/coach/questionnaires').then(r => r.questionnaires)
export const createQuestionnaire = (title, description, fields) => api('/api/coach/questionnaire', { method: 'POST', body: JSON.stringify({ title, description, fields }) })
export const updateQuestionnaire = (id, title, description, fields) => api('/api/coach/questionnaire', { method: 'PUT', body: JSON.stringify({ id, title, description, fields }) })
export const deleteQuestionnaire = id => api('/api/coach/questionnaire', { method: 'DELETE', body: JSON.stringify({ id }) })
export const assignQuestionnaire = (questionnaireId, traineeId, required) => api('/api/coach/assign-questionnaire', { method: 'POST', body: JSON.stringify({ questionnaireId, traineeId, required }) })

// Plan templates: shared library for all coaches
export const coachTemplates = () => api('/api/coach/templates').then(r => r.templates)
export const coachSaveTemplate = data => api('/api/coach/template', { method: 'POST', body: JSON.stringify(data) })
export const coachUpdateTemplate = (id, name, templateData) => api('/api/coach/template', { method: 'PUT', body: JSON.stringify({ id, name, data: templateData }) })
export const coachDeleteTemplate = id => api('/api/coach/template', { method: 'DELETE', body: JSON.stringify({ id }) })

// Trainee questionnaire responses (coach view)
export const coachTraineeResponses = id => api('/api/coach/trainee-responses?id=' + encodeURIComponent(id)).then(r => r.responses)
export const coachSetDefaultQuestionnaire = id => api('/api/coach/questionnaire/set-default', { method: 'POST', body: JSON.stringify({ id }) })

// Questionnaires (trainee): view and complete assigned forms
export const getAssignedQuestionnaires = () => api('/api/questionnaires').then(r => r.assignments)
export const submitQuestionnaire = (assignmentId, responses) => api('/api/questionnaire/submit', { method: 'POST', body: JSON.stringify({ assignmentId, responses }) })

// Password auth (when AUTH_MODE includes 'password')
export async function passwordRegister(name, password, code, coachKey) {
  const r = await api('/api/password/register', { method: 'POST', body: JSON.stringify({ name, password, code: code || '', coachKey: coachKey || undefined }) })
  return r.user
}
export async function passwordLogin(name, password) {
  const r = await api('/api/password/login', { method: 'POST', body: JSON.stringify({ name, password }) })
  return r.user
}

// Auth method management: add passkeys, set/change password, view methods
export async function getAuthMethods() {
  const r = await api('/api/auth/methods')
  return r.methods
}
export async function addPasskeyOptions() {
  const { cid, options } = await api('/api/auth/add-passkey/options', { method: 'POST', body: '{}' })
  return { cid, options }
}
export async function addPasskeyVerify(cid, credential) {
  return api('/api/auth/add-passkey/verify', { method: 'POST', body: JSON.stringify({ cid, credential }) })
}
export async function setPassword(password) {
  return api('/api/auth/set-password', { method: 'POST', body: JSON.stringify({ password }) })
}
export async function changePassword(oldPassword, newPassword) {
  return api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) })
}
export async function removePasskey(credId) {
  return api('/api/auth/passkey/' + encodeURIComponent(credId), { method: 'DELETE' })
}
export async function removePassword() {
  return api('/api/auth/password', { method: 'DELETE' })
}
