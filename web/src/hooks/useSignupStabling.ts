// Unused in web UI yet — reserved for iOS / upcoming wiring
import { useCallback, useState } from 'react';
import { api } from '../api';
import type { SectionSignup, StablingSummary, UpdateSignupStablingInput } from '../types';

export async function updateSignupStabling(
  competitionId: number,
  signupId: number,
  input: UpdateSignupStablingInput,
): Promise<SectionSignup> {
  const { data } = await api.put<SectionSignup>(
    `/competitions/${competitionId}/signups/${signupId}/stabling`,
    input,
  );
  return data;
}

export async function fetchCompetitionStabling(competitionId: number): Promise<StablingSummary> {
  const { data } = await api.get<StablingSummary>(`/competitions/${competitionId}/stabling`);
  return data;
}

export function useSignupStablingAllocator(competitionId: number) {
  const [savingSignupId, setSavingSignupId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveStabling = useCallback(
    async (signupId: number, input: UpdateSignupStablingInput): Promise<SectionSignup | null> => {
      setSavingSignupId(signupId);
      setError(null);
      try {
        return await updateSignupStabling(competitionId, signupId, input);
      } catch (err) {
        const msg =
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          'Could not save the stabling allocation. Please try again.';
        setError(msg);
        return null;
      } finally {
        setSavingSignupId(null);
      }
    },
    [competitionId],
  );

  return {
    savingSignupId,
    error,
    saveStabling,
  };
}
