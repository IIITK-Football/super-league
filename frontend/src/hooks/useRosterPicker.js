import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// Division -> season -> team -> player selection, for finding a player through the season rosters (the same reads as
// Teams & Rosters). Each list loads when the level above is chosen; a late answer for an earlier choice is dropped.
// players carry { id, first_name, last_name, jersey_number, position, linked } (linked from player_link_status).
export function useRosterPicker() {
  const [divisions, setDivisions] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [entries, setEntries] = useState([]);
  const [players, setPlayers] = useState([]);
  const [choice, setChoice] = useState({ divisionId: '', seasonId: '', entryId: '', playerId: '' });
  const [loading, setLoading] = useState('divisions');
  const [error, setError] = useState('');
  const latest = useRef(0);

  const run = async (what, load) => {
    const ticket = ++latest.current;
    setLoading(what); setError('');
    try {
      const result = await load();
      if (ticket !== latest.current) return null;
      setLoading('');
      return result;
    } catch (e) {
      if (ticket === latest.current) { setLoading(''); setError(e.message || 'The list could not be loaded.'); }
      return null;
    }
  };
  const must = ({ data, error: err }) => { if (err) throw err; return data || []; };

  useEffect(() => {
    run('divisions', async () => setDivisions(must(await supabase.from('divisions').select('id, slug, name').order('sort_order', { ascending: true }))));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseDivision = (divisionId) => {
    setChoice({ divisionId, seasonId: '', entryId: '', playerId: '' }); setSeasons([]); setEntries([]); setPlayers([]);
    if (divisionId) run('seasons', async () => setSeasons(must(await supabase.from('seasons').select('id, slug, name, is_current').eq('division_id', divisionId).order('sort_order', { ascending: true }))));
  };
  const chooseSeason = (seasonId) => {
    setChoice((c) => ({ ...c, seasonId, entryId: '', playerId: '' })); setEntries([]); setPlayers([]);
    if (!seasonId) return;
    run('entries', async () => {
      const rows = must(await supabase.from('team_entries').select('id, team_id').eq('season_id', seasonId));
      const teams = rows.length ? must(await supabase.from('teams').select('id, name').in('id', rows.map((r) => r.team_id))) : [];
      const names = new Map(teams.map((t) => [t.id, t.name]));
      setEntries(rows.map((r) => ({ ...r, name: names.get(r.team_id) || 'Unnamed team' })).sort((a, b) => a.name.localeCompare(b.name)));
    });
  };
  const chooseEntry = (entryId) => {
    setChoice((c) => ({ ...c, entryId, playerId: '' })); setPlayers([]);
    if (!entryId) return;
    run('players', async () => {
      const places = must(await supabase.from('roster_memberships').select('player_id, jersey_number, position').eq('team_entry_id', entryId));
      const ids = places.map((p) => p.player_id);
      if (!ids.length) { setPlayers([]); return; }
      const [cards, links] = await Promise.all([
        supabase.from('players').select('id, first_name, last_name').in('id', ids).then(must),
        supabase.rpc('player_link_status', { p_player_ids: ids }).then(must),
      ]);
      const byId = new Map(cards.map((p) => [p.id, p]));
      const linked = new Map(links.map((l) => [l.player_id, l.linked]));
      setPlayers(places.filter((p) => byId.has(p.player_id)).map((p) => ({ ...byId.get(p.player_id), jersey_number: p.jersey_number, position: p.position, linked: linked.get(p.player_id) === true }))
        .sort((a, b) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999)));
    });
  };
  const choosePlayer = (playerId) => setChoice((c) => ({ ...c, playerId }));
  const reloadPlayers = () => choice.entryId && chooseEntry(choice.entryId);

  return { divisions, seasons, entries, players, choice, loading, error, chooseDivision, chooseSeason, chooseEntry, choosePlayer, reloadPlayers };
}
