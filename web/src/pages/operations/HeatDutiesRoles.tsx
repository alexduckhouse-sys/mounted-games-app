import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useT } from '../../i18n/LanguageContext';
import { dutiesPerHeat, MAX_CUSTOM_ROLES, MAX_LINES, MAX_ROLE_COUNT, MAX_ROLE_NAME, type DutySession, type RoleSetup } from '../../lib/heatDuties';
import { RefineList, RefineQty, RefineSection, RefineSwitchRow } from '../refine/Refine';

/** Step 1: the roles every heat needs, set once for the whole event. */
export function HeatDutiesRoles({ setup, onChange, sessions }: { setup: RoleSetup; onChange: (next: RoleSetup) => void; sessions: readonly DutySession[] }) {
  const t = useT();
  const [adding, setAdding] = useState<string | null>(null);
  const heats = sessions.reduce((sum, item) => sum + item.heats.length, 0);
  const set = (patch: Partial<RoleSetup>) => onChange({ ...setup, ...patch });

  function addRole() {
    const name = (adding ?? '').trim();
    if (!name) return;
    set({ custom: [...setup.custom, { id: `c${Date.now().toString(36)}${setup.custom.length}`, name, count: 1 }] });
    setAdding(null);
  }

  const qtyRow = (label: string, hint: string | null, value: number, max: number, onValue: (next: number) => void) => (
    <div className="rf-row">
      <span className="rf-grow"><span className="rf-t1">{label}</span>{hint && <span className="rf-t2">{hint}</span>}</span>
      <RefineQty name={label} value={value} max={max} onChange={onValue} />
    </div>
  );

  return (
    <div className="hd-step">
      <p className="rf-note hd-intro">{t('duties.roles.intro')}</p>
      <section aria-label={t('duties.roles.heading')}>
        <RefineSection title={t('duties.roles.heading')} />
        <RefineList as="div">
          <RefineSwitchRow label={t('duties.role.referee')} on={setup.referee} onChange={(referee) => set({ referee })} />
          <RefineSwitchRow label={t('duties.role.starter')} on={setup.starter} onChange={(starter) => set({ starter })} />
          <RefineSwitchRow label={t('duties.role.scorer')} on={setup.scorer} onChange={(scorer) => set({ scorer })} />
          {qtyRow(t('duties.role.lines'), t('duties.lines.hint'), setup.lines, MAX_LINES, (lines) => set({ lines }))}
          {qtyRow(t('duties.role.changeovers'), null, setup.changeover, MAX_LINES, (changeover) => set({ changeover }))}
          {qtyRow(t('duties.role.ring'), null, setup.ring, MAX_ROLE_COUNT, (ring) => set({ ring }))}
          {setup.custom.map((role) => (
            <div key={role.id} className="rf-row">
              <span className="rf-grow rf-t1">{role.name}</span>
              <RefineQty name={role.name} value={role.count} max={MAX_ROLE_COUNT} onChange={(count) => set({ custom: setup.custom.map((item) => (item.id === role.id ? { ...item, count } : item)) })} />
              <button type="button" className="hd-x" aria-label={t('duties.removeRole', { name: role.name })} onClick={() => set({ custom: setup.custom.filter((item) => item.id !== role.id) })}><X className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          ))}
          {adding === null ? (
            setup.custom.length < MAX_CUSTOM_ROLES && <button type="button" className="rf-row hd-add" onClick={() => setAdding('')}><Plus className="h-4 w-4" aria-hidden="true" />{t('duties.addRole')}</button>
          ) : (
            <form className="rf-row hd-addform" onSubmit={(event) => { event.preventDefault(); addRole(); }}>
              <label className="rf-fld rf-grow">{t('duties.addRole.name')}<input value={adding} maxLength={MAX_ROLE_NAME} autoFocus onChange={(event) => setAdding(event.target.value)} /></label>
              <button type="submit" className="rf-btn rf-btn-primary" disabled={!adding.trim()}>{t('duties.addRole.add')}</button>
              <button type="button" className="rf-btn" onClick={() => setAdding(null)}>{t('common.cancel')}</button>
            </form>
          )}
        </RefineList>
      </section>

      <section aria-label={t('duties.arena.heading')}>
        <RefineSection title={t('duties.arena.heading')} />
        <RefineList as="div">
          <div className="rf-row">
            <span className="rf-grow"><span className="rf-t1">{t('duties.arena.teams')}</span><span className="rf-t2">{t('duties.arena.hint')}</span></span>
            <button type="button" role="switch" aria-checked={setup.teamsInHeat} aria-label={t('duties.arena.teams')} className="rf-sw" onClick={() => set({ teamsInHeat: !setup.teamsInHeat })}><span aria-hidden="true" /></button>
          </div>
        </RefineList>
      </section>

      <div className="hd-stats">
        <p className="hd-stat"><b>{dutiesPerHeat(setup)}</b><span>{t('duties.stat.perHeat', { count: dutiesPerHeat(setup) })}</span></p>
        <p className="hd-stat"><b>{heats}</b><span>{`${t('duties.stat.heats', { count: heats })} ${t('duties.stat.sessions', { count: sessions.length })}`}</span></p>
      </div>
    </div>
  );
}
