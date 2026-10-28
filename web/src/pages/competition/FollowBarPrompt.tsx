import { useEffect, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { TAB_DEFS } from '../../components/bottomTabDefs';
import { useLanguage } from '../../i18n/LanguageContext';
import { FAVOURITES_CHANGED, readFavourites } from '../../lib/favourites';
import { addedFollows, followBarAsked, markFollowBarAsked, withFollowingTab } from '../../lib/followingCards';
import { getBottomTabs, setBottomTabs, type BottomTabId } from '../../lib/userPrefs';
import { useCompetition } from './context';
import './following.css';

interface Ask { title: string; tabs: BottomTabId[] }

/**
 * The first time someone follows a team on this device, and Following isn't on their bottom bar, a small sheet offers to
 * put it there. It listens for the follow rather than sitting beside one star, so every star in the competition counts.
 * Either answer is remembered on the device, so it asks once.
 */
export function FollowBarPrompt() {
  const { t } = useLanguage();
  const { competition } = useCompetition();
  const [ask, setAsk] = useState<Ask | null>(null);

  useEffect(() => {
    let known = readFavourites();
    const onChange = () => {
      const now = readFavourites();
      const added = addedFollows(known, now, competition.id);
      known = now;
      if (!added.length || followBarAsked() || getBottomTabs().includes('following')) return;
      const names = added.flatMap((id) => competition.teams.find((team) => team.id === id)?.displayName ?? []);
      if (!names.length) return;
      const title = names.length === 1
        ? t('teams.following.followPromptTitle', { team: names[0] })
        : t('teams.following.followPromptTitleMany', { count: names.length });
      setAsk({ title, tabs: withFollowingTab(getBottomTabs()) });
    };
    window.addEventListener(FAVOURITES_CHANGED, onChange);
    return () => window.removeEventListener(FAVOURITES_CHANGED, onChange);
  }, [competition.id, competition.teams, t]);

  if (!ask) return null;
  const decline = () => { markFollowBarAsked('declined'); setAsk(null); };
  return (
    <Sheet title={ask.title} description={t('teams.following.followPromptText')} onClose={decline}>
      {({ close }) => <>
        <div className="fc-bar" role="img" aria-label={t('teams.following.followPromptPreview')}>
          {ask.tabs.map((id) => {
            const def = TAB_DEFS[id];
            return <span key={id} className={`fc-bar-tab${id === 'following' ? ' is-on' : ''}`}>
              <def.icon aria-hidden="true" className={`h-[22px] w-[22px]${id === 'following' ? ' fill-current text-[#C08308]' : ''}`} />
              {t(def.label)}
            </span>;
          })}
        </div>
        <div className="fc-acts">
          <button type="button" className="kit-pill" onClick={() => close(decline)}>{t('teams.following.followPromptNotNow')}</button>
          <button type="button" className="kit-pill kit-pill-fill" onClick={() => close(() => { setBottomTabs(withFollowingTab(getBottomTabs())); markFollowBarAsked('added'); setAsk(null); })}>{t('teams.following.followPromptAdd')}</button>
        </div>
      </>}
    </Sheet>
  );
}
