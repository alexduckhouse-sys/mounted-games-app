import { expect, it, vi } from 'vitest';
import { api } from '../api';
import { responseStatus, streamRequest } from './streamRuntime';
vi.mock('../api', () => ({ api: { request: vi.fn() } }));
it('forwards typed HTTP requests and extracts response data', async () => {
  vi.mocked(api.request).mockResolvedValue({ data: { enabled: true } });
  expect(await streamRequest('GET', '/streams')).toEqual({ enabled: true });
  await streamRequest('PATCH', '/streams/1', { caption: '' });
  expect(api.request).toHaveBeenLastCalledWith({ method: 'PATCH', url: '/streams/1', data: { caption: '' } });
  expect(responseStatus(null)).toBeUndefined(); expect(responseStatus({})).toBeUndefined(); expect(responseStatus({ response: { status: 409 } })).toBe(409);
});
