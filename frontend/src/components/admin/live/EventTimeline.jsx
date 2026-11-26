import { Goal, Pencil, Trash2 } from 'lucide-react';
import { Button, EmptyState, Notice, Skeleton } from '../../ui';
import { cn } from '../../../utils/cn';
import { recordedMinute } from './clock';

export const KIND_LABEL = { goal: 'Goal', own_goal: 'Own goal', yellow: 'Yellow card', red: 'Red card' };

// The icon of an event kind: the goal mark, or a card in its colour (yellow is the ink card, as on the match page).
export function KindIcon({ kind, size = 18 }) {
  if (kind === 'yellow' || kind === 'red') {
    return <span aria-hidden="true" className={cn('inline-block h-[1.15em] w-[0.8em] rotate-6 rounded-[3px]', kind === 'red' ? 'bg-live' : 'bg-ink/80')} style={{ fontSize: size }} />;
  }
  return <Goal size={size} aria-hidden="true" className={kind === 'own_goal' ? 'text-live' : undefined} />;
}

// A broadcast timeline: home events read from the left, away events from the right. An own goal sits with the side
// it counted for.
export function EventTimeline({ events, state, match, playerName, busyId, onEdit, onRemove, onRetry }) {
  const homeSide = (e) => (e.kind === 'own_goal' ? e.team_id !== match.home_team_id : e.team_id === match.home_team_id);

  return (
    <section aria-labelledby="events-heading" className="space-y-3">
      <h3 id="events-heading" className="font-display text-xl font-black uppercase tracking-tight text-ink">Match events ({events.length})</h3>
      {state.status === 'loading' && events.length === 0 && <Skeleton className="h-24 w-full" />}
      {state.status === 'error' && (
        <Notice tone="error" role="alert">
          Events could not be loaded ({state.error}). <Button variant="quiet" size="sm" onClick={onRetry}>Try again</Button>
        </Notice>
      )}
      {events.length > 0 ? (
        <ol aria-label="Match events" className="glass divide-y divide-line/70 overflow-hidden rounded-card">
          {events.map((ev) => {
            const home = homeSide(ev);
            const isGoal = ev.kind === 'goal' || ev.kind === 'own_goal';
            const who = ev.player_id ? playerName(ev.player_id) : isGoal ? 'Unknown scorer' : 'Unknown player';
            return (
              <li key={ev.id} data-testid="match-event" className={cn('flex items-center gap-3 px-3 py-2.5', !home && 'flex-row-reverse text-right')}>
                <span className="w-12 shrink-0 text-center font-display text-lg tabular-nums text-ink">{recordedMinute(ev)}′</span>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-ink"><KindIcon kind={ev.kind} /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black uppercase tracking-tight text-ink">{who}</div>
                  <div className="eyebrow truncate">
                    {KIND_LABEL[ev.kind]}{ev.assist_player_id ? ` · Assist ${playerName(ev.assist_player_id)}` : ''}
                  </div>
                </div>
                <div className={cn('flex shrink-0 items-center', !home && 'flex-row-reverse')}>
                  {busyId === ev.id ? <span className="px-2 text-sm text-mut">Saving...</span> : <>
                    {isGoal && (
                      ev.player_id
                        ? <Button variant="quiet" size="sm" onClick={() => onEdit(ev)} aria-label="Edit" className="px-3"><Pencil size={16} aria-hidden="true" /></Button>
                        : <Button variant="quiet" size="sm" onClick={() => onEdit(ev)} className="px-3">Attribute</Button>
                    )}
                    <Button variant="quiet" size="sm" onClick={() => onRemove(ev)} aria-label="Void event" className="px-3 text-mut hover:text-live"><Trash2 size={16} aria-hidden="true" /></Button>
                  </>}
                </div>
              </li>
            );
          })}
        </ol>
      ) : state.status === 'ready' && (
        <EmptyState title="No events recorded yet">Goals and cards you add appear here, and can be corrected.</EmptyState>
      )}
    </section>
  );
}
