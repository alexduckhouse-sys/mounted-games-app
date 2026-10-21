import { api } from '../api';

export type StreamInvoke = <T = unknown>(method: string, ...args: unknown[]) => Promise<T>;
export interface StreamClock {
  now: () => number;
  schedule: (callback: () => void, ms: number) => () => void;
}
export const streamClock: StreamClock = {
  now: () => Date.now(),
  schedule: (callback, ms) => {
    const id = setTimeout(callback, ms);
    return () => clearTimeout(id);
  },
};
export const streamRequest = async <T>(method: 'GET' | 'POST' | 'PATCH', url: string, data?: unknown): Promise<T> =>
  (await api.request<T>({ method, url, data })).data;

/** The ProblemDetails title the API sent with an error response, if any. */
export function responseTitle(error: unknown): string | undefined {
  const title = (error as { response?: { data?: { title?: unknown } } } | null)?.response?.data?.title;
  return typeof title === 'string' ? title : undefined;
}

export function responseStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status;
}
