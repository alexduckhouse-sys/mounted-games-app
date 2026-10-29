import { useEffect } from 'react';
import { HttpClient, HttpResponse, HttpTransportType, HubConnectionBuilder, LogLevel, type HttpRequest } from '@microsoft/signalr';

/** Long polling allows an explicit credentials:omit on every request, including same-origin requests. */
export class PublicBroadcastHttp extends HttpClient {
  async send(request: HttpRequest): Promise<HttpResponse> {
    if (!request.url) throw new Error('Missing public hub address');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeout ?? 100_000);
    if (request.abortSignal?.aborted) controller.abort();
    if (request.abortSignal) request.abortSignal.onabort = () => controller.abort();
    try {
      const response = await fetch(request.url, { method: request.method ?? 'GET', body: request.content,
        headers: { ...request.headers, 'X-MG-Embed': '1' }, credentials: 'omit', cache: 'no-store', signal: controller.signal });
      return new HttpResponse(response.status, response.statusText,
        request.responseType === 'arraybuffer' ? await response.arrayBuffer() : await response.text());
    } finally { clearTimeout(timer); if (request.abortSignal) request.abortSignal.onabort = null; }
  }
}

export function useBroadcastLive(competitionId: number | null, refresh: () => void) {
  useEffect(() => {
    if (competitionId === null) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connection = new HubConnectionBuilder().withUrl(import.meta.env.VITE_LIVE_HUB_URL || '/hubs/live', {
      transport: HttpTransportType.LongPolling, withCredentials: false, httpClient: new PublicBroadcastHttp(),
    }).configureLogging(LogLevel.None).withAutomaticReconnect([2000, 5000, 15000]).build();
    const invalidate = () => { if (!stopped && !timer) timer = setTimeout(() => { timer = undefined; if (!stopped) refresh(); }, 300); };
    for (const event of ['sessionUpdated', 'resultsUpdated', 'overlayUpdated', 'scoreCardControl', 'prizeGiving', 'sponsorControl']) connection.on(event, invalidate);
    const join = async () => { await connection.invoke('JoinCompetition', competitionId); invalidate(); };
    connection.onreconnected(() => { void join().catch(invalidate); });
    // The bounded public snapshot poll is authoritative if live transport is unavailable.
    void connection.start().then(() => stopped ? connection.stop() : join()).catch(invalidate);
    return () => { stopped = true; if (timer) clearTimeout(timer); void connection.stop().catch(() => undefined); };
  }, [competitionId, refresh]);
}
