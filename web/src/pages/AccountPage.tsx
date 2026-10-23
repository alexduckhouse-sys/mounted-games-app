import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { DeleteAccountPanel } from '../components/DeleteAccountPanel';

export function AccountPage() {
  const { user } = useAuth();
  if (!user) return null;
  const roles = user.roles.filter((role) => role !== 'TrainerRequest' && role !== 'ManagerRequest');
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-bold">My account</h1>
      <dl className="card grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-4 text-sm">
        <dt className="font-semibold">Name</dt><dd>{user.fullName || 'Not set'}</dd>
        <dt className="font-semibold">Sign-in</dt><dd className="break-all">{user.email}</dd>
        {user.clubName && <><dt className="font-semibold">Club</dt><dd>{user.clubName}</dd></>}
        <dt className="font-semibold">Role</dt><dd>{roles.join(', ') || 'Member'}</dd>
      </dl>
      <p className="text-sm">
        See what we keep about you on the <Link to="/privacy" className="underline">privacy page</Link>.
      </p>
      <DeleteAccountPanel />
    </div>
  );
}
