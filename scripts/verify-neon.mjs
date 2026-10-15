import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

// This writes fake fixtures, so only run against the dedicated verification branch.
if (!process.env.NEON_ENV_FILE) throw new Error('Set NEON_ENV_FILE to a verification branch env file.');
loadEnvFile(process.env.NEON_ENV_FILE);
if (!process.env.NEON_BRANCH?.startsWith('setup-verification-')) {
  throw new Error('Refusing to test writes outside a setup-verification branch.');
}
const base = 'http://127.0.0.1:5051';
const adminKey = randomBytes(32).toString('hex');
const env = {
  ...process.env,
  Database__Provider: 'postgres', Database__SeedDemoData: 'false',
  Admin__Key: adminKey, ASPNETCORE_URLS: base, ASPNETCORE_ENVIRONMENT: 'Production',
  Logging__LogLevel__Default: 'Warning',
  Logging__LogLevel__Microsoft: 'Warning',
};
let server;
let serverOutput = '';
let token;
let competitionId;

async function start() {
  serverOutput = '';
  server = spawn('dotnet', ['bin/Debug/net10.0/MountedGames.Api.dll'], {
    cwd: resolve('api'), env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-12000); });
  }
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(`API exited with code ${server.exitCode}.`);
    try {
      if ((await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch { /* Wait for migrations checks and reference data. */ }
    await delay(500);
  }
  throw new Error('API did not start within 60 seconds.');
}

async function stop() {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
}

async function request(path, { method = 'GET', body, authenticated = false, status = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, status, `${method} ${path} returned ${response.status}`);
  return status === 204 ? undefined : response.json();
}

try {
  await start();
  console.log('PASS: API started against Neon PostgreSQL.');
  const credentials = await request('/api/auth/admin-key', { method: 'POST', body: { key: adminKey } });
  token = credentials.token;
  assert.ok(token);
  console.log('PASS: organiser sign-in uses PostgreSQL Identity roles.');

  const fakeCompetition = {
    name: 'TEST ONLY - Neon connection verification',
    icon: 'ie',
    startDate: '2030-06-01T09:00:00', endDate: '2030-06-01T17:00:00Z',
    latitude: 0, longitude: 0, description: 'Automatically removed after verification.',
  };
  await request('/api/competitions', {
    method: 'POST', body: { ...fakeCompetition, icon: 'invalid-icon' }, authenticated: true, status: 400,
  });
  const created = await request('/api/competitions', {
    method: 'POST', body: fakeCompetition, authenticated: true, status: 201,
  });
  competitionId = created.id;
  assert.ok(competitionId > 0);
  const session = await request(`/api/competitions/${competitionId}/sessions`, {
    method: 'POST', authenticated: true,
    body: { name: 'TEST ONLY - Timetable', scheduledStart: '2030-06-01T11:30:00+01:00', orderIndex: 1 },
  });
  assert.ok(session.id > 0);
  const detail = await request(`/api/competitions/${competitionId}`);
  assert.equal(detail.name, fakeCompetition.name);
  assert.equal(detail.icon, 'ie');
  assert.equal(Date.parse(detail.startDate), Date.parse('2030-06-01T09:00:00Z'));
  assert.equal(Date.parse(detail.sessions[0].scheduledStart), Date.parse('2030-06-01T10:30:00Z'));
  console.log('PASS: competition and timetable written, read back, and UTC dates preserved.');

  const picker = await request('/api/competitions/picker?pageSize=50');
  const card = picker.items.find(item => item.id === competitionId);
  assert.ok(card);
  assert.deepEqual(Object.keys(card).sort(), ['endDate', 'icon', 'id', 'name', 'startDate']);
  assert.equal(card.icon, 'ie');
  const past = await request('/api/competitions/picker?past=true');
  assert.ok(!past.items.some(item => item.id === competitionId));
  await request('/api/competitions/picker?pageSize=51', { status: 400 });
  console.log('PASS: picker returns only card fields, past events are separate, and invalid inputs return 400.');

  await stop();
  await start();
  const persisted = await request(`/api/competitions/${competitionId}`);
  assert.equal(persisted.sessions[0].id, session.id);
  assert.equal(persisted.name, fakeCompetition.name);
  console.log('PASS: competition and timetable survived an API restart.');

  await request(`/api/competitions/${competitionId}`, {
    method: 'PUT', authenticated: true,
    body: { ...fakeCompetition, name: 'TEST ONLY - Updated', icon: 'fr', isActive: true, isArchived: false },
  });
  assert.equal((await request(`/api/competitions/${competitionId}`)).name, 'TEST ONLY - Updated');
  assert.equal((await request(`/api/competitions/${competitionId}`)).icon, 'fr');
  console.log('PASS: competition update saved to Neon.');
} catch (error) {
  // Fixture-only branch. Avoid printing response bodies, tokens or connection URLs.
  console.error(error.message);
  const exception = serverOutput.match(/(?:Npgsql\.|System\.)[A-Za-z.]+Exception/g);
  if (exception) console.error('API exception types:', [...new Set(exception)].join(', '));
  process.exitCode = 1;
} finally {
  try {
    if (competitionId && server?.exitCode === null) {
      await request(`/api/competitions/${competitionId}`, { method: 'DELETE', authenticated: true, status: 204 });
      const missing = await fetch(`${base}/api/competitions/${competitionId}`);
      assert.equal(missing.status, 404);
      console.log('PASS: test competition and related timetable removed.');
    }
  } finally {
    await stop();
  }
}
