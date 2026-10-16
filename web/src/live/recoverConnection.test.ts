import { describe, expect, it } from 'vitest';
import { recoverConnection } from './recoverConnection';

type Options = Parameters<typeof recoverConnection>[0];
type Connection = Options['connection'];

/** Lets chained promise callbacks run without real time passing. */
const settle = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };

function fixture({ failStart = false, online = true } = {}) {
  const events: { reconnecting?: () => void; reconnected?: () => Promise<void>; close?: () => void } = {};
  const timers: { fn: () => void; delay: number; cancelled: boolean }[] = [];
  const calls: (string | [string, number])[] = [];
  const statuses: boolean[] = [];
  let ready = 0;
  let failNextStart = failStart;
  let isOnline = online;
  const connection: Connection = {
    state: 'Disconnected',
    async start() {
      calls.push('start');
      if (failNextStart) { failNextStart = false; throw new Error('No connection'); }
      this.state = 'Connected';
    },
    async stop() { calls.push('stop'); this.state = 'Disconnected'; events.close?.(); },
    async invoke(method, id) { calls.push([method, id]); },
    onreconnecting(fn) { events.reconnecting = fn; },
    onreconnected(fn) { events.reconnected = fn; },
    onclose(fn) { events.close = fn; },
  };
  const recovery = recoverConnection({
    connection,
    competitionId: 42,
    online: () => isOnline,
    onStatus: (s) => statuses.push(s),
    onReady: () => { ready++; },
    schedule(fn, delay) {
      const timer = { fn, delay, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
  });
  return {
    connection, events, timers, calls, statuses, recovery,
    ready: () => ready,
    goOnline: () => { isOnline = true; },
    joins: () => calls.filter(Array.isArray).length,
    starts: () => calls.filter((call) => call === 'start').length,
  };
}

describe('recoverConnection', () => {
  it('connects and joins the competition on start', async () => {
    const f = fixture();
    await settle();
    expect(f.calls).toEqual(['start', ['JoinCompetition', 42]]);
    expect(f.statuses).toEqual([true]);
    expect(f.ready()).toBe(1);
    f.recovery.dispose();
  });

  it('retries an initial connection failure after a second and then joins', async () => {
    const f = fixture({ failStart: true });
    await settle();
    expect(f.statuses.length).toBeGreaterThan(0);
    expect(f.statuses.every((connected) => !connected)).toBe(true);
    expect(f.timers.map((t) => t.delay)).toEqual([1000]);
    f.timers[0].fn();
    await settle();
    expect(f.calls.at(-1)).toEqual(['JoinCompetition', 42]);
    expect(f.statuses.at(-1)).toBe(true);
    f.recovery.dispose();
  });

  it('rejoins the competition and reloads state after the transport reconnects', async () => {
    const f = fixture();
    await settle();
    f.events.reconnecting!();
    expect(f.statuses.at(-1)).toBe(false);
    await f.events.reconnected!();
    expect(f.joins()).toBe(2);
    expect(f.ready()).toBe(2);
    expect(f.statuses.at(-1)).toBe(true);
    f.recovery.dispose();
  });

  it('waits while offline and resumes at once when told the signal is back', async () => {
    const f = fixture({ online: false });
    expect(f.calls).toEqual([]);
    f.goOnline();
    f.recovery.reconnect();
    await settle();
    expect(f.timers[0].cancelled).toBe(true);
    expect(f.ready()).toBe(1);
    f.recovery.dispose();
  });

  it('stops retrying and ignores later callbacks once disposed', async () => {
    const f = fixture({ failStart: true });
    await settle();
    f.recovery.dispose();
    expect(f.timers[0].cancelled).toBe(true);
    await f.events.reconnected!();
    f.timers[0].fn();
    await settle();
    expect(f.ready()).toBe(0);
    expect(f.starts()).toBe(1);
  });

  it('retries when restoring membership fails', async () => {
    const f = fixture();
    await settle();
    const invoke = f.connection.invoke;
    f.connection.invoke = async () => { throw new Error('Join failed'); };
    await f.events.reconnected!();
    expect(f.statuses.at(-1)).toBe(false);
    expect(f.timers).toHaveLength(1);
    f.connection.invoke = invoke;
    f.timers[0].fn();
    await settle();
    expect(f.statuses.at(-1)).toBe(true);
    expect(f.ready()).toBe(2);
    f.recovery.dispose();
  });

  it('starts a fresh connection after automatic reconnection gives up', async () => {
    const f = fixture();
    await settle();
    f.connection.state = 'Disconnected';
    f.events.close!();
    f.timers[0].fn();
    await settle();
    expect(f.starts()).toBe(2);
    expect(f.ready()).toBe(2);
    f.recovery.dispose();
  });

  it('backs off up to 30 seconds while offline and starts again from one second after success', async () => {
    const f = fixture({ online: false });
    for (let index = 0; index < 7; index++) { f.timers[index].fn(); await settle(); }
    expect(f.timers.map((t) => t.delay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    f.goOnline();
    f.recovery.reconnect();
    await settle();
    f.connection.state = 'Disconnected';
    f.events.close!();
    expect(f.timers.at(-1)!.delay).toBe(1000);
    f.recovery.dispose();
  });

  it('does not start concurrent transports when told online several times', async () => {
    const f = fixture();
    f.recovery.reconnect();
    f.recovery.reconnect();
    await settle();
    f.recovery.reconnect();
    expect(f.starts()).toBe(1);
    expect(f.ready()).toBe(1);
    f.recovery.dispose();
  });

  it('does not schedule a second retry while one is already waiting', async () => {
    const f = fixture({ online: false });
    f.events.close!();
    f.events.close!();
    expect(f.timers).toHaveLength(1);
    f.recovery.dispose();
  });

  it('does not join the old competition when disposed during the first connection', async () => {
    const f = fixture();
    f.recovery.dispose();
    f.events.reconnecting!();
    await settle();
    expect(f.joins()).toBe(0);
    expect(f.ready()).toBe(0);
    expect(f.statuses).toEqual([]);
  });

  it('does not join when disposed while the transport was still starting', async () => {
    const f = fixture();
    // start() has begun but has not yet resolved.
    f.recovery.dispose();
    await settle();
    expect(f.joins()).toBe(0);
  });

  it('suppresses stale status updates when disposed during membership restoration', async () => {
    const f = fixture();
    await settle();
    let finishJoin!: () => void;
    f.connection.invoke = () => new Promise<void>((resolve) => { finishJoin = resolve; });
    const rejoined = f.events.reconnected!();
    f.recovery.dispose();
    finishJoin();
    await rejoined;
    expect(f.ready()).toBe(1);
  });

  it('still schedules recovery when stopping the failed transport also fails', async () => {
    const f = fixture({ failStart: true });
    f.connection.stop = async () => { throw new Error('Example stop failure'); };
    await settle();
    expect(f.timers).toHaveLength(1);
    f.recovery.dispose();
    await settle();
  });

  it('still schedules recovery when a failed rejoin cannot clean up the transport', async () => {
    const f = fixture();
    await settle();
    f.connection.invoke = async () => { throw new Error('Example membership failure'); };
    f.connection.stop = async () => { throw new Error('Example stop failure'); };
    await f.events.reconnected!();
    expect(f.statuses.at(-1)).toBe(false);
    expect(f.timers).toHaveLength(1);
    f.recovery.dispose();
    await settle();
  });

  it('does not schedule another connection when disposed before a failed rejoin completes', async () => {
    const f = fixture();
    await settle();
    let rejectJoin!: (error: Error) => void;
    f.connection.invoke = () => new Promise<void>((_resolve, reject) => { rejectJoin = reject; });
    const rejoined = f.events.reconnected!();
    f.recovery.dispose();
    rejectJoin(new Error('Example membership failure'));
    await rejoined;
    expect(f.timers).toHaveLength(0);
  });

  it('does not report failure when disposed while the first connection attempt fails', async () => {
    const f = fixture({ failStart: true });
    f.recovery.dispose();
    await settle();
    expect(f.statuses).toEqual([]);
    expect(f.timers).toHaveLength(0);
  });
});
