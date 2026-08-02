// SPDX-License-Identifier: AGPL-3.0-or-later
// Forge Fitness Server: WebAuthn passkey + password auth, per-user state sync, push notifications
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import webpush from 'web-push';
import { openDb } from './db.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || 'Forge Fitness Server';
const BRAND_NAME = process.env.BRAND_NAME || RP_NAME;
const AUTH_MODE = (process.env.AUTH_MODE || 'all').toLowerCase();
const PASSKEY_ON = AUTH_MODE === 'passkey' || AUTH_MODE === 'all' || AUTH_MODE === 'both';
const PASSWORD_ON = AUTH_MODE === 'password' || AUTH_MODE === 'all' || AUTH_MODE === 'both';
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
const SESSION_DAYS = 365;
const MAX_BODY = 20 * 1024 * 1024;
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';

fs.mkdirSync(DATA, { recursive: true });

// Load or generate session signing secret
const DEFAULT_SECRET = 'change-me-to-a-long-random-string';
if (_rawSecret === DEFAULT_SECRET || (_rawSecret && _rawSecret.length < 16)) {
  console.warn('\u26a0  SESSION_SECRET is weak or unset — using a random per-boot secret. Set a long, random SESSION_SECRET to keep users signed in across restarts.');
}
const SECRET = (_rawSecret && _rawSecret !== DEFAULT_SECRET && _rawSecret.length >= 16)
  ? _rawSecret
  : crypto.randomBytes(32).toString('hex');

const store = openDb(DATA);
const isCoach = user => !!user && user.coach === true;
const readState = uid => store.getState(uid)?.state || null;

// Generate unique coach invite codes (unambiguous alphanumeric)
const COACH_ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 8; i++) {
    let code = ''; const b = crypto.randomBytes(10);
    for (let k = 0; k < 10; k++) code += COACH_ALPH[b[k] % COACH_ALPH.length];
    try { store.createCoachInvite(code, coachId); return code; } catch { /* unique collision ΓÇö retry */ }
  }
  throw new Error('could not allocate coach invite code');
}
// Base64url ID generator (shorter than UUID, still collision-resistant)
const uid = () => crypto.randomBytes(9).toString('base64url');
// Automatically assign coach's default questionnaire to new trainees
function autoAssignDefaultQuestionnaire(userId) {
  const defQ = store.getDefaultQuestionnaire();
  if (!defQ || !defQ.coachId) return;
  try { store.assignQuestionnaire('qa' + uid(), defQ.id, userId, defQ.coachId, true); }
  catch (e) { console.warn('could not auto-assign default questionnaire:', e.message); }
}
// Password hashing with scrypt (no external crypto deps)
const pwHash = pwd => {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pwd, salt, 64).toString('hex');
};
// Time-safe password verification to prevent timing attacks
const pwVerify = (pwd, stored) => {
  if (!stored || typeof stored !== 'string') return false;
  const [salt, key] = stored.split(':');
  try {
    return crypto.timingSafeEqual(crypto.scryptSync(pwd, salt, 64), Buffer.from(key, 'hex'));
  } catch { return false; }
};
const PW_DUMMY = (() => { const s = '0'.repeat(32); return s + ':' + crypto.scryptSync('', s, 64).toString('hex'); })();

// Rate limiting: max 5 attempts per 15-minute window per IP
const RL_WIN = 15 * 60 * 1000;
const _rl = new Map();
const checkRL = ip => {
  const now = Date.now(), e = _rl.get(ip);
  if (!e || now > e.resetAt) { _rl.set(ip, { count: 1, resetAt: now + RL_WIN }); return true; }
  if (++e.count > 5) return false; // max 5 attempts per window
  _rl.set(ip, e);
  return true;
};
setInterval(() => { const n = Date.now(); for (const [k, v] of _rl) if (n > v.resetAt) _rl.delete(k); }, 5 * 60 * 1000).unref();
// Load or generate VAPID keys for Web Push API
const vapidFile = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 }); }
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

// Send push notification to user's registered devices
async function sendPush(userId, payload) {
  const subs = store.subsForUser(userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  await Promise.all(subs.map(async sub => {
    // urgency 'high' is the one lever we have over delivery speed ΓÇö iOS/Android throttle
    // low-urgency background push more aggressively under battery-saving modes. TTL is left
    // at the library default (long) so a briefly-offline device still gets it once reconnected,
    // rather than risking it being dropped for the sake of shaving off latency that TTL doesn't
    // actually control anyway.
    try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { urgency: 'high' }); }
    catch (e) {
      console.error('push send failed', userId, e.statusCode, e.body || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) store.deleteSub(sub.endpoint);
    }
  }));
}

// Rest timer tracking (sends push notification when timer expires)
const restTimers = new Map(); // userId -> Timeout
function scheduleRestTimer(userId, sec) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, { title: 'Rest over ≡ƒÆ¬', body: 'Time for your next set.', tag: 'rest-timer' });
  }, sec * 1000));
}
// Cancel pending rest timer for user
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

// Get effective routine for a date (respects day overrides)
function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week?.[wd] || null;
}
// Convert current time to user's timezone (ISO date + HH:MM)
function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
  } catch { return null; } // unknown/invalid tz string ΓÇö skip this user rather than guess
}
// Background job: send daily workout reminders (once per day at user's preferred time)
setInterval(() => {
  for (const user of store.listUsers()) {
    if (!store.userHasPush(user.id)) continue;
    const S = readState(user.id);
    if (!S?.reminder?.on) continue;
    const now = userNow(S.reminder.tz || 'UTC');
    if (!now || S.reminder.time !== now.hhmm) continue;
    if (user.lastReminder === now.date) continue;
    if ((S.workouts || []).some(w => w.d === now.date)) continue;
    const rid = effectiveRoutineId(S, now.date);
    if (!rid) continue; // rest day ΓÇö nothing planned
    const routine = (S.routines || []).find(r => r.id === rid);
    console.log('reminder firing', user.id, rid);
    store.setLastReminder(user.id, now.date);
    sendPush(user.id, {
      title: routine ? `${routine.emoji || '≡ƒÅï∩╕Å'} ${routine.name} today` : 'Workout planned today',
      body: "It's on your plan ΓÇö let's go ≡ƒÆ¬",
      tag: 'day-reminder'
    });
  }
}, 10000).unref();

/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}
function makeSession(uid, credId) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = credId ? uid + ':' + credId + ':' + exp : uid + ':' + exp;
  return sign(payload);
}
function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const tok = cookies.gymsid;
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const parts = payload.split(':');
  // Support both old format (uid:exp) and new format (uid:credId:exp)
  let uid, exp, activeCred;
  if (parts.length === 3) {
    [uid, activeCred, exp] = parts;
  } else {
    [uid, exp] = parts;
  }
  if (!uid || +exp < Date.now()) return null;
  const user = store.getUser(uid);
  if (user && user.disabled) return null;   // disabled accounts are locked out everywhere
  if (user) user._activeCred = activeCred || null;
  return user;
}
function requireAdmin(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isAdmin(user)) { json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
function requireCoach(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isCoach(user)) { json(res, 403, { error: 'coach access only' }); return null; }
  return user;
}
function sessionCookie(uid, credId) {
  return `gymsid=${makeSession(uid, credId)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
}
const clearCookie = `gymsid=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;

/* ---------- challenge store (in-memory, 5 min TTL) ---------- */
const challenges = new Map(); // cid -> {challenge, name?, uid?, exp}
function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  challenges.set(cid, { ...data, exp: Date.now() + 5 * 60000 });
  return cid;
}
function takeChallenge(cid) {
  const c = challenges.get(cid);
  challenges.delete(cid);
  if (!c || c.exp < Date.now()) return null;
  return c;
}
setInterval(() => { for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k); }, 60000).unref();

/* ---------- helpers ---------- */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
const clientIp = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
const b64uToBuf = s => Buffer.from(s, 'base64url');

/* ---------- live presence (in-memory) ---------- */
const presence = new Map();               // uid -> { name, exIdx, exTotal, setsDone, setsTotal, startedAt, updatedAt }
const PRESENCE_TTL = 70000;               // ~3.5├ù the 20s client heartbeat
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: store.userCount() }),

  // Public config the login screen needs before anyone is signed in.
  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY, brand_name: BRAND_NAME, auth_mode: AUTH_MODE }),

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user), coach: user.coach } });
  },

  'POST /api/register/options': async (req, res) => {
    if (!PASSKEY_ON) return json(res, 404, { error: 'not found' });
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    const code = String(body.code || '').trim().toUpperCase();
    if (INVITE_ONLY && !store.validInvite(code))
      return json(res, 403, { error: 'a valid invite code is required' });
    const coachKey = String(body.coachKey || '').replace(/\s+/g, '').toUpperCase() || null;
    // Fail fast on a bad coach key before the device runs the passkey ceremony
    // (the very first account bootstraps as a coach regardless).
    if (coachKey && store.userCount() > 0) {
      const ci = store.getCoachInvite(coachKey);
      if (!ci || ci.usedBy) return json(res, 400, { error: 'invalid or already-used coach key' });
    }
    const uid = crypto.randomBytes(12).toString('base64url');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(uid), userName: name, userDisplayName: name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, name, uid, code, coachKey });
    json(res, 200, { cid, options });
  },

  'POST /api/register/verify': async (req, res) => {
    if (!PASSKEY_ON) return json(res, 404, { error: 'not found' });
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.uid) return json(res, 400, { error: 'challenge expired ΓÇö try again' });
    // Coach role: the very first account bootstraps as a coach; after that a coach
    // account needs a valid single-use coach invite key from an existing coach.
    const bootstrap = store.userCount() === 0;
    let coach = bootstrap;
    if (!coach && c.coachKey) {
      const ci = store.getCoachInvite(c.coachKey);
      if (!ci || ci.usedBy) return json(res, 400, { error: 'invalid or already-used coach key' });
      coach = true;
    }
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    const { credential } = verification.registrationInfo;
    if (store.getCred(credential.id)) return json(res, 409, { error: 'credential already registered' });
    // Re-check the invite at the last moment (it may have been used/revoked since options), then burn it.
    let invite = null;
    if (INVITE_ONLY) {
      invite = store.validInvite(c.code);
      if (!invite) return json(res, 403, { error: 'invite code is no longer valid ΓÇö ask for a new one' });
    }
    const created = new Date().toISOString();
    store.createUser({ id: c.uid, name: c.name, created, admin: bootstrap, coach, invitedBy: invite ? invite.code : undefined });
    store.addCred({
      id: credential.id, userId: c.uid,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    if (invite) store.useInvite(invite.code, c.uid, created);
    if (coach && !bootstrap && c.coachKey) store.consumeCoachInvite(c.coachKey, c.uid);
    // Auto-assign default registration questionnaire to new user
    autoAssignDefaultQuestionnaire(c.uid);
    json(res, 200, { user: { id: c.uid, name: c.name, admin: bootstrap, coach } }, { 'Set-Cookie': sessionCookie(c.uid) });
  },

  'POST /api/login/options': async (req, res) => {
    if (!PASSKEY_ON) return json(res, 404, { error: 'not found' });
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'preferred', allowCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge });
    json(res, 200, { cid, options });
  },

  'POST /api/login/verify': async (req, res) => {
    if (!PASSKEY_ON) return json(res, 404, { error: 'not found' });
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c) return json(res, 400, { error: 'challenge expired ΓÇö try again' });
    const cred = store.getCred(body.credential?.id);
    if (!cred) return json(res, 404, { error: 'unknown passkey ΓÇö create a profile first' });
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: b64uToBuf(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports
        }
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    store.setCredCounter(cred.id, verification.authenticationInfo.newCounter);
    const user = store.getUser(cred.userId);
    if (!user) return json(res, 500, { error: 'user missing' });
    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user), coach: user.coach } }, { 'Set-Cookie': sessionCookie(user.id, cred.id) });
  },

  'POST /api/logout': async (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie }),

  /* ---------- password register + login (active when AUTH_MODE includes password) ---------- */
  'POST /api/password/register': async (req, res) => {
    if (!PASSWORD_ON) return json(res, 404, { error: 'not found' });
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    const pwd  = String(body.password || '');
    if (!name) return json(res, 400, { error: 'name required' });
    if (pwd.length < 8) return json(res, 400, { error: 'password must be at least 8 characters' });
    const code = String(body.code || '').trim().toUpperCase();
    if (INVITE_ONLY && !store.validInvite(code)) return json(res, 403, { error: 'a valid invite code is required' });
    if (store.getUserByName(name)) return json(res, 409, { error: 'that name is already taken' });
    const coachKey = String(body.coachKey || '').replace(/\s+/g, '').toUpperCase() || null;
    const bootstrap = store.userCount() === 0;
    let coach = bootstrap;
    if (!coach && coachKey) {
      const ci = store.getCoachInvite(coachKey);
      if (!ci || ci.usedBy) return json(res, 400, { error: 'invalid or already-used coach key' });
      coach = true;
    }
    let invite = null;
    if (INVITE_ONLY) {
      invite = store.validInvite(code);
      if (!invite) return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
    }
    const uid = crypto.randomBytes(12).toString('base64url');
    const created = new Date().toISOString();
    store.createUser({ id: uid, name, created, admin: bootstrap, coach: bootstrap || coach, invitedBy: invite ? invite.code : undefined });
    store.setPassword(uid, pwHash(pwd));
    if (invite) store.useInvite(invite.code, uid, created);
    if (coach && !bootstrap && coachKey) store.consumeCoachInvite(coachKey, uid);
    // Auto-assign default registration questionnaire to new user
    autoAssignDefaultQuestionnaire(uid);
    json(res, 200, { user: { id: uid, name, admin: bootstrap, coach: bootstrap || coach } }, { 'Set-Cookie': sessionCookie(uid) });
  },

  'POST /api/password/login': async (req, res) => {
    if (!PASSWORD_ON) return json(res, 404, { error: 'not found' });
    const ip = clientIp(req);
    if (!checkRL(ip)) return json(res, 429, { error: 'too many failed attempts — try again in 15 minutes' });
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const pwd  = String(body.password || '');
    const u    = store.getUserByName(name);
    const hash = u ? store.getPasswordHash(u.id) : null;
    // Always run scrypt (even when user not found) so timing is consistent — prevents enumeration.
    const ok = pwVerify(pwd, hash ?? PW_DUMMY);
    if (!ok || !u) return json(res, 401, { error: 'incorrect name or password' });
    if (u.disabled) return json(res, 403, { error: 'this account has been disabled' });
    _rl.delete(ip); // reset on successful login
    json(res, 200, { user: { id: u.id, name: u.name, admin: isAdmin(u), coach: isCoach(u) } }, { 'Set-Cookie': sessionCookie(u.id) });
  },

  /* ---------- auth method management (logged-in users) ---------- */
  'GET /api/auth/methods': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const passkeys = store.getCredsForUser(user.id) || [];
    const hasPassword = store.hasPassword(user.id);
    json(res, 200, {
      methods: {
        passkeys: passkeys.map(c => ({ id: c.id, created: c.id.slice(0, 8), transports: c.transports, active: c.id === user._activeCred })),
        password: hasPassword
      }
    });
  },

  'POST /api/auth/add-passkey/options': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    // Get existing credentials to exclude them
    const existing = store.getCredsForUser(user.id) || [];
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(user.id), userName: user.name, userDisplayName: user.name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: existing.map(c => ({ id: c.id, type: 'public-key' }))
    });
    const cid = putChallenge({ challenge: options.challenge, uid: user.id, isAddingPasskey: true });
    json(res, 200, { cid, options });
  },

  'POST /api/auth/add-passkey/verify': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.isAddingPasskey) return json(res, 400, { error: 'challenge expired — try again' });
    if (c.uid !== user.id) return json(res, 400, { error: 'challenge mismatch' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    const { credential } = verification.registrationInfo;
    if (store.getCred(credential.id)) return json(res, 409, { error: 'this passkey is already registered' });
    store.addCred({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    json(res, 200, { ok: true });
  },

  'POST /api/auth/set-password': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const pwd = String(body.password || '');
    if (pwd.length < 8) return json(res, 400, { error: 'password must be at least 8 characters' });
    store.setPassword(user.id, pwHash(pwd));
    json(res, 200, { ok: true });
  },

  'POST /api/auth/change-password': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const ip = clientIp(req);
    if (!checkRL(ip)) return json(res, 429, { error: 'too many failed attempts — try again in 15 minutes' });
    const body = await readBody(req);
    const oldPwd = String(body.oldPassword || '');
    const newPwd = String(body.newPassword || '');
    if (newPwd.length < 8) return json(res, 400, { error: 'new password must be at least 8 characters' });
    const hash = store.getPasswordHash(user.id);
    if (!hash || !pwVerify(oldPwd, hash)) return json(res, 401, { error: 'incorrect password' });
    store.setPassword(user.id, pwHash(newPwd));
    _rl.delete(ip);
    json(res, 200, { ok: true });
  },

  'DELETE /api/auth/passkey/:id': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const credId = req.url.split('/').pop();
    if (!credId) return json(res, 400, { error: 'credential id required' });
    const cred = store.getCred(credId);
    if (!cred || cred.userId !== user.id) return json(res, 404, { error: 'passkey not found' });
    // Prevent removing the last passkey if no password is set
    const remaining = (store.getCredsForUser(user.id) || []).length - 1;
    const hasPassword = store.hasPassword(user.id);
    if (remaining === 0 && !hasPassword) {
      return json(res, 400, { error: 'cannot remove the last passkey — set a password first' });
    }
    store.deleteCred(credId);
    json(res, 200, { ok: true });
  },

  'DELETE /api/auth/password': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    // Keep at least one login method: a password can go only if a passkey remains.
    const passkeys = (store.getCredsForUser(user.id) || []).length;
    if (passkeys < 1) {
      return json(res, 400, { error: 'cannot remove the only login method — add a passkey first' });
    }
    store.deletePassword(user.id);
    json(res, 200, { ok: true });
  },

  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const s = store.getState(user.id);
    json(res, 200, { state: s ? s.state : null });
  },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    delete body.state.active;              // in-progress workouts stay device-local
    store.setState(user.id, body.state, body.state._ts || Date.now());
    json(res, 200, { ok: true, ts: body.state._ts || null });
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    store.addSub({ userId: user.id, endpoint: sub.endpoint, keys: sub.keys, created: new Date().toISOString() });
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    store.deleteUserSub(user.id, body.endpoint);
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    await sendPush(user.id, { title: 'Forge Fitness Server', body: 'Test notification — this is what alerts look like.', tag: 'test' });
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  // Live-workout heartbeat: client pings while a workout is on screen; { active:false } drops it.
  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  /* ---------- admin dashboard ---------- */
  // One row per user, cheap enough for a personal instance (reads each state file once).
  'GET /api/admin/users': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const users = store.listUsers().map(u => {
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      const last = workouts[workouts.length - 1];
      return {
        id: u.id, name: u.name, created: u.created || null,
        disabled: !!u.disabled, admin: isAdmin(u), coach: !!u.coach, invitedBy: u.invitedBy || null,
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: store.userHasPush(u.id),
        avatar: S.avatar || null,
        live: livePresence(u.id)
      };
    });
    json(res, 200, { users, invite_only: INVITE_ONLY, now: Date.now() });
  },

  // Drill-down: full workout history + body-weight log for one user.
  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = store.getUser(id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: { id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse()   // newest first for display
    });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = store.getUser(body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    const disabled = !!body.disabled;
    store.setDisabled(u.id, disabled);
    if (disabled) presence.delete(u.id);   // drop them off "training now" at once
    json(res, 200, { ok: true, id: u.id, disabled });
  },

  'GET /api/admin/invites': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // resolve usedBy uid ΓåÆ name for display
    const invites = store.listInvites().map(i => ({
      ...i, usedByName: i.usedBy ? (store.getUser(i.usedBy) || {}).name || null : null
    }));
    json(res, 200, { invites, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    let code;
    do { code = crypto.randomBytes(4).toString('hex').toUpperCase(); } while (store.getInvite(code));
    const invite = { code, note: String(body.note || '').slice(0, 60), createdBy: admin.id, created: new Date().toISOString() };
    store.addInvite(invite);
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const inv = store.getInvite(String(body.code || '').toUpperCase());
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.usedBy) return json(res, 400, { error: 'already used ΓÇö cannot revoke' });
    store.revokeInvite(inv.code);
    json(res, 200, { ok: true });
  },

  /* ---------- coaching (coach role only) ---------- */
  'GET /api/coach/trainees': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const trainees = store.listUsers().map(u => {
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      return {
        id: u.id, name: u.name, coach: !!u.coach, admin: isAdmin(u), disabled: !!u.disabled, self: u.id === coach.id,
        workouts: workouts.length,
        lastWorkout: workouts.length ? workouts[workouts.length - 1].d : null,
        weight: (S.bodyweight && S.bodyweight.length) ? S.bodyweight[S.bodyweight.length - 1].w : null,
        avatar: S.avatar || null
      };
    });
    json(res, 200, { trainees });
  },

  'GET /api/coach/trainee': async (req, res, url) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const u = store.getUser(url.searchParams.get('id'));
    if (!u) return json(res, 404, { error: 'no such user' });
    json(res, 200, { user: { id: u.id, name: u.name, coach: !!u.coach }, state: readState(u.id) });
  },

  'PUT /api/coach/trainee': async (req, res, url) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const u = store.getUser(url.searchParams.get('id'));
    if (!u) return json(res, 404, { error: 'no such user' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    delete body.state.active;
    body.state._ts = Date.now();           // newest-wins: the trainee's devices adopt the coach's edit
    store.setState(u.id, body.state, body.state._ts);
    json(res, 200, { ok: true, ts: body.state._ts });
  },

  'POST /api/coach/invite': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    json(res, 200, { code: newCoachInvite(coach.id) });
  },

  'GET /api/coach/invites': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const names = Object.fromEntries(store.listUsers().map(u => [u.id, u.name]));
    const invites = store.listCoachInvites(coach.id).map(i => ({
      code: i.code, created: i.created, used: !!i.usedBy,
      usedBy: i.usedBy ? (names[i.usedBy] || 'unknown') : null, usedAt: i.usedAt
    }));
    json(res, 200, { invites });
  },

  'POST /api/coach/role': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const u = store.getUser(body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const wantCoach = !!body.coach;
    if (u.id === coach.id && !wantCoach) return json(res, 400, { error: 'you cannot remove your own coach role' });
    store.setCoach(u.id, wantCoach);
    json(res, 200, { ok: true, coach: wantCoach });
  },

  /* ---------- questionnaires (coach role only) ---------- */
  'GET /api/questionnaires': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    // Get pending assignments for trainee
    const assignments = store.listUserAssignments(user.id);
    json(res, 200, { assignments });
  },

  'GET /api/coach/questionnaires': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    // All questionnaires visible to all coaches (shared coaching environment)
    const questionnaires = store.listAllQuestionnaires();
    json(res, 200, { questionnaires });
  },

  'POST /api/coach/questionnaire': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const title = String(body.title || '').trim().slice(0, 120);
    if (!title) return json(res, 400, { error: 'title required' });
    const description = String(body.description || '').trim().slice(0, 500);
    const fields = Array.isArray(body.fields) ? body.fields : [];
    const id = 'q' + uid();
    try {
      store.createQuestionnaire(id, coach.id, title, description, fields, false);
      json(res, 201, { id, questionnaire: store.getQuestionnaire(id) });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  },

  'PUT /api/coach/questionnaire': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const q = store.getQuestionnaire(body.id);
    if (!q) return json(res, 404, { error: 'questionnaire not found' });
    if (q.coachId !== coach.id) return json(res, 403, { error: 'not your questionnaire' });
    const title = String(body.title || '').trim().slice(0, 120);
    if (!title) return json(res, 400, { error: 'title required' });
    const description = String(body.description || '').trim().slice(0, 500);
    const fields = Array.isArray(body.fields) ? body.fields : (q.fields || []);
    store.updateQuestionnaire(body.id, title, description, fields);
    json(res, 200, { questionnaire: store.getQuestionnaire(body.id) });
  },

  'DELETE /api/coach/questionnaire': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const q = store.getQuestionnaire(body.id);
    if (!q) return json(res, 404, { error: 'questionnaire not found' });
    if (q.coachId !== coach.id) return json(res, 403, { error: 'not your questionnaire' });
    store.deleteQuestionnaire(body.id);
    json(res, 200, { ok: true });
  },

  'POST /api/coach/assign-questionnaire': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const trainee = store.getUser(body.traineeId);
    if (!trainee) return json(res, 404, { error: 'trainee not found' });
    const q = store.getQuestionnaire(body.questionnaireId);
    if (!q) return json(res, 404, { error: 'questionnaire not found' });
    const id = 'qa' + uid();
    store.assignQuestionnaire(id, body.questionnaireId, body.traineeId, coach.id, body.required !== false);
    json(res, 201, { assignmentId: id });
  },

  'POST /api/coach/questionnaire/set-default': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const q = store.getQuestionnaire(body.id);
    if (!q) return json(res, 404, { error: 'questionnaire not found' });
    // Toggle: if this one is already default, clear it; otherwise set it as default
    if (q.isDefault) {
      store.clearDefaultQuestionnaire();
      json(res, 200, { ok: true, isDefault: false });
    } else {
      store.setDefaultQuestionnaire(body.id);
      json(res, 200, { ok: true, isDefault: true });
    }
  },

  'GET /api/coach/trainee-responses': async (req, res, url) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const u = store.getUser(url.searchParams.get('id'));
    if (!u) return json(res, 404, { error: 'no such user' });
    json(res, 200, { responses: store.listCompletedResponses(u.id) });
  },

  'POST /api/questionnaire/submit': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const assignment = store.getAssignment(body.assignmentId);
    if (!assignment) return json(res, 404, { error: 'assignment not found' });
    if (assignment.assignedToUserId !== user.id) return json(res, 403, { error: 'not assigned to you' });
    // Only accept a flat map of field -> primitive, capped in size, and only for the
    // fields this questionnaire actually defines (drops any injected extra keys).
    const raw = (body.responses && typeof body.responses === 'object' && !Array.isArray(body.responses)) ? body.responses : {};
    const allowed = new Set((assignment.fields || []).map(f => f.id));
    const responses = {};
    for (const k of Object.keys(raw)) {
      if (allowed.size && !allowed.has(k)) continue;
      const v = raw[k];
      if (v == null) continue;
      responses[String(k).slice(0, 80)] = String(v).slice(0, 2000);
    }
    const id = 'qr' + uid();
    store.submitResponse(id, body.assignmentId, responses);
    store.completeAssignment(body.assignmentId);
    json(res, 201, { responseId: id });
  },

  /* ---------- plan templates (coach role only) ---------- */
  'GET /api/coach/templates': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    // All coaches can see all templates (shared library)
    json(res, 200, { templates: store.listPlanTemplates() });
  },
  'POST /api/coach/template': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 120);
    if (!name) return json(res, 400, { error: 'name required' });
    const data = (body.data && typeof body.data === 'object') ? body.data : {};
    // Strip cover photos from templates to keep storage lean; photos live on trainee state only
    if (Array.isArray(data.days)) data.days.forEach(d => { delete d.photo; });
    const id = 'pt' + uid();
    store.createPlanTemplate(id, coach.id, name, data);
    json(res, 201, { id, template: store.getPlanTemplate(id) });
  },
  'PUT /api/coach/template': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const tmpl = store.getPlanTemplate(body.id);
    if (!tmpl) return json(res, 404, { error: 'template not found' });
    if (tmpl.coachId !== coach.id) return json(res, 403, { error: 'not your template' });
    const name = String(body.name || '').trim().slice(0, 120);
    if (!name) return json(res, 400, { error: 'name required' });
    const data = (body.data && typeof body.data === 'object') ? body.data : tmpl.data;
    if (Array.isArray(data.days)) data.days.forEach(d => { delete d.photo; });
    store.updatePlanTemplate(body.id, name, data);
    json(res, 200, { template: store.getPlanTemplate(body.id) });
  },
  'DELETE /api/coach/template': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const tmpl = store.getPlanTemplate(body.id);
    if (!tmpl) return json(res, 404, { error: 'template not found' });
    if (tmpl.coachId !== coach.id) return json(res, 403, { error: 'not your template' });
    store.deletePlanTemplate(body.id);
    json(res, 200, { ok: true });
  },
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = req.method + ' ' + url.pathname;
  let handler = routes[key];

  // Fallback: match parameterized routes like /api/auth/passkey/:id
  if (!handler) {
    const pathParts = url.pathname.split('/');
    for (const routeKey of Object.keys(routes)) {
      if (!routeKey.startsWith(req.method + ' ')) continue;
      const routeParts = routeKey.slice(req.method.length + 1).split('/');
      if (routeParts.length !== pathParts.length) continue;
      if (routeParts.every((rp, i) => rp.startsWith(':') || rp === pathParts[i])) {
        handler = routes[routeKey];
        break;
      }
    }
  }

  if (!handler) return json(res, 404, { error: 'not found' });
  try { await handler(req, res, url); }
  catch (e) {
    // Malformed input is the client's fault (400), not a server error (500).
    const msg = String(e && e.message || '');
    if (!res.headersSent && (msg === 'bad json' || msg === 'body too large')) {
      return json(res, 400, { error: msg });
    }
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => {
  // Initialize default questionnaire if needed
  if (!store.getDefaultQuestionnaire()) {
    const defaultQFields = [
      { id: 'weight', type: 'number', label: 'Weight', unit: store.getState(null)?.state?.unit || 'kg', required: true },
      { id: 'height', type: 'text', label: 'Height', hint: 'e.g., 180 cm or 5\'11"', required: true }
    ];
    store.createQuestionnaire('q-default', 'system', 'User Settings', 'Initial user profile setup', defaultQFields, true);
  }
  console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`);
});
