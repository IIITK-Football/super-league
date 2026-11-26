import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Skeleton } from '../ui/Skeleton';
import { buttonClasses } from '../ui/buttonClasses';
import { usePopover } from './usePopover';

// Workspaces for the roles this person holds. A scorer reaches the dictator dashboard, which shows only match tools,
// so a dictator never gets a second link for the same place.
const WORKSPACES = [
  { role: 'captain', to: '/team-builder', label: 'Team builder' },
  { role: 'editor', to: '/editor', label: 'Newsletter' },
  { role: 'dictator', to: '/dictator', label: 'Dictator dashboard' },
  { role: 'scorer', to: '/dictator', label: 'Match scoring', unlessRole: 'dictator' },
];

export function AccountMenu() {
  const { user, profile, hasRole, loading, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = usePopover(open, () => setOpen(false));

  // Until the session is known, show a placeholder of the same size. Never "Sign in" for a signed-in person.
  if (loading) return <span aria-busy="true"><Skeleton className="size-11 rounded-full" /></span>;

  if (!user) {
    return <Link to="/login" className={buttonClasses('secondary', 'sm')}>Sign in</Link>;
  }

  const links = WORKSPACES.filter((w) => hasRole(w.role) && !(w.unlessRole && hasRole(w.unlessRole)));
  const name = profile?.nickname || 'Account';

  const close = () => setOpen(false);
  const signOutNow = async () => {
    close();
    await signOut();
    navigate('/');
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Account menu, ${name}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex size-11 items-center justify-center rounded-full border border-line bg-surf text-ink hover:bg-raise"
      >
        <User size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 rounded-card border border-line bg-surf p-2">
          <p className="truncate px-3 py-2 text-sm text-mut">{name}</p>
          <ul className="flex flex-col">
            <li><Link to="/profile" onClick={close} className="flex min-h-11 items-center rounded-ctl px-3 text-ink hover:bg-raise">Your profile</Link></li>
            {links.map((w) => (
              <li key={w.label}><Link to={w.to} onClick={close} className="flex min-h-11 items-center rounded-ctl px-3 text-ink hover:bg-raise">{w.label}</Link></li>
            ))}
          </ul>
          <button type="button" onClick={signOutNow} className="mt-1 flex min-h-11 w-full items-center rounded-ctl px-3 text-left text-mut hover:bg-raise hover:text-ink">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
