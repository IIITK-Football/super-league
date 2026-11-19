import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, ImagePlus, Loader2, Plus, Save, Search, Trash2, UserMinus, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { API_BASE_URL } from '../../lib/api';
import { useLatestSearch } from '../../hooks/useLatestSearch';
import FutCard from '../players/FutCard';
import { CARD_STATS, FEET, applyCardDraft, blankCardDraft, cardDraft } from '../../lib/playerCard';
import { PLAY_STYLES } from '../../data/playStyles';
import { ghostButton, inputClass, labelClass, primaryButton } from './adminStyles';
import PlayerAccountLink from './PlayerAccountLink';
import AccountMatches from './AccountMatches';
import ManualLink from './ManualLink';
import AccountPicker from './AccountPicker';

// Dictator flow for season teams and rosters: division -> season -> team entry, then that team's players.
// A player is one reusable identity (the FUT card: name, portrait, rating, attributes); a roster place puts the
// player on a team for one season, with that season's jersey number and position. Writes go straight to the Data
// API with the signed-in session, so row level security and the database decide (only a dictator may write, a
// player is on one team per season, and a roster place with goals or assists is kept); this screen reports it.

export const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST'];

// card: the FUT card fields being edited; baseAttributes: the stored attributes, kept for every field the form does not
// show.
export const blankPlayer = () => ({ first_name: '', last_name: '', jersey_number: '', position: '', overall_rating: '', card: blankCardDraft(), baseAttributes: {} });

// Returns an error message, or the cleaned values to write.
export function validatePlayer(p) {
  const first = p.first_name.trim();
  const last = p.last_name.trim();
  if (!first) return { error: 'Enter the player\'s first name.' };
  if (first.length > 100 || last.length > 100) return { error: 'Names can have up to 100 characters.' };
  const jersey = p.jersey_number === '' || p.jersey_number === null || p.jersey_number === undefined ? null : Number(p.jersey_number);
  if (jersey !== null && (!Number.isInteger(jersey) || jersey < 0 || jersey > 99)) return { error: 'Jersey number must be between 0 and 99.' };
  // An empty rating means "not set" (saved as null); a rating that is set must be 1..99. Nothing is filled in.
  const ratingText = String(p.overall_rating ?? '').trim();
  const rating = ratingText === '' ? null : Number(ratingText);
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 99)) return { error: 'Overall rating must be between 1 and 99, or left empty.' };
  const attributes = applyCardDraft(p.baseAttributes, p.card || blankCardDraft());
  if (attributes.error) return { error: attributes.error };
  return { value: { first_name: first, last_name: last, jersey_number: jersey, position: p.position || null, overall_rating: rating, attributes: attributes.value } };
}

export function describeError(error) {
  if (!error) return '';
  const text = `${error.message || ''} ${error.details || ''}`;
  if (error.code === '42501') return 'Only a dictator can change players and rosters.';
  if (error.code === '23514' && /not linked to an account/.test(text)) return 'This player is not linked to an account yet. Link them to a verified account before adding them to a roster.';
  if (error.code === '23514' && /verified account/.test(text)) return 'Choose a verified account: the person must confirm their email first.';
  if (error.code === '23505' && /player_season/.test(text)) return 'This player is already on a team this season.';
  if (error.code === '23505' && /jersey/.test(text)) return 'That jersey number is already taken on this team.';
  if (error.code === '23505' && /team_season|team_entries/.test(text)) return 'This team is already in the season.';
  if (error.code === '23503' && /goals or assists/.test(text)) return 'This player has goals or assists this season, so their place on the roster is kept.';
  if (error.code === '23503' && /player is kept/.test(text)) return error.message;
  if (error.code === '23503') return 'This player still has a roster place or match history, so the player is kept.';
  return error.message || 'Something went wrong. Try again.';
}


// The player form fields, shared by the edit and create forms (a render helper, not a component).
function playerFields(value, onChange, idPrefix) {
  const field = (key) => (e) => onChange({ ...value, [key]: e.target.value });
  return <div className="grid gap-3 md:grid-cols-4">
    <label className={labelClass}>First name<input aria-label={`${idPrefix} first name`} value={value.first_name} onChange={field('first_name')} className={`${inputClass} mt-1 normal-case tracking-normal`} /></label>
    <label className={labelClass}>Last name<input aria-label={`${idPrefix} last name`} value={value.last_name} onChange={field('last_name')} className={`${inputClass} mt-1 normal-case tracking-normal`} /></label>
    <label className={labelClass}>Jersey<input aria-label={`${idPrefix} jersey`} type="number" min="0" max="99" value={value.jersey_number ?? ''} onChange={field('jersey_number')} className={`${inputClass} mt-1`} /></label>
    <label className={labelClass}>Position<select aria-label={`${idPrefix} position`} value={value.position || ''} onChange={field('position')} className={`${inputClass} mt-1 normal-case tracking-normal`}><option value="">Not set</option>{[...new Set([...POSITIONS, value.position].filter(Boolean))].map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
    <label className={labelClass}>Overall rating<input aria-label={`${idPrefix} rating`} type="number" min="1" max="99" placeholder="Not set" value={value.overall_rating} onChange={field('overall_rating')} className={`${inputClass} mt-1`} /></label>
    {cardFields(value, onChange, idPrefix)}
  </div>;
}

// The FUT card fields (stats, preferred foot, play styles): part of the reusable identity, shared across seasons.
// Empty means not set; nothing is filled in automatically.
function cardFields(value, onChange, idPrefix) {
  const card = value.card || blankCardDraft();
  const setCard = (next) => onChange({ ...value, card: { ...card, ...next } });
  return <fieldset className="space-y-3 rounded-lg border border-white/10 p-3 md:col-span-4">
    <legend className={`${labelClass} px-1`}>FUT card (every season)</legend>
    <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
      {CARD_STATS.map(({ key, short }) => <label key={key} className={labelClass}>{short}
        <input aria-label={`${idPrefix} ${key}`} type="number" min="1" max="99" placeholder="—" value={card.stats[key]}
          onChange={(e) => setCard({ stats: { ...card.stats, [key]: e.target.value } })} className={`${inputClass} mt-1`} />
      </label>)}
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <label className={labelClass}>Preferred foot
        <select aria-label={`${idPrefix} preferred foot`} value={card.preferredFoot} onChange={(e) => setCard({ preferredFoot: e.target.value })} className={`${inputClass} mt-1 normal-case tracking-normal`}>
          <option value="">Not set</option>{FEET.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
      <label className={labelClass}>Play style
        <select aria-label={`${idPrefix} play style`} value={card.playStyle} onChange={(e) => setCard({ playStyle: e.target.value })} className={`${inputClass} mt-1 normal-case tracking-normal`}>
          <option value="">Not set</option>{PLAY_STYLES.map((style) => <option key={style.id} value={style.name}>{style.name}</option>)}
        </select>
      </label>
    </div>
  </fieldset>;
}

// This season's place (not part of the card): jersey, position and team, from the form being edited.
function seasonPlace(value, teamName) {
  const jersey = value.jersey_number === '' || value.jersey_number == null ? 'No jersey' : `#${value.jersey_number}`;
  return <p aria-label="This season's place" className="text-xs text-zinc-400"><span className={labelClass}>This season</span><br />{jersey} · {value.position || 'No position'} · {teamName}</p>;
}

// What the card preview shows for a form: the draft values over the stored card, and the picture to show.
function previewPlayer(value, imageUrl) {
  const attributes = applyCardDraft(value.baseAttributes, value.card || blankCardDraft());
  return { first_name: value.first_name, last_name: value.last_name, overall_rating: value.overall_rating, image_url: imageUrl,
    attributes: attributes.value ?? value.baseAttributes };
}

export default function ManageRosters() {
  const [divisions, setDivisions] = useState([]);
  const [divisionId, setDivisionId] = useState('');
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState('');
  const [entries, setEntries] = useState([]);
  const [divisionTeams, setDivisionTeams] = useState([]);
  const [entryId, setEntryId] = useState('');
  const [roster, setRoster] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState('');
  const [editing, setEditing] = useState(null);
  const [newPlayer, setNewPlayer] = useState(blankPlayer);
  // The verified account a new player is created for (verified_accounts_for_linking row), chosen first.
  const [newAccount, setNewAccount] = useState(null);
  const [teamToAdd, setTeamToAdd] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [search, setSearch] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [loading, setLoading] = useState({ divisions: true, seasons: false, entries: false, roster: false });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  // Account link of each player on the roster: { [playerId]: { linked, account_label } }, from player_link_status.
  const [links, setLinks] = useState({});
  const [linksError, setLinksError] = useState('');
  // Pictures chosen but not (yet) saved, previewed on the card: 'edit' for the chosen player, 'new' for the new-player
  // form. { file, url (a local preview), status: 'local' | 'uploading' | 'failed', membershipId, playerId, name }.
  const [portraits, setPortraits] = useState({});
  // Existing players, searched as the dictator types (every word of the name must match). Each result carries the
  // player's latest roster place so players with the same name can be told apart, and whether they are already in
  // this season (a player has one place per season).
  const playerSearch = useLatestSearch(
    async (text) => {
      const found = await supabase.rpc('search_players', { p_query: text, p_season_id: seasonId || null, p_limit: 20 });
      if (found.error || !found.data?.length) return found;
      // Only players linked to an account can join a roster: mark the others.
      const { data: links, error: linkError } = await supabase.rpc('player_link_status', { p_player_ids: found.data.map((p) => p.player_id) });
      if (linkError) return { data: null, error: linkError };
      const linked = new Map((links || []).map((l) => [l.player_id, l.linked]));
      return { data: found.data.map((p) => ({ ...p, linked: linked.get(p.player_id) === true })), error: null };
    },
    search, { minLength: 2, deps: [seasonId] },
  );
  // The team whose roster was asked for last; an answer for any other team arrives late and is dropped.
  const latestEntry = useRef('');

  const report = (err, success) => {
    if (err) { setMessage(''); setError(describeError(err)); return false; }
    setError(''); setMessage(success); return true;
  };
  const fail = (text) => { setMessage(''); setError(text); };
  const isLoading = (key, value) => setLoading((l) => ({ ...l, [key]: value }));

  const entry = entries.find((e) => e.id === entryId) || null;
  const season = seasons.find((s) => s.id === seasonId) || null;
  const place = roster.find((r) => r.id === selectedPlace) || null;
  const teamsNotInSeason = useMemo(() => divisionTeams.filter((t) => !entries.some((e) => e.team_id === t.id)), [divisionTeams, entries]);

  // Loading -----------------------------------------------------------------------------------------------------

  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase.from('divisions').select('id, slug, name').order('sort_order', { ascending: true });
      if (err) setError(describeError(err));
      setDivisions(data || []);
      isLoading('divisions', false);
    })();
  }, []);

  const loadSeasons = async (id) => {
    isLoading('seasons', true);
    const { data, error: err } = await supabase.from('seasons').select('id, slug, name, is_current').eq('division_id', id).order('sort_order', { ascending: true });
    if (err) setError(describeError(err));
    setSeasons(data || []);
    isLoading('seasons', false);
  };

  const loadEntries = async (sId, dId = divisionId) => {
    isLoading('entries', true);
    const [{ data: rows, error: err }, { data: divisionSeasons }] = await Promise.all([
      supabase.from('team_entries').select('id, team_id, season_id').eq('season_id', sId),
      supabase.from('seasons').select('id').eq('division_id', dId),
    ]);
    if (err) { setError(describeError(err)); isLoading('entries', false); return; }
    // The division's teams are those entered in any of its seasons.
    const { data: allEntries } = await supabase.from('team_entries').select('team_id').in('season_id', (divisionSeasons || []).map((s) => s.id));
    const teamIds = [...new Set([...(rows || []).map((r) => r.team_id), ...(allEntries || []).map((r) => r.team_id)])];
    const { data: teams, error: teamsError } = teamIds.length
      ? await supabase.from('teams').select('id, name').in('id', teamIds)
      : { data: [], error: null };
    if (teamsError) setError(describeError(teamsError));
    const names = new Map((teams || []).map((t) => [t.id, t.name]));
    setEntries((rows || []).map((r) => ({ ...r, name: names.get(r.team_id) || 'Unnamed team' })).sort((a, b) => a.name.localeCompare(b.name)));
    setDivisionTeams((teams || []).sort((a, b) => a.name.localeCompare(b.name)));
    isLoading('entries', false);
  };

  const loadRoster = async (eId) => {
    latestEntry.current = eId;
    isLoading('roster', true);
    const { data: places, error: err } = await supabase.from('roster_memberships').select('id, player_id, team_entry_id, season_id, jersey_number, position').eq('team_entry_id', eId);
    if (latestEntry.current !== eId) return;
    if (err) { setError(describeError(err)); isLoading('roster', false); return; }
    const ids = (places || []).map((p) => p.player_id);
    const [{ data: players, error: playersError }, { data: linkRows, error: linkError }] = ids.length
      ? await Promise.all([
        supabase.from('players').select('id, first_name, last_name, image_url, overall_rating, attributes').in('id', ids),
        supabase.rpc('player_link_status', { p_player_ids: ids }),
      ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (latestEntry.current !== eId) return;
    if (playersError) setError(describeError(playersError));
    setLinksError(linkError ? describeError(linkError) : '');
    setLinks(Object.fromEntries((linkRows || []).map((l) => [l.player_id, l])));
    const byId = new Map((players || []).map((p) => [p.id, p]));
    setRoster((places || []).map((p) => ({ ...p, player: byId.get(p.player_id) || null }))
      .sort((a, b) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999)));
    isLoading('roster', false);
  };

  // Selection ---------------------------------------------------------------------------------------------------

  const chooseDivision = (id) => {
    latestEntry.current = '';
    setDivisionId(id); setSeasonId(''); setSeasons([]); setEntryId(''); setEntries([]); setRoster([]); setSelectedPlace(''); setEditing(null);
    if (id) loadSeasons(id);
  };
  const chooseSeason = (id) => {
    latestEntry.current = '';
    setSeasonId(id); setEntryId(''); setEntries([]); setRoster([]); setSelectedPlace(''); setEditing(null);
    if (id) loadEntries(id);
  };
  const chooseEntry = (id) => {
    latestEntry.current = id;
    setPortraits((current) => { Object.values(current).forEach((x) => x.url && URL.revokeObjectURL(x.url)); return {}; });
    setEntryId(id); setRoster([]); setSelectedPlace(''); setEditing(null); setSearch(''); setMoveTo('');
    if (id) loadRoster(id);
  };
  const choosePlace = (id) => {
    setPortrait('edit', null);
    setSelectedPlace(id); setMoveTo('');
    const r = roster.find((x) => x.id === id);
    setEditing(r ? {
      first_name: r.player?.first_name || '', last_name: r.player?.last_name || '', jersey_number: r.jersey_number ?? '', position: r.position || '',
      overall_rating: r.player?.overall_rating == null ? '' : String(r.player.overall_rating), card: cardDraft(r.player?.attributes), baseAttributes: r.player?.attributes || {},
    } : null);
  };

  // Teams in the season ------------------------------------------------------------------------------------------

  const addExistingTeam = async () => {
    if (!teamToAdd) { fail('Choose a team to add to the season.'); return; }
    setBusy('add-team');
    const { error: err } = await supabase.from('team_entries').insert({ team_id: teamToAdd, season_id: seasonId });
    setBusy('');
    const name = divisionTeams.find((t) => t.id === teamToAdd)?.name;
    if (report(err, `${name} added to ${season?.name}.`)) { setTeamToAdd(''); loadEntries(seasonId); }
  };

  const createTeam = async () => {
    const name = newTeamName.trim();
    if (name.length < 2 || name.length > 60) { fail('A team name needs 2 to 60 characters.'); return; }
    setBusy('new-team');
    // One step in the database: the team and its season entry are created together, or neither is.
    const { error: err } = await supabase.rpc('create_team_in_season', { p_season_id: seasonId, p_name: name });
    setBusy('');
    if (report(err, `${name} created and added to ${season?.name}.`)) { setNewTeamName(''); loadEntries(seasonId); }
  };

  // Players ----------------------------------------------------------------------------------------------------

  // A new player starts from a verified account (every player has one). An account that already has a player, or that a
  // legacy player is waiting for (the same email), is offered as that player instead of a duplicate.
  const createPlayer = async (event) => {
    event.preventDefault();
    if (!newAccount) { fail('Choose the new player\'s verified account first.'); return; }
    const checked = validatePlayer(newPlayer);
    if (checked.error) { fail(checked.error); return; }
    const v = checked.value;
    const name = `${v.first_name} ${v.last_name}`.trim();
    setBusy('create-player');
    const { data: playerId, error: err } = await supabase.rpc('create_player_for_account', {
      p_user: newAccount.user_id, p_team_entry_id: entryId, p_first_name: v.first_name, p_last_name: v.last_name, p_jersey_number: v.jersey_number,
      p_position: v.position, p_overall_rating: v.overall_rating, p_attributes: v.attributes, p_image_url: null,
    });
    setBusy('');
    if (!report(err, `${name} added to ${entry?.name}, linked to ${newAccount.email}.`)) return;
    setNewPlayer(blankPlayer());
    setNewAccount(null);
    loadRoster(entryId);
    const pending = portraits.new;
    if (!pending?.file || !playerId) return;
    const { data: placeRow } = await supabase.from('roster_memberships').select('id').eq('player_id', playerId).eq('season_id', seasonId).maybeSingle();
    const ready = { ...pending, playerId, membershipId: placeRow?.id, name };
    if (!placeRow?.id) { setPortraits((c) => ({ ...c, new: { ...ready, status: 'failed' } })); fail(`${name} was added, but the portrait could not be attached yet. Retry the portrait below.`); return; }
    if (await uploadNewPortrait(ready)) { report(null, `${name} added to ${entry?.name} with their portrait.`); loadRoster(entryId); }
  };

  // The account already has a player (or a legacy player waits for it): put that player on this team instead.
  const addAccountPlayer = async (account) => {
    const waiting = !account.linked_player_id && account.key_player_id;
    const playerId = account.linked_player_id || account.key_player_id;
    const name = account.linked_player_name || account.key_player_name;
    setBusy('add-account-player');
    if (waiting) {
      const { error: linkError } = await supabase.rpc('link_player_account', { p_player: playerId, p_user: account.user_id });
      if (linkError) { setBusy(''); report(linkError); return; }
    }
    const { error: err } = await supabase.rpc('add_player_to_roster', { p_player: playerId, p_team_entry_id: entryId });
    setBusy('');
    if (report(err, `${name} ${waiting ? `is linked to ${account.email} and ` : ''}added to ${entry?.name}.`)) { setNewAccount(null); loadRoster(entryId); }
  };

  const savePlayer = async () => {
    const checked = validatePlayer(editing);
    if (checked.error) { fail(checked.error); return; }
    const v = checked.value;
    setBusy(`save-${place.id}`);
    // One database call: the card and the roster place are saved together or not at all. The email is the linked
    // account's and is not edited here.
    const { error: err } = await supabase.rpc('update_rostered_player', {
      p_membership_id: place.id, p_first_name: v.first_name, p_last_name: v.last_name, p_overall_rating: v.overall_rating,
      p_attributes: v.attributes, p_jersey_number: v.jersey_number, p_position: v.position,
    });
    setBusy('');
    if (report(err, `${v.first_name} saved.`)) loadRoster(entryId);
  };

  const setPortrait = (slot, next) => setPortraits((current) => {
    const old = current[slot];
    if (old?.url && old.url !== next?.url) URL.revokeObjectURL(old.url);
    const copy = { ...current };
    if (next) copy[slot] = next; else delete copy[slot];
    return copy;
  });
  const markPortraitFailed = (slot) => setPortraits((current) => (current[slot] ? { ...current, [slot]: { ...current[slot], status: 'failed' } } : current));

  // Uploads a portrait for a roster place and stores it on the player's card. Returns '' once the picture is saved,
  // otherwise what went wrong; nothing is reported as saved unless both steps succeeded.
  const sendPortrait = async (file, membershipId, playerId) => {
    try {
      const form = new FormData();
      form.append('membership_id', membershipId);
      form.append('image', file, `${playerId}.png`);
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`${API_BASE_URL}/admin/freshers/player-image`, {
        method: 'POST', credentials: 'include', headers: { Authorization: `Bearer ${session?.access_token}` }, body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return result.message || result.error || `the upload was refused (HTTP ${response.status})`;
      const { data, error: err } = await supabase.from('players').update({ image_url: result.imageUrl }).eq('id', playerId).select('id');
      if (err || !data?.length) return describeError(err || { code: '42501' });
      return '';
    } catch (uploadError) {
      return uploadError.message || 'the upload failed';
    }
  };

  const uploadPortrait = async (file) => {
    if (!file || !place) return;
    const target = place;
    const url = portraits.edit?.file === file ? portraits.edit.url : URL.createObjectURL(file);
    setPortrait('edit', { file, url, status: 'uploading', membershipId: target.id, playerId: target.player_id });
    setBusy(`portrait-${target.id}`);
    setError(''); setMessage('');
    const problem = await sendPortrait(file, target.id, target.player_id);
    setBusy('');
    if (problem) { markPortraitFailed('edit'); fail(`The portrait did not save: ${problem}. Nothing was changed; try again.`); return; }
    setPortrait('edit', null);
    report(null, 'Portrait saved.');
    loadRoster(entryId);
  };

  // A new player's picture is uploaded once the player exists. If that fails the player is kept and the picture can be
  // retried.
  const uploadNewPortrait = async (pending) => {
    setPortraits((current) => ({ ...current, new: { ...pending, status: 'uploading' } }));
    setBusy('new-portrait');
    const problem = await sendPortrait(pending.file, pending.membershipId, pending.playerId);
    setBusy('');
    if (problem) {
      markPortraitFailed('new');
      fail(`${pending.name} was added to ${entry?.name}, but the portrait did not save: ${problem}. Retry the portrait below.`);
      return false;
    }
    setPortrait('new', null);
    return true;
  };

  const movePlayer = async () => {
    if (!moveTo) { fail('Choose the team to move the player to.'); return; }
    setBusy(`move-${place.id}`);
    const { data, error: err } = await supabase.from('roster_memberships').update({ team_entry_id: moveTo }).eq('id', place.id).select('id');
    setBusy('');
    if (!err && !data?.length) { report({ code: '42501' }); return; }
    const target = entries.find((e) => e.id === moveTo)?.name;
    if (report(err, `Moved to ${target}.`)) { setSelectedPlace(''); setEditing(null); setMoveTo(''); loadRoster(entryId); }
  };

  const removeFromRoster = async () => {
    if (!window.confirm('Remove this player from the team\'s roster for this season? The player is kept.')) return;
    setBusy(`remove-${place.id}`);
    const { data, error: err } = await supabase.from('roster_memberships').delete().eq('id', place.id).select('id');
    setBusy('');
    if (!err && !data?.length) { report({ code: '42501' }); return; }
    if (report(err, 'Removed from the roster. The player is kept and can join another team.')) { setSelectedPlace(''); setEditing(null); loadRoster(entryId); }
  };

  const deletePlayer = async () => {
    const name = place.player ? `${place.player.first_name} ${place.player.last_name}` : 'this player';
    if (!window.confirm(`Delete ${name} for good? This only works for a player with no other season and no match history.`)) return;
    setBusy(`delete-${place.id}`);
    // One step in the database: the roster place and the player go together, or nothing changes.
    const { error: err } = await supabase.rpc('delete_unplayed_player', { p_player_id: place.player_id });
    setBusy('');
    if (!report(err, `${name} deleted.`)) return;
    setSelectedPlace(''); setEditing(null); loadRoster(entryId);
  };

  const addExistingPlayer = async (player) => {
    setBusy(`add-${player.player_id}`);
    const { error: err } = await supabase.rpc('add_player_to_roster', { p_player: player.player_id, p_team_entry_id: entryId });
    setBusy('');
    if (report(err, `${player.first_name} ${player.last_name} added to ${entry?.name}.`)) { setSearch(''); loadRoster(entryId); }
  };


  // Render -----------------------------------------------------------------------------------------------------

  return <div className="space-y-6 p-6">
    <div>
      <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight"><Users size={20} /> Teams &amp; rosters</h2>
      <p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Choose a division, season and team, then manage that season&apos;s roster. A player keeps one card across seasons.</p>
    </div>

    {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">{message}</p>}

    <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-5 md:grid-cols-3">
      <label className={labelClass}>Division
        <select aria-label="Division" value={divisionId} onChange={(e) => chooseDivision(e.target.value)} disabled={loading.divisions} className={`${inputClass} mt-1 normal-case tracking-normal`}>
          <option value="">{loading.divisions ? 'Loading divisions...' : divisions.length ? 'Choose a division' : 'No divisions yet'}</option>
          {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <label className={labelClass}>Season
        <select aria-label="Season" value={seasonId} onChange={(e) => chooseSeason(e.target.value)} disabled={!divisionId || loading.seasons} className={`${inputClass} mt-1 normal-case tracking-normal`}>
          <option value="">{loading.seasons ? 'Loading seasons...' : !divisionId ? 'Choose a division first' : seasons.length ? 'Choose a season' : 'This division has no seasons'}</option>
          {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}
        </select>
      </label>
      <label className={labelClass}>Team
        <select aria-label="Team" value={entryId} onChange={(e) => chooseEntry(e.target.value)} disabled={!seasonId || loading.entries} className={`${inputClass} mt-1 normal-case tracking-normal`}>
          <option value="">{loading.entries ? 'Loading teams...' : !seasonId ? 'Choose a season first' : entries.length ? 'Choose a team' : 'No teams in this season yet'}</option>
          {entries.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </label>
    </div>

    {seasonId && !loading.entries && <section aria-label="Teams in this season" className="grid gap-3 rounded-2xl border border-white/10 bg-white/[.02] p-5 md:grid-cols-2">
      <div className="flex items-end gap-2">
        <label className={`${labelClass} flex-1`}>Add an existing team to {season?.name}
          <select aria-label="Existing team" value={teamToAdd} onChange={(e) => setTeamToAdd(e.target.value)} className={`${inputClass} mt-1 normal-case tracking-normal`}>
            <option value="">{teamsNotInSeason.length ? 'Choose a team' : 'Every team of this division is already in the season'}</option>
            {teamsNotInSeason.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={addExistingTeam} disabled={busy === 'add-team' || !teamsNotInSeason.length} className={ghostButton}><Plus size={13} /> Add team</button>
      </div>
      <div className="flex items-end gap-2">
        <label className={`${labelClass} flex-1`}>Or create a new team
          <input aria-label="New team name" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="Team name" className={`${inputClass} mt-1 normal-case tracking-normal`} />
        </label>
        <button type="button" onClick={createTeam} disabled={busy === 'new-team'} className={ghostButton}>{busy === 'new-team' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Create team</button>
      </div>
    </section>}

    {entryId && <section aria-label={`Roster of ${entry?.name}`} className="space-y-4 rounded-2xl border border-white/10 bg-white/[.02] p-5">
      <h3 className="text-sm font-black uppercase tracking-wider text-zinc-300">Roster of {entry?.name} · {season?.name}</h3>
      {loading.roster ? <p className="text-zinc-500">Loading players...</p> : !roster.length
        ? <p className="text-zinc-500">No players on this roster yet. Add an existing player or create one below.</p>
        : <label className={labelClass}>Player
          <select aria-label="Player" value={selectedPlace} onChange={(e) => choosePlace(e.target.value)} className={`${inputClass} mt-1 normal-case tracking-normal`}>
            <option value="">Choose a player to edit ({roster.length} on the roster)</option>
            {roster.map((r) => <option key={r.id} value={r.id}>{r.jersey_number ?? '–'} · {r.player ? `${r.player.first_name} ${r.player.last_name}` : 'Unknown player'}{r.position ? ` · ${r.position}` : ''}{links[r.player_id]?.linked ? ' · linked account' : ''}</option>)}
          </select>
        </label>}

      {place && editing && <div aria-label="Edit player" className="space-y-3 rounded-xl border border-[#d9ff4a]/30 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <FutCard details player={previewPlayer(editing, place.player?.image_url)} portrait={portraits.edit?.membershipId === place.id ? portraits.edit : undefined} />
          {seasonPlace(editing, entry?.name)}
        </div>
        {playerFields(editing, setEditing, 'Edit')}
        {place.player && <PlayerAccountLink key={place.player_id} player={place.player} status={links[place.player_id] || (linksError ? null : { linked: false })} statusError={linksError} onChanged={() => loadRoster(entryId)} />}
        <div className="flex flex-wrap items-end gap-2">
          <button type="button" onClick={savePlayer} disabled={busy === `save-${place.id}`} className={primaryButton}>{busy === `save-${place.id}` ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save player</button>
          <label className={ghostButton}>
            {busy === `portrait-${place.id}` ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />} Portrait (500 × 500 PNG)
            <input type="file" accept="image/png" className="sr-only" aria-label="Portrait file" onChange={(e) => { uploadPortrait(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {portraits.edit?.status === 'failed' && portraits.edit.membershipId === place.id && <>
            <button type="button" onClick={() => uploadPortrait(portraits.edit.file)} disabled={busy === `portrait-${place.id}`} className={ghostButton}>Retry portrait upload</button>
            <button type="button" onClick={() => setPortrait('edit', null)} className={ghostButton}>Discard new picture</button>
          </>}
          <select aria-label="Move to team" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={`${inputClass} w-48`}>
            <option value="">Move to another team</option>
            {entries.filter((e) => e.id !== entryId).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button type="button" onClick={movePlayer} disabled={busy === `move-${place.id}` || !moveTo} className={ghostButton}><ArrowRightLeft size={13} /> Move</button>
          <button type="button" onClick={removeFromRoster} disabled={busy === `remove-${place.id}`} className="flex items-center gap-1 rounded-lg border border-red-500/30 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-red-400 disabled:opacity-40"><UserMinus size={13} /> Remove from roster</button>
          <button type="button" onClick={deletePlayer} disabled={busy === `delete-${place.id}`} className="flex items-center gap-1 rounded-lg border border-red-500/30 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-red-400 disabled:opacity-40"><Trash2 size={13} /> Delete player</button>
        </div>
      </div>}

      <div role="search" aria-label="Find an existing player" className="space-y-2">
        <label className={`${labelClass} block`}>Add an existing player (plays in another season or division)
          <span className="mt-1 flex items-center gap-2 rounded-lg border border-white/10 bg-black/50 px-3 focus-within:border-[#d9ff4a]/60">
            <Search size={14} className="text-zinc-500" aria-hidden="true" />
            <input type="search" aria-label="Search players" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="First and/or last name"
              className="w-full bg-transparent py-2 text-sm normal-case tracking-normal text-white outline-none" />
          </span>
        </label>
        <p aria-live="polite" className="text-xs text-zinc-500">
          {playerSearch.status === 'idle' && search.trim() && 'Type at least two letters of the name.'}
          {playerSearch.status === 'loading' && <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Searching players...</span>}
          {playerSearch.status === 'ready' && (playerSearch.results.length
            ? `${playerSearch.results.length} player${playerSearch.results.length === 1 ? '' : 's'} found${playerSearch.results.length === 20 ? ' (the first 20; add more of the name to narrow)' : ''}`
            : `No player matches “${search.trim()}”. Create them below.`)}
        </p>
        {playerSearch.status === 'error' && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          The player search failed ({playerSearch.error}). <button type="button" onClick={playerSearch.retry} className="underline">Try again</button>
        </p>}
        {playerSearch.status === 'ready' && playerSearch.results.length > 0 && <ul aria-label="Matching players" className="space-y-1">{playerSearch.results.map((p) => {
          const name = `${p.first_name} ${p.last_name}`.trim();
          const context = p.last_team ? `${p.last_team} · ${p.last_season} (${p.last_division})${p.last_jersey != null ? ` · #${p.last_jersey}` : ''}` : 'Not on a roster yet';
          return <li key={p.player_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/30 px-3 py-2 text-sm">
            <span><span className="font-bold text-white">{name}</span> <span className="text-zinc-500">· OVR {p.overall_rating ?? '—'}</span>
              <span className="block text-xs text-zinc-500">Latest: {context}</span></span>
            {p.in_season
              ? <span className="text-xs text-zinc-500">Already in this season</span>
              : !p.linked
                ? <span className="text-xs text-amber-300">Not linked to an account: link first</span>
              : <button type="button" onClick={() => addExistingPlayer(p)} disabled={busy === `add-${p.player_id}`} aria-label={`Add ${name} to ${entry?.name}`} className={ghostButton}><Plus size={13} /> Add to {entry?.name}</button>}
          </li>;
        })}</ul>}
      </div>

      <form noValidate onSubmit={createPlayer} aria-label="New player" className="space-y-3 rounded-xl border border-white/10 p-4">
        <p className="text-xs font-black uppercase tracking-wider text-zinc-400">New player on {entry?.name}</p>
        {!newAccount
          ? <AccountPicker label="1. The new player's verified account" idPrefix="New player" onPick={(acc) => { setNewAccount(acc); setError(''); setMessage(''); }}
            pickLabel={(acc) => (acc.linked_player_id || acc.key_player_id ? 'Use their player' : 'Choose')} />
          : <p className="flex flex-wrap items-center gap-2 text-sm text-white">Account: <span className="font-bold">{newAccount.email}</span>
            <button type="button" onClick={() => setNewAccount(null)} className={ghostButton}>Change</button></p>}
        {newAccount && (newAccount.linked_player_id || newAccount.key_player_id) && <div role="group" aria-label="Existing player for this account" className="space-y-2 rounded-lg border border-amber-400/30 p-3 text-sm">
          <p className="text-zinc-200">{newAccount.linked_player_id
            ? `This account already has a player: ${newAccount.linked_player_name}${newAccount.linked_player_place ? ` (${newAccount.linked_player_place})` : ''}. A person has one player in every season, so add that player instead of creating another.`
            : `${newAccount.key_player_name}${newAccount.key_player_place ? ` (${newAccount.key_player_place})` : ''} is waiting for this account (the same email). Link that player and add them instead of creating another.`}</p>
          <button type="button" onClick={() => addAccountPlayer(newAccount)} disabled={busy === 'add-account-player'} className={primaryButton}>
            {busy === 'add-account-player' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {newAccount.linked_player_id ? `Add ${newAccount.linked_player_name} to ${entry?.name}` : `Link ${newAccount.key_player_name} and add to ${entry?.name}`}
          </button>
        </div>}
        {newAccount && !newAccount.linked_player_id && !newAccount.key_player_id && <>
        <div className="flex flex-wrap items-start gap-3">
            <FutCard details player={previewPlayer(newPlayer, null)} portrait={portraits.new?.status === 'local' ? portraits.new : undefined} />
            <div className="space-y-2">
              {seasonPlace(newPlayer, entry?.name)}
              <label className={ghostButton}><ImagePlus size={13} /> {portraits.new?.status === 'local' ? 'Change picture' : 'Choose portrait (500 × 500 PNG)'}
                <input type="file" accept="image/png" className="sr-only" aria-label="New portrait file" onChange={(e) => {
                  const file = e.target.files?.[0]; e.target.value = '';
                  if (file) setPortrait('new', { file, url: URL.createObjectURL(file), status: 'local' });
                }} />
              </label>
              {portraits.new?.status === 'local' && <button type="button" onClick={() => setPortrait('new', null)} className={ghostButton}>Remove picture</button>}
              <p className="text-[10px] text-zinc-500">The picture uploads when the player is created.</p>
            </div>
          </div>
          {playerFields(newPlayer, setNewPlayer, 'New')}
          <button type="submit" disabled={busy === 'create-player'} className={primaryButton}>{busy === 'create-player' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create player</button>
        </>}
        {portraits.new?.status === 'failed' && <div role="group" aria-label="New player portrait" className="flex flex-wrap items-center gap-2 rounded-lg border border-red-500/20 p-2 text-xs text-red-300">
          The portrait for {portraits.new.name} is not saved.
          {portraits.new.membershipId && <button type="button" onClick={() => uploadNewPortrait(portraits.new).then((ok) => ok && (report(null, `Portrait saved for ${portraits.new.name}.`), loadRoster(entryId)))} disabled={busy === 'new-portrait'} className={ghostButton}>Retry portrait upload</button>}
          <button type="button" onClick={() => setPortrait('new', null)} className={ghostButton}>Discard picture</button>
        </div>}
      </form>
    </section>}

    <AccountMatches onChanged={() => entryId && loadRoster(entryId)} />
    <ManualLink onChanged={() => entryId && loadRoster(entryId)} />

    {!divisionId && !loading.divisions && divisions.length > 0 && <p className="text-zinc-500">Choose a division to see its seasons and teams.</p>}
    <p className="text-[10px] text-zinc-600">Players who have scored or assisted in a season keep their place on that season&apos;s roster, and a player who has played is never deleted.</p>
  </div>;
}
