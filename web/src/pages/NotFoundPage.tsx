import { Link, useNavigate } from 'react-router-dom';
import { usePageHeader } from '../components/CompactPageBarContext';
import { useT } from '../i18n/LanguageContext';
import '../components/sitePages.css';

export function NotFoundPage() {
  const t = useT();
  const navigate = useNavigate();
  usePageHeader({ title: t('shell.notFound.title'), plain: true });
  return (
    <div className="skin mx-auto w-full max-w-[560px]">
      <div className="sp-small">
        <h1>{t('shell.notFound.title')}</h1>
        <p>{t('shell.notFound.body')}</p>
        <div className="sp-acts">
          <Link to="/events" className="sp-pill sp-pill-fill">{t('shell.notFound.seeCompetitions')}</Link>
          <button type="button" className="sp-pill" onClick={() => navigate(-1)}>{t('common.goBack')}</button>
        </div>
      </div>
    </div>
  );
}
