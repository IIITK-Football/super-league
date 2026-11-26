import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CalendarDays, Ellipsis, Newspaper, Table2 } from 'lucide-react';
import { useLeague } from '../../context/LeagueContext';
import { useDivisions } from '../../hooks/useDivisions';
import { Sheet } from '../ui/Sheet';
import { AccountMenu } from './AccountMenu';
import { DivisionSwitcher } from './DivisionSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { TopNavbar } from '../TopNavbar';

// The Super League mark, tinted with the ink colour through a CSS mask.
function Mark() {
  const mask = { maskImage: 'url(/slklogo3.png)', WebkitMaskImage: 'url(/slklogo3.png)', maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center' };
  return <span aria-hidden="true" className="block size-10 bg-ink sm:size-11" style={mask} />;
}

// Links shown in the primary bar. More holds the rest and opens a sheet.
function primaryLinks(division) {
  return [
    { to: '/matches', label: 'Matches', icon: CalendarDays },
    { to: `/standings/${division}`, label: 'Table', icon: Table2 },
    { to: '/vault', label: 'News', icon: Newspaper },
  ];
}

const MORE_LINKS = [
  { to: '/teams', label: 'Clubs' },
  { to: '/leaderboard', label: 'Player stats' },
  { to: '/rules', label: 'Rules' },
];

// The app frame: a top bar (laptop and tablet) and bottom tabs (phone) around the page. The division in view sets
// --div, the accent every page may use. The World Cup page (frozen) keeps its own legacy navigation.
export function AppShell({ children }) {
  const location = useLocation();
  const { division } = useLeague();
  const { divisions, loading } = useDivisions();
  const [moreOpen, setMoreOpen] = useState(false);

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
  const home = `/${division}`;
  const links = primaryLinks(division);
  const isActive = (to) => location.pathname === to || location.pathname.startsWith(`${to}/`);

  const bar = (
    <header className="sticky top-0 z-40 border-b border-line bg-bg">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:h-16 sm:gap-4 sm:px-6">
        <Link to={home} aria-label="Super League home" className="flex shrink-0 items-center rounded-ctl">
          <Mark />
        </Link>
        <DivisionSwitcher divisions={divisions} loading={loading} division={division} current={current} />
        <nav aria-label="Main" className="ml-2 hidden items-center gap-1 md:flex">
          {links.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              aria-current={isActive(to) ? 'page' : undefined}
              className={`flex min-h-11 items-center rounded-ctl px-3 text-sm font-semibold ${isActive(to) ? 'text-ink' : 'text-mut hover:text-ink'}`}
            >
              {label}
            </Link>
          ))}
          <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" className="flex min-h-11 items-center rounded-ctl px-3 text-sm font-semibold text-mut hover:text-ink">
            More
          </button>
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </header>
  );

  return (
    <div className="min-h-screen bg-bg" style={style}>
      {bar}
      <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6 md:pb-12 md:pt-8">{children}</main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surf pb-[env(safe-area-inset-bottom)] md:hidden">
          <ul className="mx-auto grid max-w-md grid-cols-4">
            {links.map(({ to, label, icon: Icon }) => {
              const active = isActive(to);
              return (
                <li key={to}>
                  <Link
                    to={to}
                    aria-current={active ? 'page' : undefined}
                    className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${active ? 'text-ink' : 'text-mut'}`}
                  >
                    {active && <span aria-hidden="true" className="absolute inset-x-6 top-0 h-0.5 rounded-full" style={{ backgroundColor: 'var(--div)' }} />}
                    <Icon size={20} aria-hidden="true" />
                    {label}
                  </Link>
                </li>
              );
            })}
            <li>
              <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-xs font-semibold text-mut">
                <Ellipsis size={20} aria-hidden="true" />
                More
              </button>
            </li>
          </ul>
        </nav>

      <Sheet open={moreOpen} title="More" onClose={() => setMoreOpen(false)}>
        <ul className="flex flex-col">
          {MORE_LINKS.map(({ to, label }) => (
            <li key={to}>
              <Link to={to} onClick={() => setMoreOpen(false)} className="flex min-h-12 items-center rounded-ctl px-3 text-lg font-semibold text-ink hover:bg-raise">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}
