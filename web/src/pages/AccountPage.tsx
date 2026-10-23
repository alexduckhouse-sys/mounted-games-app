import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { DeleteAccountPanel } from '../components/DeleteAccountPanel';

export function AccountPage() {
  const { user } = useAuth();
  if (!user) return null;
  const roles = user.roles.filter((role) => role !== 'TrainerRequest' && role !== 'ManagerRequest');
  return (
    <div className="skin mx-auto w-full max-w-[560px] space-y-4 py-4">
      <h1 className="mg-h1 mg-h1-sm">My account</h1>
      <dl className="mg-card mg-lede grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 p-4">
        <dt className="font-semibold text-[rgb(var(--mg-heading))]">Name</dt><dd>{user.fullName || 'Not set'}</dd>
        <dt className="font-semibold text-[rgb(var(--mg-heading))]">Sign-in</dt><dd className="break-all">{user.email}</dd>
        {user.clubName && <><dt className="font-semibold text-[rgb(var(--mg-heading))]">Club</dt><dd>{user.clubName}</dd></>}
        <dt className="font-semibold text-[rgb(var(--mg-heading))]">Role</dt><dd>{roles.join(', ') || 'Member'}</dd>
      </dl>
      <p className="mg-lede">
        See what we keep about you on the <Link to="/privacy" className="font-semibold text-[rgb(var(--mg-heading))] underline">privacy page</Link>.
      </p>
      <DeleteAccountPanel />
    </div>
  );
}
