import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverConnection } from '../src/live/recoverConnection.ts';

const settle = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function fixture({ failStart = false, online = true } = {}) {
  const events = {};
  const timers = [];
  const calls = [];
  const statuses = [];
  let ready = 0;
  const connection = {
    state: 'Disconnected',
    async start() { calls.push('start'); if (failStart) { failStart = false; throw new Error('No connection'); } this.state = 'Connected'; },
    async stop() { calls.push('stop'); this.state = 'Disconnected'; events.close?.(); },
    async invoke(method, id) { calls.push([method, id]); },
    onreconnecting(fn) { events.reconnecting = fn; },
    onreconnected(fn) { events.reconnected = fn; },
    onclose(fn) { events.close = fn; },
  };
  const recovery = recoverConnection({ connection, competitionId: 42, online: () => online, onStatus: (s) => statuses.push(s), onReady: () => ready++, schedule(fn, delay) { const timer = { fn, delay, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; } });
  return { connection, events, timers, calls, statuses, recovery, ready: () => ready, goOnline: () => { online = true; } };
}

test('retries an initial connection failure and joins the selected competition', async () => {
  const f = fixture({ failStart: true });
  await settle();
  assert.equal(f.timers.length, 1);
  assert.equal(f.timers[0].delay, 1000);
  f.timers[0].fn();
  await settle();
  assert.deepEqual(f.calls.at(-1), ['JoinCompetition', 42]);
  assert.equal(f.statuses.at(-1), true);
  f.recovery.dispose();
});

test('rejoins the competition and reloads state after a transport reconnect', async () => {
  const f = fixture();
  await settle();
  f.events.reconnecting();
  assert.equal(f.statuses.at(-1), false);
  await f.events.reconnected();
  assert.equal(f.calls.filter((x) => Array.isArray(x)).length, 2);
  assert.equal(f.ready(), 2);
  f.recovery.dispose();
});

test('waits offline and resumes immediately when the online event arrives', async () => {
  const f = fixture({ online: false });
  assert.equal(f.calls.length, 0);
  f.goOnline();
  f.recovery.reconnect();
  await settle();
  assert.equal(f.timers[0].cancelled, true);
  assert.equal(f.ready(), 1);
  f.recovery.dispose();
});

test('unmounting cancels retries and ignores later reconnect callbacks', async () => {
  const f = fixture({ failStart: true });
  await settle();
  f.recovery.dispose();
  assert.equal(f.timers[0].cancelled, true);
  await f.events.reconnected();
  f.timers[0].fn();
  await settle();
  assert.equal(f.ready(), 0);
  assert.equal(f.calls.filter((x) => x === 'start').length, 1);
});

test('retries if restoring competition membership fails', async () => {
  const f = fixture();
  await settle();
  const invoke = f.connection.invoke;
  f.connection.invoke = async () => { throw new Error('Join failed'); };
  await f.events.reconnected();
  assert.equal(f.statuses.at(-1), false);
  assert.equal(f.timers.length, 1);
  f.connection.invoke = invoke;
  f.timers[0].fn();
  await settle();
  assert.equal(f.statuses.at(-1), true);
  assert.equal(f.ready(), 2);
  f.recovery.dispose();
});

test('starts a fresh connection after automatic reconnect gives up', async () => {
  const f = fixture();
  await settle();
  f.connection.state = 'Disconnected';
  f.events.close();
  f.timers[0].fn();
  await settle();
  assert.equal(f.calls.filter((x) => x === 'start').length, 2);
  assert.equal(f.ready(), 2);
  f.recovery.dispose();
});

test('caps offline retry backoff and resets it after a successful connection', async () => {
  const f = fixture({ online: false });
  for (let index = 0; index < 7; index++) { f.timers[index].fn(); await settle(); }
  assert.deepEqual(f.timers.map((timer) => timer.delay), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  f.goOnline();
  f.recovery.reconnect();
  await settle();
  f.connection.state = 'Disconnected';
  f.events.close();
  assert.equal(f.timers.at(-1).delay, 1000);
  f.recovery.dispose();
});

test('multiple online notifications do not start concurrent transports', async () => {
  const f = fixture();
  f.recovery.reconnect();
  f.recovery.reconnect();
  await settle();
  f.recovery.reconnect();
  assert.equal(f.calls.filter((call) => call === 'start').length, 1);
  assert.equal(f.ready(), 1);
  f.recovery.dispose();
});

test('disposing during the initial connection prevents joining the old competition', async () => {
  const f = fixture();
  f.recovery.dispose();
  f.events.reconnecting();
  await settle();
  assert.equal(f.calls.filter(Array.isArray).length, 0);
  assert.equal(f.ready(), 0);
  assert.deepEqual(f.statuses, []);
});

test('disposing during membership restoration suppresses stale status updates', async () => {
  const f = fixture();
  await settle();
  let finishJoin;
  f.connection.invoke = () => new Promise((resolve) => { finishJoin = resolve; });
  const rejoined = f.events.reconnected();
  f.recovery.dispose();
  finishJoin();
  await rejoined;
  assert.equal(f.ready(), 1);
});

test('initial failure still schedules recovery when stopping the failed transport rejects', async () => {
  const f = fixture({ failStart: true });
  f.connection.stop = async () => { throw new Error('Example stop failure'); };
  await settle();
  assert.equal(f.timers.length, 1);
  f.recovery.dispose();
  await settle();
});

test('failed rejoin still schedules recovery when transport cleanup rejects', async () => {
  const f = fixture();
  await settle();
  f.connection.invoke = async () => { throw new Error('Example membership failure'); };
  f.connection.stop = async () => { throw new Error('Example stop failure'); };
  await f.events.reconnected();
  assert.equal(f.statuses.at(-1), false);
  assert.equal(f.timers.length, 1);
  f.recovery.dispose();
  await settle();
});

test('disposing before a rejected rejoin completes does not schedule another connection', async () => {
  const f = fixture();
  await settle();
  let rejectJoin;
  f.connection.invoke = () => new Promise((resolve, reject) => { rejectJoin = reject; });
  const rejoined = f.events.reconnected();
  f.recovery.dispose();
  rejectJoin(new Error('Example membership failure'));
  await rejoined;
  assert.equal(f.timers.length, 0);
});
