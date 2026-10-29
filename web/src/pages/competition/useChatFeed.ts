import { useCallback, useEffect, useRef, useState } from 'react';
import { updateChatMessage } from '../../lib/announcements';
import { api } from '../../api';
import { useLiveHub } from '../../live/useLiveHub';
import type { ChatMessage } from '../../types';

/** The competition's chat messages (as far as the signed-in person may see them), kept current by the live hub. */
export function useChatFeed(competitionId: number, failure: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const request = useCallback((signal: AbortController) => {
    void api.get<ChatMessage[]>(`/competitions/${competitionId}/chat`, { signal: signal.signal })
      .then((response) => { if (!signal.signal.aborted) setMessages(Array.isArray(response.data) ? response.data : []); })
      .catch(() => { if (!signal.signal.aborted) setError(failure); })
      .finally(() => { if (!signal.signal.aborted) setLoading(false); });
  }, [competitionId, failure]);

  const load = useCallback(() => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setLoading(true);
    setError(null);
    request(next);
  }, [request]);

  useEffect(() => {
    const next = new AbortController();
    controller.current = next;
    request(next);
    return () => { controller.current?.abort(); controller.current = null; };
  }, [request]);

  const add = useCallback((message: ChatMessage) =>
    setMessages((current) => updateChatMessage(current, message)), []);
  const remove = useCallback((id: number) => setMessages((current) => current.filter((item) => item.id !== id)), []);

  useLiveHub(competitionId, {
    onReady: load,
    onChatMessage: (value) => { const message = value as ChatMessage; if (message.competitionId === competitionId) add(message); },
    onAnnouncement: (value) => { const message = value as ChatMessage; if (message.competitionId === competitionId) add(message); },
    onChatMessageDeleted: ({ id }) => remove(id),
  });

  return { messages, loading, error, load, add, remove };
}
