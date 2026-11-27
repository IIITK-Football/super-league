import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { Menu as MenuIcon, X } from 'lucide-react';
import { useLeague } from '../../context/LeagueContext';
import { useDivisions } from '../../hooks/useDivisions';
import { cn } from '../../utils/cn';
import { AccountMenu } from './AccountMenu';
import { DivisionSwitcher } from './DivisionSwitcher';
import { LiveTicker } from './LiveTicker';
import { StaggeredMenu } from './StaggeredMenu';
import { ThemeToggle } from './ThemeToggle';
import { TopNavbar } from '../TopNavbar';

const EASE = [0.2, 0.7, 0.2, 1];
const SPRING = { type: 'spring', bounce: 0.18, duration: 0.35 };

// Every section of a division, in menu order. primary sections also sit in the header bar under their short name.
// The World Cup page is reached from the home page only.
function sections(division, configured) {
  return [
    { key: 'overview', to: `/${division}`, label: 'Home', exact: true, primary: true },
    { key: 'fixtures', to: `/${division}/matches`, label: 'Matches', primary: true },
    { key: 'standings', to: `/standings/${division}`, label: 'Table', primary: true },
    { key: 'teams', to: `/${division}/teams`, label: 'Clubs' },
    { key: 'stats', to: '/leaderboard', label: 'Player stats', short: 'Stats', primary: true },
    { key: 'fantasy', to: '/fantasy', label: 'Predictions' },
    { key: 'news', to: `/${division}/news`, label: 'News', primary: true },
    { key: 'rules', to: `/${division}/rules`, label: 'Rules' },
  ].map((item) => ({ ...item, setting: configured.find((section) => section.key === item.key) }))
    .filter((item) => item.setting?.enabled && item.setting.navVisible)
    .sort((a, b) => a.setting.order - b.setting.order)
    .map((item) => ({ ...item, label: item.setting.label || item.label, short: item.setting.label && item.setting.label !== item.label ? undefined : item.short }));
}

// True at the width where the header carries the section pill, so the menu can carry just the rest. Without media
// queries (tests, very old browsers) the menu lists every section, so nothing is unreachable.
const WIDE_HEADER = '(min-width: 1024px)';
function useWideHeader() {
  const [wide, setWide] = useState(() => window.matchMedia?.(WIDE_HEADER).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(WIDE_HEADER);
    if (!query) return undefined;
    const update = () => setWide(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

// The site wordmark, stacked like the original "SUPER / LEAGUE" mark, in a box of one fixed size. The division in
// view shows beside it as a small label that truncates, so the bar never changes width between divisions or while
// they load.
function Wordmark({ label }) {
  return (
    <span className="flex w-44 items-center gap-3 sm:w-52">
      <span className="flex shrink-0 flex-col text-lg font-black uppercase italic leading-[0.82] tracking-tighter text-ink sm:text-xl">
        <span>Super</span>
        <span>League</span>
      </span>
      <span aria-hidden="true" className="h-7 w-px shrink-0 bg-line" />
      <span className="eyebrow min-w-0 truncate">{label || ' '}</span>
    </span>
  );
}

// The main sections as one floating glass pill. The lit section has a white pill that slides between links.
function PillNav({ items, isActive, reduced }) {
  return (
    <nav aria-label="Main" className="glass hidden rounded-pill p-1 lg:block">
      <ul className="flex items-center">
        {items.filter((s) => s.primary).map(({ to, label, short, exact }) => {
          const active = isActive(to, exact);
          return (
            <li key={label}>
              <Link
                to={to}
                aria-current={active ? 'page' : undefined}
                className={cn('relative flex min-h-10 items-center rounded-pill px-4 text-xs font-bold uppercase tracking-[0.16em] transition-colors duration-300 lg:px-5',
                  active ? 'text-bg' : 'text-mut hover:text-ink')}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    transition={reduced ? { duration: 0 } : SPRING}
                    className="absolute inset-0 rounded-pill bg-ink shadow-[0_6px_20px_-8px_rgb(0_0_0/0.6)]"
                  />
                )}
                <span className="relative">{short ?? label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// The app frame, mounted once for every page: a live ticker, a glass bar with the wordmark, the main sections in a
// floating pill and the account and menu buttons, and the staggered menu. The division in view sets --div. The World
// Cup page (frozen) keeps its own legacy navigation.
const WORKSPACES = new Set(['dictator', 'editor', 'team-builder']);

export function AppShell({ children }) {
  const location = useLocation();
  const { division, seasonScope } = useLeague();
  const { divisions, loading } = useDivisions({ publicOnly: true });
  const reduced = useReducedMotion();
  const wide = useWideHeader();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuButtonRef = useRef(null);

  // Close the menu whenever the page changes.
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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

  // The pill already lists the main sections, so the menu carries those only where the pill is not shown.
  const allSections = sections(division, seasonScope.sections);
  const menuItems = (wide ? allSections.filter((s) => !s.primary) : allSections)
    .map(({ to, label, exact }) => ({ to, label, active: isActive(to, exact) }));

  return (
    <div className="min-h-screen bg-bg" style={style}>
      <div className="sticky top-0 z-[55]">
        <LiveTicker divisions={divisions} />
        <header className={cn('border-b transition-[background-color,border-color,backdrop-filter] duration-300',
          scrolled ? 'border-line/80 bg-bg/65 backdrop-blur-2xl backdrop-saturate-150' : 'border-transparent bg-bg/30 backdrop-blur-md')}>
          <div className="mx-auto grid h-16 max-w-7xl grid-cols-[1fr_auto] items-center gap-3 px-4 sm:h-[72px] sm:px-6 lg:grid-cols-[1fr_auto_1fr]">
            <Link to={`/${division}`} aria-label={`${current?.name ?? 'Super League'} home`} className="justify-self-start rounded-ctl transition-opacity hover:opacity-80">
              <Wordmark label={current?.short_name || current?.name} />
            </Link>
            <PillNav items={allSections} isActive={isActive} reduced={reduced} />
            <div className="flex items-center justify-self-end gap-2 sm:gap-3">
              <AccountMenu />
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => setMenuOpen((value) => !value)}
                aria-expanded={menuOpen}
                aria-controls="site-menu"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                className="glass relative flex size-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-ink/10"
              >
                {menuOpen ? <X size={20} aria-hidden="true" /> : <MenuIcon size={20} aria-hidden="true" />}
              </button>
            </div>
          </div>
        </header>
      </div>

      <StaggeredMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        toggleRef={menuButtonRef}
        items={menuItems}
        colors={[accent || 'var(--color-raise)', 'var(--color-ink)']}
        accentColor={accent}
      >
        <div className="sm-panel-extra flex flex-1 flex-col justify-between gap-8">
          <DivisionSwitcher divisions={divisions} loading={loading} division={division} current={current} onPick={() => setMenuOpen(false)} />
          <div className="flex items-center justify-between border-t border-line pt-4">
            <span className="eyebrow">Super League · IIIT Kottayam</span>
            <ThemeToggle />
          </div>
        </div>
      </StaggeredMenu>

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 md:pt-8">
        {/* Keyed on the page: it rises in, the shell around it stays put. No exit, so nothing waits. The staff
            workspace keeps one key so switching tools does not remount its sidebar. */}
        <motion.div
          key={WORKSPACES.has(location.pathname.split('/')[1]) ? location.pathname.split('/')[1] : location.pathname}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: EASE }}
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
