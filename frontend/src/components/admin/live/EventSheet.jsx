import { Button, Combobox, Crest, Field, NumberField, SegmentedControl, Sheet } from '../../ui';
import { KIND_LABEL, KindIcon } from './EventTimeline';
import { MAX_MINUTE } from './clock';

const isCard = (kind) => kind === 'yellow' || kind === 'red';
const playerOption = (p) => ({
  value: p.id,
  label: `${p.jersey_number != null ? `${p.jersey_number} ` : ''}${p.first_name} ${p.last_name}`,
  description: p.position || undefined,
});

// One sheet for every event: the kind, the team, the player (searchable, with shirt numbers), the assist for a goal,
// and the minute (prefilled with the clock). A card needs a player; a goal may wait for its scorer.
export function EventSheet({ open, onClose, form, setForm, match, crest, players, busy, onSubmit }) {
  const editing = Boolean(form.editId);
  const ownGoal = form.kind === 'own_goal';
  const card = isCard(form.kind);
  const squad = players.filter((p) => (p.team_id || p.teams?.id) === form.team_id).map(playerOption);
  const side = (id, name, label) => ({ value: id, label, icon: <Crest size="sm" name={name} src={crest(id)?.logo_url} color={crest(id)?.team_color} /> });
  const kinds = (editing ? ['goal', 'own_goal'] : ['goal', 'own_goal', 'yellow', 'red'])
    .map((k) => ({ value: k, label: KIND_LABEL[k].replace(' card', ''), icon: <KindIcon kind={k} size={16} /> }));
  const title = editing ? 'Correct goal' : `Add ${KIND_LABEL[form.kind].toLowerCase()}`;
  const ready = form.team_id && (!card || form.player_id);

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form onSubmit={onSubmit} className="space-y-5 pb-[env(safe-area-inset-bottom)]">
        <SegmentedControl
          aria-label="Event"
          options={kinds}
          value={form.kind}
          onChange={(kind) => setForm((f) => ({ ...f, kind, assist_id: kind === 'goal' ? f.assist_id : '' }))}
        />
        <Field label={ownGoal ? 'Own goal by' : card ? 'Card for' : 'Scoring team'}>
          {(p) => (
            <SegmentedControl
              aria-labelledby={p['aria-labelledby']}
              options={[side(match.home_team_id, match.home_team_name, `${match.home_team_name} (Home)`), side(match.away_team_id, match.away_team_name, `${match.away_team_name} (Away)`)]}
              value={form.team_id || undefined}
              onChange={(team_id) => setForm((f) => ({ ...f, team_id, player_id: '', assist_id: '' }))}
              className="[&_button]:min-h-12 [&_button_span:last-child]:truncate"
            />
          )}
        </Field>
        <Field label={card ? 'Player' : ownGoal ? 'Player who scored the own goal' : 'Goalscorer'} hint={!card && !form.player_id ? 'Leave empty if the scorer is not known yet.' : undefined}>
          {(p) => (
            <Combobox
              {...p}
              disabled={!form.team_id}
              value={form.player_id || undefined}
              onChange={(player_id) => setForm((f) => ({ ...f, player_id, assist_id: f.assist_id === player_id ? '' : f.assist_id }))}
              placeholder={form.team_id ? 'Search name or number' : 'Choose the team first'}
              searchPlaceholder="Name or number"
              emptyText="No player on this roster matches"
              options={card ? squad : [{ value: '', label: 'Scorer not known yet' }, ...squad]}
            />
          )}
        </Field>
        {form.kind === 'goal' && (
          <Field label="Assist (optional)">
            {(p) => (
              <Combobox
                {...p}
                disabled={!form.team_id}
                value={form.assist_id || undefined}
                onChange={(assist_id) => setForm((f) => ({ ...f, assist_id }))}
                placeholder="No assist"
                searchPlaceholder="Name or number"
                options={[{ value: '', label: 'No assist' }, ...squad.filter((o) => o.value !== form.player_id)]}
              />
            )}
          </Field>
        )}
        <Field label="Minute" hint="Prefilled with the clock. 93 is saved as 90+3.">
          {(p) => <NumberField aria-labelledby={p['aria-labelledby']} aria-describedby={p['aria-describedby']} size="lg" min={0} max={MAX_MINUTE} value={form.minute} onChange={(minute) => setForm((f) => ({ ...f, minute }))} />}
        </Field>
        <Button type="submit" size="lg" disabled={busy || !ready} className="w-full">
          {busy ? 'Saving...' : editing ? 'Save correction' : card ? 'Confirm card' : 'Confirm goal'}
        </Button>
      </form>
    </Sheet>
  );
}
