import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Notice } from './Notice';
import { useT } from '../i18n/LanguageContext';

export function TrainerAccountNotice() {
  const t = useT();
  const { trainerNotice, logout } = useAuth();
  const navigate = useNavigate();
  if (!trainerNotice) return null;

  return (
    <div className="mb-3 mt-4">
      {trainerNotice === 'requested' ? (
        <Notice tone="info">{t('shell.trainerNotice.requested')}</Notice>
      ) : (
        <Notice tone="info" actionLabel={t('shell.trainerNotice.signInAgain')} onAction={() => { logout(); navigate('/login', { replace: true }); }}>
          {t('shell.trainerNotice.approved')}
        </Notice>
      )}
    </div>
  );
}
