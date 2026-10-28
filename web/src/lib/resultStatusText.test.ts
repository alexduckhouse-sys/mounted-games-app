import { describe, expect, it } from 'vitest';
import { translate } from '../i18n/translate';
import { RESULT_STATUS } from './resultStatus';
import { resultStatusLabel } from './resultStatusText';

const en = (key: Parameters<typeof translate>[1]) => translate('en', key);
const fr = (key: Parameters<typeof translate>[1]) => translate('fr', key);

describe('resultStatusLabel', () => {
  it('gives nothing for a team that finished', () => {
    expect(resultStatusLabel(en, false, RESULT_STATUS.Retired)).toBeNull();
  });

  it('keeps the English wording', () => {
    expect(resultStatusLabel(en, true, RESULT_STATUS.Eliminated)).toBe('Eliminated');
    expect(resultStatusLabel(en, true, RESULT_STATUS.DidNotStart)).toBe('Did not start');
    expect(resultStatusLabel(en, true, RESULT_STATUS.DidNotFinish)).toBe('Did not finish');
    expect(resultStatusLabel(en, true, RESULT_STATUS.Retired)).toBe('Retired');
  });

  it('treats an old result with no status as an elimination, in any language', () => {
    expect(resultStatusLabel(en, true, null)).toBe('Eliminated');
    expect(resultStatusLabel(fr, true)).toBe('Éliminé(e)');
  });
});
