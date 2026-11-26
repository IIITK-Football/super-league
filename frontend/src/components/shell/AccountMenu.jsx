import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Skeleton } from '../ui/Skeleton';
import { usePopover } from './usePopover';

// Workspaces for the roles this person holds. A scorer reaches the dictator dashboard, which shows only match tools,
// so a dictator never gets a second link for the same place.
const WORKSPACES = [
  { role: 'captain', to: '/team-builder', label: 'Team builder' },
  { role: 'editor', to: '/editor', label: 'News' },
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
    return (
      <Link to="/login" className="glass flex min-h-10 items-center gap-2 rounded-pill px-3 text-sm font-semibold text-ink transition-colors hover:bg-ink/10 sm:px-4">
        <User size={16} aria-hidden="true" />
        <span className="hidden sm:inline">Sign in</span>
        <span className="sr-only sm:hidden">Sign in</span>
      </Link>
    );
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
        className="glass flex size-11 items-center justify-center rounded-full text-ink hover:bg-ink/10"
      >
        <User size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="glass absolute right-0 top-full z-50 mt-2 w-64 rounded-card p-2">
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
