import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu as MenuIcon, X } from 'lucide-react';
import { useLeague } from '../../context/LeagueContext';
import { useDivisions } from '../../hooks/useDivisions';
import { cn } from '../../utils/cn';
import { AccountMenu } from './AccountMenu';
import { DivisionSwitcher } from './DivisionSwitcher';
import { LiveTicker } from './LiveTicker';
import { ThemeToggle } from './ThemeToggle';
import { TopNavbar } from '../TopNavbar';

// Every section of a division, in menu order. The World Cup page is reached from the home page only.
function sections(division) {
  return [
    { to: `/${division}`, label: 'Home', exact: true },
    { to: `/${division}/matches`, label: 'Matches' },
    { to: `/standings/${division}`, label: 'Table' },
    { to: `/${division}/teams`, label: 'Clubs' },
    { to: '/leaderboard', label: 'Player stats' },
    { to: '/fantasy', label: 'Predictions' },
    { to: `/${division}/news`, label: 'News' },
    { to: `/${division}/rules`, label: 'Rules' },
  ];
}

// The division's wordmark: its crest when it has one, and its name set in Inter Black Italic, stacked like the
// original "SUPER / LEAGUE" mark.
function Wordmark({ record }) {
  const name = record?.name ?? 'Super League';
  const [first, ...rest] = name.split(/\s+/);
  return (
    <span className="flex items-center gap-2.5">
      {record?.logo_url && <img src={record.logo_url} alt="" className="size-10 object-contain sm:size-12" />}
      <span className="flex flex-col text-lg font-black uppercase italic leading-[0.82] tracking-tighter text-ink sm:text-xl">
        <span>{first}</span>
        {rest.length > 0 && <span>{rest.join(' ')}</span>}
      </span>
    </span>
  );
}

// Full-screen menu: big type, one tap to any section. Escape or the close button shuts it; while closed it is inert.
function MenuOverlay({ open, onClose, division, divisions, loading, current, isActive }) {
  const firstLink = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstLink.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [open, onClose]);

  return (
    <div
      id="site-menu"
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      inert={open ? undefined : ''}
      className={cn('fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg/90 px-6 pb-8 pt-32 backdrop-blur-2xl transition-opacity duration-300 sm:px-10',
        open ? 'opacity-100' : 'pointer-events-none opacity-0')}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10">
        <DivisionSwitcher divisions={divisions} loading={loading} division={division} current={current} onPick={onClose} />
        <nav aria-label="Sections" className="flex-1">
          <ul className="grid gap-x-10 gap-y-1 sm:grid-cols-2">
            {sections(division).map(({ to, label, exact }, index) => {
              const active = isActive(to, exact);
              return (
                <li key={to} className={open ? 'motion-safe:animate-fade-up' : undefined} style={{ animationDelay: `${index * 35}ms` }}>
                  <Link
                    ref={index === 0 ? firstLink : undefined}
                    to={to}
                    onClick={onClose}
                    aria-current={active ? 'page' : undefined}
                    className={cn('group flex min-h-14 items-baseline gap-4 py-1 font-display text-4xl font-black uppercase tracking-tighter transition-colors sm:text-5xl',
                      active ? 'text-ink' : 'text-mut/60 hover:text-ink')}
                  >
                    <span className="eyebrow w-6 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                    <span className="transition-transform duration-300 group-hover:translate-x-1.5">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex items-center justify-between border-t border-line pt-5">
          <span className="eyebrow">Super League · IIIT Kottayam</span>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

// The app frame: a live ticker, a glass header with the division wordmark and switcher, and a full-screen menu.
// The division in view sets --div. The World Cup page (frozen) keeps its own legacy navigation.
export function AppShell({ children }) {
  const location = useLocation();
  const { division } = useLeague();
  const { divisions, loading } = useDivisions();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the menu whenever the page changes.
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  // The World Cup page is frozen: it keeps the navigation it always had, menu included.
  if (location.pathname === '/wc') {
    return (
      <div className="min-h-screen pt-24 pb-12 px-4 sm:px-6 mx-auto max-w-7xl">
        <TopNavbar />
        <main className="animate-in fade-in duration-500">{children}</main>
      </div>
    );
  }
  const current = divisions.find((item) => item.slug === division);
  const accent = current?.primary_color;
  const style = accent ? { '--div': accent } : undefined;
  const isActive = (to, exact) => location.pathname === to || (!exact && location.pathname.startsWith(`${to}/`));

  return (
    <div className="min-h-screen bg-bg" style={style}>
      <div className="sticky top-0 z-[55]">
        <LiveTicker divisions={divisions} />
        <header className="border-b border-line bg-bg/70 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:h-[72px] sm:gap-6 sm:px-6">
            <Link to={`/${division}`} aria-label={`${current?.name ?? 'Super League'} home`} className="shrink-0 rounded-ctl transition-opacity hover:opacity-80">
              <Wordmark record={current} />
            </Link>
            <div className="hidden min-w-0 md:block">
              <DivisionSwitcher divisions={divisions} loading={loading} division={division} current={current} compact />
            </div>
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <AccountMenu />
              <button
                type="button"
                onClick={() => setMenuOpen((value) => !value)}
                aria-expanded={menuOpen}
                aria-controls="site-menu"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                className="relative flex size-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-ink/10"
              >
                {menuOpen ? <X size={24} aria-hidden="true" /> : <MenuIcon size={24} aria-hidden="true" />}
              </button>
            </div>
          </div>
        </header>
      </div>

      <MenuOverlay
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        division={division}
        divisions={divisions}
        loading={loading}
        current={current}
        isActive={isActive}
      />

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 md:pt-8">{children}</main>
    </div>
  );
}
