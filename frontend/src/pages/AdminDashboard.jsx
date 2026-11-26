import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MotionConfig, motion } from 'motion/react';
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Sheet, buttonClasses } from '../components/ui';
import { SPRING } from '../components/ui/springs';
import { cn } from '../utils/cn';
import { GROUPS, OVERVIEW, allows, navFor, toolById } from './workspace/tools';
import { Overview } from './workspace/Overview';

const RAIL_KEY = 'sl.workspace.rail';
const readRail = () => { try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; } };
const saveRail = (value) => { try { localStorage.setItem(RAIL_KEY, value ? '1' : '0'); } catch { /* per-viewer convenience only */ } };

// Sidebar entries in their groups; the overview sits on top without a group.
function grouped(items) {
  return [{ group: null, items: items.filter((i) => !i.group) },
    ...GROUPS.map((group) => ({ group, items: items.filter((i) => i.group === group) }))].filter((g) => g.items.length);
}

// mode: 'full' (labels always, the phone sheet), 'rail' (icons only) or 'auto' (icons on tablets, labels from lg).
function NavList({ items, currentId, mode, highlight, onPick }) {
  const hide = { full: '', rail: 'sr-only', auto: 'max-lg:sr-only' }[mode];
  return grouped(items).map(({ group, items: list }) => (
    <div key={group ?? 'top'}>
      {group && mode !== 'full' && <span aria-hidden="true" className={cn('mx-auto my-2 block h-px w-6 bg-line', mode === 'auto' && 'lg:hidden')} />}
      {group && <p className={cn('eyebrow px-3 pb-1.5 pt-4', mode === 'rail' ? 'hidden' : mode === 'auto' && 'max-lg:hidden')}>{group}</p>}
      <ul className="space-y-1">
        {list.map(({ id, path, label, icon: Icon }) => {
          const active = id === currentId;
          return (
            <li key={id}>
              <Link
                to={path}
                onClick={onPick}
                aria-current={active ? 'page' : undefined}
                title={mode === 'full' ? undefined : label}
                className={cn('relative flex min-h-11 items-center gap-3 rounded-ctl px-3 text-sm font-bold transition-colors duration-200',
                  active ? 'text-bg' : 'text-mut hover:bg-ink/[0.06] hover:text-ink',
                  mode === 'rail' && 'justify-center', mode === 'auto' && 'max-lg:justify-center')}
              >
                {active && <motion.span layoutId={highlight} transition={SPRING} className="absolute inset-0 rounded-ctl bg-ink shadow-[0_8px_24px_-10px_rgb(0_0_0/0.7)]" />}
                <Icon size={18} aria-hidden="true" className="relative shrink-0" />
                <span className={cn('relative truncate', hide)}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  ));
}

// The staff workspace: a sidebar of the tools the grants open (an icon rail on tablets or when collapsed, a sheet on
// phones), and the chosen tool under its header. Each tool has its own address. Row level security and the API
// enforce the same rules; a tool left out of the sidebar is not the authorization.
export function AdminDashboard({ toolId = 'overview' }) { // eslint-disable-line react/prop-types
  const { user, roles } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [rail, setRail] = useState(readRail);
  const [sheet, setSheet] = useState(false);
  const items = navFor(roles);
  const current = toolId === 'overview' ? OVERVIEW : toolById(toolId);

  // A link to a form on the page (#add-fixture) scrolls to it once it has rendered.
  useEffect(() => {
    if (!location.hash) return undefined;
    const timer = setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    return () => clearTimeout(timer);
  }, [location.hash]);

  if (!current || !allows(current, roles)) return null;
  // One tool (an editor, a captain): nothing to navigate between, so no sidebar.
  const solo = items.length === 1;
  const toggleRail = () => setRail((value) => { saveRail(!value); return !value; });
  const Icon = current.icon;

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn(!solo && 'md:grid md:grid-cols-[auto_minmax(0,1fr)] md:gap-6 lg:gap-8')}>
        {!solo && <aside aria-label="Workspace" className={cn('glass sticky top-24 hidden max-h-[calc(100vh-7rem)] flex-col self-start overflow-y-auto rounded-card p-2 transition-[width] duration-200 md:flex',
          rail ? 'w-[60px]' : 'w-[60px] lg:w-60')}>
          <nav aria-label="Workspace tools" className="flex-1">
            <NavList items={items} currentId={current.id} mode={rail ? 'rail' : 'auto'} highlight="workspace-active" />
          </nav>
          <button type="button" onClick={toggleRail} aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={rail}
            className="mt-3 hidden min-h-11 items-center justify-center gap-2 rounded-ctl text-xs font-bold uppercase tracking-[0.16em] text-mut transition-colors hover:bg-ink/[0.06] hover:text-ink lg:flex">
            {rail ? <PanelLeftOpen size={18} aria-hidden="true" /> : <><PanelLeftClose size={18} aria-hidden="true" /><span>Collapse</span></>}
          </button>
        </aside>}

        <div className="min-w-0 space-y-8">
          {!solo && <button type="button" onClick={() => setSheet(true)} aria-haspopup="dialog"
            className="glass flex min-h-12 w-full items-center gap-3 rounded-pill px-4 text-left text-sm font-bold text-ink md:hidden">
            <Icon size={18} aria-hidden="true" />
            <span className="flex-1 truncate">{current.label}</span>
            <span className="eyebrow">Tools</span>
            <ChevronDown size={16} aria-hidden="true" className="text-mut" />
          </button>}
          <Sheet open={sheet} onClose={() => setSheet(false)} title="Workspace">
            <nav aria-label="Workspace tools" className="pb-2">
              <NavList items={items} currentId={current.id} mode="full" highlight="workspace-active-sheet" onPick={() => setSheet(false)} />
            </nav>
          </Sheet>

          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className="glass flex size-14 shrink-0 items-center justify-center rounded-[16px] text-ink sm:size-16"><Icon size={26} aria-hidden="true" /></span>
              <div className="min-w-0 space-y-2">
                <h1 className="font-display text-3xl text-ink sm:text-5xl">{current.label}</h1>
                <p className="text-sm text-mut">{current.purpose}</p>
              </div>
            </div>
            {current.action && <Link to={{ pathname: location.pathname, hash: current.action.to }} className={buttonClasses('primary', 'md')}>
              <Plus size={16} aria-hidden="true" />{current.action.label}
            </Link>}
          </header>

          <section aria-label={current.label}>
            {current.id === 'overview' ? <Overview /> : current.render({ user, navigate, location })}
          </section>
        </div>
      </div>
    </MotionConfig>
  );
}
