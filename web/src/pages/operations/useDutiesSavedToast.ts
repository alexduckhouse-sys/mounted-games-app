import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { useToast } from '../../components/Toast';
import { useT } from '../../i18n/LanguageContext';

/**
 * The heat duties wizard sends people back to the volunteers page after saving, with `dutiesSaved` in the router state.
 * Say so once, then clear the flag so a refresh doesn't repeat it.
 */
export function useDutiesSavedToast(toast: ReturnType<typeof useToast>) {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const saved = (location.state as { dutiesSaved?: boolean } | null)?.dutiesSaved === true;
  useEffect(() => {
    if (!saved) return;
    toast.show(t('duties.saved'));
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);
}
