// SPDX-License-Identifier: AGPL-3.0-or-later
// SQLite database: users, credentials, state, subscriptions, invites, questionnaires
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// JSON serialization helper
const j = v => JSON.stringify(v);
// Map database rows to client objects (convert snake_case to camelCase, parse JSON)
const mapUser = r => r && {
  id: r.id, name: r.name, created: r.created,
  admin: !!r.admin, coach: !!r.coach, disabled: !!r.disabled,
  invitedBy: r.invited_by || undefined, lastReminder: r.last_reminder || undefined
};
// Map passkey credentials from database
const mapCred = r => r && { id: r.id, userId: r.user_id, publicKey: r.public_key, counter: r.counter, transports: JSON.parse(r.transports || '[]') };
// Map push subscriptions
const mapSub = r => r && { userId: r.user_id, endpoint: r.endpoint, keys: JSON.parse(r.keys), created: r.created };
// Map user invites (for registration)
const mapInvite = r => r && { code: r.code, note: r.note || '', createdBy: r.created_by, created: r.created, usedBy: r.used_by || undefined, usedAt: r.used_at || undefined };
// Map coach invite codes (for trainee onboarding)
const mapCoachInvite = r => r && { code: r.code, createdBy: r.created_by, created: r.created, usedBy: r.used_by || undefined, usedAt: r.used_at || undefined };
// Map questionnaire definitions
const mapQuestionnaire = r => r && { id: r.id, coachId: r.coach_id, title: r.title, description: r.description, fields: JSON.parse(r.fields || '[]'), isDefault: !!r.is_default, created: r.created, updated: r.updated };
// Map questionnaire assignments to users
const mapAssignment = r => r && { id: r.id, questionnaireId: r.questionnaire_id, assignedToUserId: r.assigned_to_user_id, assignedByCoachId: r.assigned_by_coach_id, required: !!r.required, created: r.created, completedAt: r.completed_at || undefined, title: r.title, fields: r.fields ? JSON.parse(r.fields) : [] };
// Map questionnaire responses from users
const mapResponse = r => r && { id: r.id, assignmentId: r.assignment_id, responses: JSON.parse(r.responses || '{}'), completedAt: r.completed_at };
// Map saved routine/program templates
const mapTemplate = r => r && { id: r.id, coachId: r.coach_id, name: r.name, data: JSON.parse(r.data || '{}'), created: r.created, updated: r.updated };

// Initialize database with schema and return API object
export function openDb(DATA) {
  const db = new DatabaseSync(path.join(DATA, 'gym.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      created       TEXT NOT NULL,
      admin         INTEGER NOT NULL DEFAULT 0,
      coach         INTEGER NOT NULL DEFAULT 0,
      disabled      INTEGER NOT NULL DEFAULT 0,
      invited_by    TEXT,
      last_reminder TEXT
    );
    CREATE TABLE IF NOT EXISTS creds (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      public_key TEXT NOT NULL,
      counter    INTEGER NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS state (
      user_id TEXT PRIMARY KEY,
      data    TEXT NOT NULL,
      ts      INTEGER
    );
    CREATE TABLE IF NOT EXISTS subs (
      endpoint TEXT PRIMARY KEY,
      user_id  TEXT NOT NULL,
      keys     TEXT NOT NULL,
      created  TEXT
    );
    CREATE TABLE IF NOT EXISTS invites (
      code       TEXT PRIMARY KEY,
      note       TEXT,
      created_by TEXT,
      created    TEXT,
      used_by    TEXT,
      used_at    TEXT
    );
    CREATE TABLE IF NOT EXISTS coach_invites (
      code       TEXT PRIMARY KEY,
      created_by TEXT NOT NULL,
      created    TEXT NOT NULL,
      used_by    TEXT,
      used_at    TEXT
    );
    CREATE TABLE IF NOT EXISTS passwords (
      user_id TEXT PRIMARY KEY,
      hash    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS questionnaires (
      id            TEXT PRIMARY KEY,
      coach_id      TEXT NOT NULL,
      title         TEXT NOT NULL,
      description   TEXT,
      fields        TEXT NOT NULL,
      is_default    INTEGER NOT NULL DEFAULT 0,
      created       TEXT NOT NULL,
      updated       TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS questionnaire_assignments (
      id                    TEXT PRIMARY KEY,
      questionnaire_id      TEXT NOT NULL,
      assigned_to_user_id   TEXT NOT NULL,
      assigned_by_coach_id  TEXT NOT NULL,
      required              INTEGER NOT NULL DEFAULT 1,
      created               TEXT NOT NULL,
      completed_at          TEXT,
      FOREIGN KEY (questionnaire_id) REFERENCES questionnaires(id),
      FOREIGN KEY (assigned_to_user_id) REFERENCES users(id),
      FOREIGN KEY (assigned_by_coach_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS questionnaire_responses (
      id             TEXT PRIMARY KEY,
      assignment_id  TEXT NOT NULL,
      responses      TEXT NOT NULL,
      completed_at   TEXT NOT NULL,
      FOREIGN KEY (assignment_id) REFERENCES questionnaire_assignments(id)
    );
    CREATE TABLE IF NOT EXISTS plan_templates (
      id        TEXT PRIMARY KEY,
      coach_id  TEXT NOT NULL,
      name      TEXT NOT NULL,
      data      TEXT NOT NULL DEFAULT '{}',
      created   TEXT NOT NULL,
      updated   TEXT NOT NULL
    );
  `);

  const q = {
    userCount:  db.prepare('SELECT COUNT(*) AS n FROM users'),
    coachCount: db.prepare("SELECT COUNT(*) AS n FROM users WHERE coach = 1"),
    getUser:    db.prepare('SELECT * FROM users WHERE id = ?'),
    getUserByName:  db.prepare("SELECT * FROM users WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1"),
    listUsers:  db.prepare('SELECT * FROM users ORDER BY created'),
    insUser:    db.prepare('INSERT INTO users (id, name, created, admin, coach, invited_by) VALUES (?, ?, ?, ?, ?, ?)'),
    setDisabled: db.prepare('UPDATE users SET disabled = ? WHERE id = ?'),
    setCoach:    db.prepare('UPDATE users SET coach = ? WHERE id = ?'),
    setReminder: db.prepare('UPDATE users SET last_reminder = ? WHERE id = ?'),

    getCred:    db.prepare('SELECT * FROM creds WHERE id = ?'),
    insCred:    db.prepare('INSERT INTO creds (id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)'),
    setCounter: db.prepare('UPDATE creds SET counter = ? WHERE id = ?'),
    getCredsForUser: db.prepare('SELECT * FROM creds WHERE user_id = ?'),
    delCred: db.prepare('DELETE FROM creds WHERE id = ?'),

    getState:   db.prepare('SELECT data, ts FROM state WHERE user_id = ?'),
    upState:    db.prepare(`INSERT INTO state (user_id, data, ts) VALUES (?, ?, ?)
                            ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, ts = excluded.ts`),

    subsForUser: db.prepare('SELECT * FROM subs WHERE user_id = ?'),
    userHasPush: db.prepare('SELECT 1 FROM subs WHERE user_id = ? LIMIT 1'),
    upSub:       db.prepare(`INSERT INTO subs (endpoint, user_id, keys, created) VALUES (?, ?, ?, ?)
                             ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys = excluded.keys`),
    delSub:      db.prepare('DELETE FROM subs WHERE endpoint = ?'),
    delUserSub:  db.prepare('DELETE FROM subs WHERE user_id = ? AND endpoint = ?'),

    listInvites: db.prepare('SELECT * FROM invites ORDER BY created DESC'),
    getInvite:   db.prepare('SELECT * FROM invites WHERE code = ?'),
    insInvite:   db.prepare('INSERT INTO invites (code, note, created_by, created) VALUES (?, ?, ?, ?)'),
    useInvite:   db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL'),
    delInvite:   db.prepare('DELETE FROM invites WHERE code = ? AND used_by IS NULL'),

    insCoachInvite:  db.prepare('INSERT INTO coach_invites (code, created_by, created) VALUES (?, ?, ?)'),
    getCoachInvite:  db.prepare('SELECT * FROM coach_invites WHERE code = ?'),
    useCoachInvite:  db.prepare('UPDATE coach_invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL'),
    listCoachInvites: db.prepare('SELECT * FROM coach_invites WHERE created_by = ? ORDER BY created DESC'),

    setPassword:    db.prepare('INSERT INTO passwords (user_id, hash) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET hash = excluded.hash'),
    getPasswordHash: db.prepare('SELECT hash FROM passwords WHERE user_id = ?'),
    delPassword:     db.prepare('DELETE FROM passwords WHERE user_id = ?'),

    /* questionnaires */
    getQuestionnaire: db.prepare('SELECT * FROM questionnaires WHERE id = ?'),
    listCoachQuestionnaires: db.prepare('SELECT * FROM questionnaires WHERE coach_id = ? ORDER BY created DESC'),
    listAllQuestionnaires: db.prepare('SELECT * FROM questionnaires ORDER BY is_default DESC, created DESC'),
    getDefaultQuestionnaire: db.prepare('SELECT * FROM questionnaires WHERE is_default = 1 LIMIT 1'),
    insQuestionnaire: db.prepare('INSERT INTO questionnaires (id, coach_id, title, description, fields, is_default, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    upQuestionnaire: db.prepare('UPDATE questionnaires SET title = ?, description = ?, fields = ?, updated = ? WHERE id = ?'),
    delQuestionnaire: db.prepare('DELETE FROM questionnaires WHERE id = ?'),
    clearDefault: db.prepare('UPDATE questionnaires SET is_default = 0'),
    setDefault:   db.prepare('UPDATE questionnaires SET is_default = 1 WHERE id = ?'),
    listCompletedResponses: db.prepare(`SELECT qa.id, qa.questionnaire_id, qa.completed_at, q.title, q.fields, qr.responses FROM questionnaire_assignments qa JOIN questionnaires q ON qa.questionnaire_id = q.id LEFT JOIN questionnaire_responses qr ON qr.assignment_id = qa.id WHERE qa.assigned_to_user_id = ? AND qa.completed_at IS NOT NULL ORDER BY qa.completed_at DESC`),

    listAssignments: db.prepare('SELECT * FROM questionnaire_assignments WHERE assigned_to_user_id = ? ORDER BY created DESC'),
    getAssignment: db.prepare('SELECT * FROM questionnaire_assignments WHERE id = ?'),
    insAssignment: db.prepare('INSERT INTO questionnaire_assignments (id, questionnaire_id, assigned_to_user_id, assigned_by_coach_id, required, created) VALUES (?, ?, ?, ?, ?, ?)'),
    completeAssignment: db.prepare('UPDATE questionnaire_assignments SET completed_at = ? WHERE id = ?'),
    listTraineeAssignments: db.prepare('SELECT qa.*, q.title, q.fields FROM questionnaire_assignments qa JOIN questionnaires q ON qa.questionnaire_id = q.id WHERE qa.assigned_to_user_id = ? AND qa.completed_at IS NULL ORDER BY qa.created DESC'),

    insResponse: db.prepare('INSERT INTO questionnaire_responses (id, assignment_id, responses, completed_at) VALUES (?, ?, ?, ?)'),
    getResponse: db.prepare('SELECT * FROM questionnaire_responses WHERE assignment_id = ?'),

    /* plan templates */
    listPlanTemplates:  db.prepare('SELECT * FROM plan_templates ORDER BY created DESC'),
    getPlanTemplate:    db.prepare('SELECT * FROM plan_templates WHERE id = ?'),
    insPlanTemplate:    db.prepare('INSERT INTO plan_templates (id, coach_id, name, data, created, updated) VALUES (?, ?, ?, ?, ?, ?)'),
    upPlanTemplate:     db.prepare('UPDATE plan_templates SET name = ?, data = ?, updated = ? WHERE id = ?'),
    delPlanTemplate:    db.prepare('DELETE FROM plan_templates WHERE id = ?'),
  };

  const store = {
    /* users */
    userCount: () => q.userCount.get().n,
    coachCount: () => q.coachCount.get().n,
    getUser: id => mapUser(q.getUser.get(id)),
    getUserByName: name => mapUser(q.getUserByName.get(name)),
    listUsers: () => q.listUsers.all().map(mapUser),
    createUser: u => q.insUser.run(u.id, u.name, u.created || new Date().toISOString(), u.admin ? 1 : 0, u.coach ? 1 : 0, u.invitedBy || null),
    setDisabled: (id, v) => q.setDisabled.run(v ? 1 : 0, id),
    setCoach: (id, v) => q.setCoach.run(v ? 1 : 0, id),
    setLastReminder: (id, date) => q.setReminder.run(date, id),

    /* creds */
    getCred: id => mapCred(q.getCred.get(id)),
    addCred: c => q.insCred.run(c.id, c.userId, c.publicKey, c.counter || 0, j(c.transports || [])),
    setCredCounter: (id, counter) => q.setCounter.run(counter, id),
    getCredsForUser: userId => q.getCredsForUser.all(userId).map(mapCred),
    deleteCred: id => q.delCred.run(id).changes > 0,

    /* per-user state blob */
    getState: uid => { const r = q.getState.get(uid); return r ? { state: JSON.parse(r.data), ts: r.ts } : null; },
    setState: (uid, obj, ts) => q.upState.run(uid, j(obj), ts || null),

    /* push subscriptions */
    subsForUser: userId => q.subsForUser.all(userId).map(mapSub),
    userHasPush: userId => !!q.userHasPush.get(userId),
    addSub: s => q.upSub.run(s.endpoint, s.userId, j(s.keys), s.created || new Date().toISOString()),
    deleteSub: endpoint => q.delSub.run(endpoint),
    deleteUserSub: (userId, endpoint) => q.delUserSub.run(userId, endpoint),

    /* admin invites (signup gating) */
    listInvites: () => q.listInvites.all().map(mapInvite),
    getInvite: code => mapInvite(q.getInvite.get(code)),
    validInvite: code => { const r = q.getInvite.get(code); return r && !r.used_by ? mapInvite(r) : null; },
    addInvite: i => q.insInvite.run(i.code, i.note || '', i.createdBy || null, i.created || new Date().toISOString()),
    useInvite: (code, userId, usedAt) => q.useInvite.run(userId, usedAt || new Date().toISOString(), code).changes > 0,
    revokeInvite: code => q.delInvite.run(code).changes > 0,

    /* coach invites (grant coach role at signup) */
    createCoachInvite: (code, createdBy) => q.insCoachInvite.run(code, createdBy, new Date().toISOString()),
    getCoachInvite: code => mapCoachInvite(q.getCoachInvite.get(code)),
    consumeCoachInvite: (code, userId) => q.useCoachInvite.run(userId, new Date().toISOString(), code).changes > 0,
    listCoachInvites: createdBy => q.listCoachInvites.all(createdBy).map(mapCoachInvite),

    /* passwords (for password-auth mode) */
    setPassword: (userId, hash) => q.setPassword.run(userId, hash),
    getPasswordHash: userId => { const r = q.getPasswordHash.get(userId); return r ? r.hash : null; },
    hasPassword: userId => !!q.getPasswordHash.get(userId),
    deletePassword: userId => q.delPassword.run(userId).changes > 0,

    /* questionnaires */
    getQuestionnaire: id => mapQuestionnaire(q.getQuestionnaire.get(id)),
    listCoachQuestionnaires: coachId => q.listCoachQuestionnaires.all(coachId).map(mapQuestionnaire),
    listAllQuestionnaires: () => q.listAllQuestionnaires.all().map(mapQuestionnaire),
    getDefaultQuestionnaire: () => mapQuestionnaire(q.getDefaultQuestionnaire.get()),
    createQuestionnaire: (id, coachId, title, description, fields, isDefault) => q.insQuestionnaire.run(id, coachId, title, description, j(fields), isDefault ? 1 : 0, new Date().toISOString(), new Date().toISOString()),
    updateQuestionnaire: (id, title, description, fields) => q.upQuestionnaire.run(title, description, j(fields), new Date().toISOString(), id),
    deleteQuestionnaire: id => q.delQuestionnaire.run(id),
    setDefaultQuestionnaire: id => { q.clearDefault.run(); q.setDefault.run(id); },
    clearDefaultQuestionnaire: () => q.clearDefault.run(),
    listCompletedResponses: userId => q.listCompletedResponses.all(userId).map(r => ({ id: r.id, questionnaireId: r.questionnaire_id, completedAt: r.completed_at, title: r.title, fields: JSON.parse(r.fields || '[]'), responses: JSON.parse(r.responses || '{}') })),

    /* questionnaire assignments */
    listUserAssignments: userId => q.listTraineeAssignments.all(userId).map(mapAssignment),
    getAssignment: id => mapAssignment(q.getAssignment.get(id)),
    assignQuestionnaire: (id, questionnaireId, assignedToUserId, assignedByCoachId, required) => q.insAssignment.run(id, questionnaireId, assignedToUserId, assignedByCoachId, required ? 1 : 0, new Date().toISOString()),
    completeAssignment: (id) => q.completeAssignment.run(new Date().toISOString(), id),

    /* questionnaire responses */
    submitResponse: (id, assignmentId, responses) => q.insResponse.run(id, assignmentId, j(responses), new Date().toISOString()),
    getResponse: assignmentId => mapResponse(q.getResponse.get(assignmentId)),

    /* plan templates (shared across all coaches) */
    listPlanTemplates: () => q.listPlanTemplates.all().map(mapTemplate),
    getPlanTemplate: id => mapTemplate(q.getPlanTemplate.get(id)),
    createPlanTemplate: (id, coachId, name, data) => q.insPlanTemplate.run(id, coachId, name, j(data), new Date().toISOString(), new Date().toISOString()),
    updatePlanTemplate: (id, name, data) => q.upPlanTemplate.run(name, j(data), new Date().toISOString(), id),
    deletePlanTemplate: id => q.delPlanTemplate.run(id),
  };

  return store;
}
