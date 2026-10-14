interface Connection {
  state: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  invoke: (method: string, id: number) => Promise<unknown>;
  onreconnecting: (callback: () => void) => void;
  onreconnected: (callback: () => Promise<void>) => void;
  onclose: (callback: () => void) => void;
}
interface RecoveryOptions {
  connection: Connection;
  competitionId: number;
  online: () => boolean;
  onStatus: (connected: boolean) => void;
  onReady: () => void;
  schedule: (callback: () => void, delay: number) => () => void;
}

/** Recover both the transport and competition membership after losing signal. */
export function recoverConnection({ connection, competitionId, online, onStatus, onReady, schedule }: RecoveryOptions) {
  let disposed = false;
  let starting = false;
  let failures = 0;
  let cancelRetry: (() => void) | undefined;
  function retry() {
    if (disposed || cancelRetry) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
    cancelRetry = schedule(() => { cancelRetry = undefined; void start(); }, delay);
  }
  async function join() {
    await connection.invoke('JoinCompetition', competitionId);
    if (disposed) return;
    failures = 0;
    onStatus(true);
    onReady();
  }
  async function start() {
    if (disposed || starting || connection.state !== 'Disconnected') return;
    if (!online()) { retry(); return; }
    starting = true;
    try {
      await connection.start();
      if (!disposed) await join();
    } catch {
      if (!disposed) {
        onStatus(false);
        await connection.stop().catch(() => { /* Retry still runs if transport cleanup fails. */ });
        retry();
      }
    } finally { starting = false; }
  }
  connection.onreconnecting(() => { if (!disposed) onStatus(false); });
  connection.onreconnected(async () => {
    if (disposed) return;
    try { await join(); } catch {
      if (!disposed) {
        onStatus(false);
        await connection.stop().catch(() => { /* The next attempt recreates membership. */ });
        retry();
      }
    }
  });
  connection.onclose(() => { if (!disposed) { onStatus(false); retry(); } });
  void start();
  return {
    reconnect() { cancelRetry?.(); cancelRetry = undefined; void start(); },
    dispose() {
      disposed = true;
      cancelRetry?.();
      void connection.stop().catch(() => { /* This connection is no longer used. */ });
    },
  };
}
