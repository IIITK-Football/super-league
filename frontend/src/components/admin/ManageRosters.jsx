import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { API_BASE_URL } from '../../lib/api';
import { useLatestSearch } from '../../hooks/useLatestSearch';
import FutCard from '../players/FutCard';
import { CARD_STATS, FEET, applyCardDraft, blankCardDraft, cardDraft } from '../../lib/playerCard';
import { PLAY_STYLES } from '../../data/playStyles';
import PlayerAccountLink from './PlayerAccountLink';
import AccountMatches from './AccountMatches';
import ManualLink from './ManualLink';
import AccountPicker from './AccountPicker';
import { Pencil, Plus, Shield, UserPlus, Users } from 'lucide-react';
import { Button, Card, Combobox, Crest, Field, Notice, Select, Sheet, TextInput, useConfirm } from '../ui';

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
  return error.message || 'The request did not complete. Try again.';
}


// The player form fields, shared by the edit and create forms (a render helper, not a component).
function playerFields(value, onChange, idPrefix) {
  const field = (key) => (e) => onChange({ ...value, [key]: e.target.value });
  return <div className="grid grid-cols-2 gap-3">
    <Field label="First name" aria-label={`${idPrefix} first name`} value={value.first_name} onChange={field('first_name')} />
    <Field label="Last name" aria-label={`${idPrefix} last name`} value={value.last_name} onChange={field('last_name')} />
    <Field type="number" min="0" max="99" label="Jersey" aria-label={`${idPrefix} jersey`} value={value.jersey_number ?? ''} onChange={field('jersey_number')} />
    <Field label="Position">{(p) => <Select {...p} aria-label={`${idPrefix} position`} value={value.position || ''} placeholder="Not set"
      onChange={(next) => onChange({ ...value, position: next })}
      options={[{ value: '', label: 'Not set' }, ...[...new Set([...POSITIONS, value.position].filter(Boolean))].map((pos) => ({ value: pos, label: pos }))]} />}</Field>
    <Field type="number" min="1" max="99" label="Overall rating" placeholder="Not set" aria-label={`${idPrefix} rating`} value={value.overall_rating} onChange={field('overall_rating')} />
    {cardFields(value, onChange, idPrefix)}
  </div>;
}

// The FUT card fields (stats, preferred foot, play styles): part of the reusable identity, shared across seasons.
// Empty means not set; nothing is filled in automatically.
function cardFields(value, onChange, idPrefix) {
  const card = value.card || blankCardDraft();
  const setCard = (next) => onChange({ ...value, card: { ...card, ...next } });
  return <fieldset className="col-span-2 space-y-3 rounded-card border border-line p-3">
    <legend className="px-1 text-sm font-semibold text-ink">FUT card (every season)</legend>
    <div className="grid grid-cols-3 gap-2">
      {CARD_STATS.map(({ key, short }) => <Field key={key} type="number" min="1" max="99" label={short} aria-label={`${idPrefix} ${key}`} value={card.stats[key]}
        onChange={(e) => setCard({ stats: { ...card.stats, [key]: e.target.value } })} />)}
    </div>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Preferred foot">{(p) => <Select {...p} aria-label={`${idPrefix} preferred foot`} value={card.preferredFoot} placeholder="Not set"
        onChange={(preferredFoot) => setCard({ preferredFoot })}
        options={[{ value: '', label: 'Not set' }, ...FEET.map((foot) => ({ value: foot, label: foot }))]} />}</Field>
      <Field label="Play style">{(p) => <Combobox {...p} aria-label={`${idPrefix} play style`} value={card.playStyle} placeholder="No play style"
        searchPlaceholder="Search play styles" onChange={(playStyle) => setCard({ playStyle })}
        options={[{ value: '', label: 'No play style' }, ...PLAY_STYLES.map((style) => ({ value: style.name, label: style.name }))]} />}</Field>
    </div>
  </fieldset>;
}

// This season's place (not part of the card): jersey, position and team, from the form being edited.
function seasonPlace(value, teamName) {
  const jersey = value.jersey_number === '' || value.jersey_number == null ? 'No jersey' : `#${value.jersey_number}`;
  return <p aria-label="This season's place" className="text-sm text-mut"><span className="font-semibold text-ink">This season</span><br />{jersey} · {value.position || 'No position'} · {teamName}</p>;
}

// What the card preview shows for a form: the draft values over the stored card, and the picture to show.
function previewPlayer(value, imageUrl) {
  const attributes = applyCardDraft(value.baseAttributes, value.card || blankCardDraft());
  return { first_name: value.first_name, last_name: value.last_name, overall_rating: value.overall_rating, image_url: imageUrl,
    attributes: attributes.value ?? value.baseAttributes };
}

export default function ManageRosters() {
  const confirm = useConfirm();
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
  // Team rename (null when closed), the add-player sheet, and the account sheet's roster place.
  const [renameText, setRenameText] = useState(null);
  const [adding, setAdding] = useState(false);
  const [linkPlaceId, setLinkPlaceId] = useState('');
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
    if (!(await confirm({ title: 'Remove from this season\'s roster?', description: 'The player is kept and can be added again.', confirmLabel: 'Remove from roster', tone: 'danger' }))) return;
    setBusy(`remove-${place.id}`);
    const { data, error: err } = await supabase.from('roster_memberships').delete().eq('id', place.id).select('id');
    setBusy('');
    if (!err && !data?.length) { report({ code: '42501' }); return; }
    if (report(err, 'Removed from the roster. The player is kept and can join another team.')) { setSelectedPlace(''); setEditing(null); loadRoster(entryId); }
  };

  const deletePlayer = async () => {
    const name = place.player ? `${place.player.first_name} ${place.player.last_name}` : 'this player';
    if (!(await confirm({ title: `Delete ${name} for good?`, description: 'This only works for a player with no other season and no match history.', confirmLabel: 'Delete player', tone: 'danger' }))) return;
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

  const linkRow = roster.find((r) => r.id === linkPlaceId) || null;
  const linkName = linkRow?.player ? `${linkRow.player.first_name} ${linkRow.player.last_name}` : 'this player';
  const editOpen = Boolean(place && editing);
  const sheetOpen = editOpen || adding || Boolean(linkRow);

  const closeEditor = () => { setPortrait('edit', null); setSelectedPlace(''); setEditing(null); setMoveTo(''); };

  const renameTeam = async (event) => {
    event.preventDefault();
    const name = renameText.trim();
    if (name.length < 2 || name.length > 60) { fail('A team name needs 2 to 60 characters.'); return; }
    setBusy('rename-team');
    // The team is one record shared by every season, so the new name applies everywhere it is entered.
    const { data, error: err } = await supabase.from('teams').update({ name }).eq('id', entry.team_id).select('id');
    setBusy('');
    if (!err && !data?.length) { report({ code: '42501' }); return; }
    if (report(err, `Renamed to ${name} in every season.`)) { setRenameText(null); loadEntries(seasonId); }
  };

  // Removes the team's entry from this season only. The team, its other seasons and its players stay. A season with
  // fixtures or players on the roster is refused here, with what to do first.
  const removeFromSeason = async () => {
    setBusy('remove-team');
    const [home, away] = await Promise.all([
      supabase.from('matches').select('id').eq('season_id', seasonId).eq('home_team_id', entry.team_id),
      supabase.from('matches').select('id').eq('season_id', seasonId).eq('away_team_id', entry.team_id),
    ]);
    setBusy('');
    const fixtureError = home.error || away.error;
    if (fixtureError) { report(fixtureError); return; }
    const count = (home.data?.length ?? 0) + (away.data?.length ?? 0);
    if (count) { fail(`${entry.name} has ${count} fixture${count === 1 ? '' : 's'} in ${season?.name}. Cancel them in Fixtures first.`); return; }
    if (roster.length) { fail(`${entry.name} still has ${roster.length} player${roster.length === 1 ? '' : 's'} on this roster. Move or remove them first.`); return; }
    if (!(await confirm({ title: `Remove ${entry.name} from ${season?.name}?`, description: 'The team stays in the division and in its other seasons. Only this season’s entry is removed.', confirmLabel: 'Remove from season', tone: 'danger' }))) return;
    setBusy('remove-team');
    const { data, error: err } = await supabase.from('team_entries').delete().eq('id', entryId).select('id');
    setBusy('');
    if (!err && !data?.length) { report({ code: '42501' }); return; }
    if (report(err, `${entry.name} removed from ${season?.name}.`)) { setEntryId(''); setRoster([]); loadEntries(seasonId); }
  };

  // Messages show inside the open sheet (the page behind it is covered), and at the top of the page otherwise.
  const notices = <div className="space-y-3">
    {error && <Notice tone="error" role="alert">{error}</Notice>}
    {message && <Notice tone="success" role="status">{message}</Notice>}
  </div>;

  const crest = (name) => <Crest name={name} size="sm" />;
  return <div className="space-y-8">
    {!sheetOpen && notices}

    <div className="glass grid gap-4 rounded-card p-5 md:grid-cols-3">
      <Field label="Division">{(p) => <Select {...p} aria-label="Division" value={divisionId} onChange={chooseDivision} disabled={loading.divisions}
        placeholder={loading.divisions ? 'Loading divisions...' : divisions.length ? 'Choose a division' : 'No divisions yet'}
        options={divisions.map((d) => ({ value: d.id, label: d.name }))} />}</Field>
      <Field label="Season">{(p) => <Select {...p} aria-label="Season" value={seasonId} onChange={chooseSeason} disabled={!divisionId || loading.seasons}
        placeholder={loading.seasons ? 'Loading seasons...' : !divisionId ? 'Choose a division first' : seasons.length ? 'Choose a season' : 'This division has no seasons'}
        options={seasons.map((x) => ({ value: x.id, label: `${x.name}${x.is_current ? ' (current)' : ''}` }))} />}</Field>
      <Field label="Team">{(p) => <Combobox {...p} aria-label="Team" value={entryId} onChange={chooseEntry} disabled={!seasonId || loading.entries}
        placeholder={loading.entries ? 'Loading teams...' : !seasonId ? 'Choose a season first' : entries.length ? 'Choose a team' : 'No teams in this season yet'}
        searchPlaceholder="Search teams" options={entries.map((e) => ({ value: e.id, label: e.name, icon: crest(e.name) }))} />}</Field>
    </div>

    {seasonId && !loading.entries && <div className="grid gap-4 md:grid-cols-2">
      <div className="glass flex items-end gap-2 rounded-card p-4">
        <Field label={`Add an existing team to ${season?.name ?? 'the season'}`} className="min-w-0 flex-1">{(p) => <Combobox {...p} aria-label="Existing team" value={teamToAdd} onChange={setTeamToAdd}
          placeholder={teamsNotInSeason.length ? 'Choose a team' : 'Every team of this division is already in the season'} disabled={!teamsNotInSeason.length}
          searchPlaceholder="Search teams" options={teamsNotInSeason.map((t) => ({ value: t.id, label: t.name, icon: crest(t.name) }))} />}</Field>
        <Button variant="secondary" onClick={addExistingTeam} disabled={busy === 'add-team' || !teamsNotInSeason.length}><Plus size={15} aria-hidden="true" />Add team</Button>
      </div>
      <div className="glass flex items-end gap-2 rounded-card p-4">
        <Field label="Or create a new team" className="min-w-0 flex-1">{(p) => <TextInput {...p} icon={Shield} aria-label="New team name" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="Team name" />}</Field>
        <Button variant="secondary" onClick={createTeam} disabled={busy === 'new-team'}>Create team</Button>
      </div>
    </div>}

    {entryId && <section aria-label={`Roster of ${entry?.name}`} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <Crest name={entry?.name} size="lg" />
          <div className="min-w-0">
            <h2 className="font-display text-3xl text-ink">{entry?.name}</h2>
            <p className="text-sm text-mut">{season?.name} · {loading.roster ? 'Loading players...' : `${roster.length} on the roster`}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setRenameText(entry?.name ?? '')} disabled={renameText !== null}><Pencil size={15} aria-hidden="true" />Rename team</Button>
          <Button variant="quiet" size="sm" onClick={removeFromSeason} disabled={busy === 'remove-team'} className="text-live">Remove from season</Button>
          <Button size="sm" onClick={() => { setSearch(''); setAdding(true); }}><UserPlus size={15} aria-hidden="true" />Add player</Button>
        </div>
      </div>

      {renameText !== null && <Card as="form" onSubmit={renameTeam} className="flex flex-wrap items-end gap-2">
        <Field label="Team name" aria-label="Rename team" value={renameText} onChange={(e) => setRenameText(e.target.value)} hint={`Changes the name in every season ${entry?.name ? `${entry.name} is in` : ''}.`} className="min-w-0 flex-1 basis-64" />
        <Button type="submit" disabled={busy === 'rename-team'}>Save name</Button>
        <Button variant="quiet" onClick={() => setRenameText(null)}>Cancel</Button>
      </Card>}

      {linksError && <Notice tone="error" role="alert">The account links could not be loaded ({linksError}).</Notice>}

      {loading.roster ? <p className="text-sm text-mut">Loading players...</p>
        : !roster.length ? <div className="flex flex-col items-start gap-3 rounded-card border border-dashed border-line p-6 text-sm text-mut">
            <Users size={26} aria-hidden="true" />
            <p className="font-display text-xl font-bold text-ink">No players on this roster yet</p>
            Add a player who already exists, or create one with a verified account.
            <Button size="sm" onClick={() => setAdding(true)}><UserPlus size={15} aria-hidden="true" />Add player</Button>
          </div>
          : <ul aria-label="Squad" className="glass divide-y divide-line/70 rounded-card px-3">
            {roster.map((r) => {
              const name = r.player ? `${r.player.first_name} ${r.player.last_name}` : 'Unknown player';
              const linked = links[r.player_id]?.linked === true;
              return <li key={r.id} className="flex items-center gap-3 py-1">
                <button type="button" onClick={() => choosePlace(r.id)} aria-label={`Edit ${name}`} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-ctl px-2 py-2 text-left transition-colors duration-200 ease-out hover:bg-ink/[0.05]">
                  <Crest name={name} src={r.player?.image_url} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-black uppercase tracking-tight text-ink">{name}</span>
                    <span className="block truncate text-sm text-mut">{r.jersey_number != null ? `#${r.jersey_number}` : 'No jersey'} · {r.position || 'No position'} · {linked ? 'Linked' : 'No account'}</span>
                  </span>
                  <span className="chrome font-display text-2xl font-black uppercase tracking-tight tabular-nums text-ink" aria-label="Overall rating">{r.player?.overall_rating ?? '-'}</span>
                </button>
                <Button variant="quiet" size="sm" onClick={() => setLinkPlaceId(r.id)} aria-label={`${linked ? 'Account for' : 'Link account for'} ${name}`}>{linked ? 'Account' : 'Link account'}</Button>
              </li>;
            })}
          </ul>}
    </section>}

    {!divisionId && !loading.divisions && divisions.length > 0 && <p className="text-sm text-mut">Choose a division to see its seasons and teams.</p>}

    {entryId && <div className="space-y-4">
      <AccountMatches onChanged={() => entryId && loadRoster(entryId)} />
      <ManualLink onChanged={() => entryId && loadRoster(entryId)} />
    </div>}

    <p className="text-sm text-mut">Players who have scored or assisted in a season keep their place on that season’s roster, and a player who has played is never deleted.</p>

    <Sheet open={editOpen} onClose={closeEditor} title={place ? `Edit ${place.player ? `${place.player.first_name} ${place.player.last_name}` : 'player'}` : ''}>
      {editOpen && <div className="space-y-5">
        {notices}
        <div className="flex flex-wrap items-start gap-4">
          <FutCard details player={previewPlayer(editing, place.player?.image_url)} portrait={portraits.edit?.membershipId === place.id ? portraits.edit : undefined} />
          {seasonPlace(editing, entry?.name)}
        </div>
        {playerFields(editing, setEditing, 'Edit')}
        <div className="flex flex-wrap gap-2">
          <Button onClick={savePlayer} disabled={busy === `save-${place.id}`}>{busy === `save-${place.id}` ? 'Saving...' : 'Save player'}</Button>
          <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-ctl border border-line bg-raise px-4 text-base font-semibold text-ink hover:border-mut">
            {busy === `portrait-${place.id}` ? 'Uploading portrait...' : 'Change portrait'}
            <input type="file" accept="image/png" className="sr-only" aria-label="Portrait file" onChange={(e) => { uploadPortrait(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {portraits.edit?.status === 'failed' && portraits.edit.membershipId === place.id && <>
            <Button variant="secondary" onClick={() => uploadPortrait(portraits.edit.file)} disabled={busy === `portrait-${place.id}`}>Retry portrait</Button>
            <Button variant="quiet" onClick={() => setPortrait('edit', null)}>Discard picture</Button>
          </>}
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
          <Field label="Move to another team" className="min-w-0 flex-1 basis-48">{(p) => <Select {...p} aria-label="Move to team" value={moveTo} onChange={setMoveTo} placeholder="Choose a team"
            options={entries.filter((e) => e.id !== entryId).map((e) => ({ value: e.id, label: e.name }))} />}</Field>
          <Button variant="secondary" onClick={movePlayer} disabled={busy === `move-${place.id}` || !moveTo}>Move</Button>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={removeFromRoster} disabled={busy === `remove-${place.id}`}>Remove from roster</Button>
          <Button variant="danger" onClick={deletePlayer} disabled={busy === `delete-${place.id}`}>Delete player</Button>
        </div>
      </div>}
    </Sheet>

    <Sheet open={Boolean(linkRow)} onClose={() => setLinkPlaceId('')} title={`Account for ${linkName}`}>
      {linkRow && linkRow.player && <div className="space-y-4">
        {notices}
        <PlayerAccountLink key={linkRow.player_id} player={linkRow.player} status={links[linkRow.player_id] || (linksError ? null : { linked: false })} statusError={linksError} onChanged={() => loadRoster(entryId)} />
      </div>}
    </Sheet>

    <Sheet open={adding} onClose={() => setAdding(false)} title={`Add a player to ${entry?.name ?? 'the team'}`} className="md:w-[520px]">
      {adding && <div className="space-y-6">
        {notices}
        <div role="search" aria-label="Find an existing player" className="space-y-2">
          <Field type="search" label="Add an existing player" hint="Plays in another season or division. First and last name both match." aria-label="Search players" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="First and/or last name" />
          <p aria-live="polite" className="text-sm text-mut">
            {playerSearch.status === 'idle' && search.trim() && 'Type at least two letters of the name.'}
            {playerSearch.status === 'loading' && 'Searching players...'}
            {playerSearch.status === 'ready' && (playerSearch.results.length
              ? `${playerSearch.results.length} player${playerSearch.results.length === 1 ? '' : 's'} found${playerSearch.results.length === 20 ? ' (the first 20; add more of the name to narrow)' : ''}`
              : `No player matches “${search.trim()}”. Create them below.`)}
          </p>
          {playerSearch.status === 'error' && <Notice tone="error" role="alert">The player search failed ({playerSearch.error}). <Button variant="quiet" size="sm" onClick={playerSearch.retry}>Try again</Button></Notice>}
          {playerSearch.status === 'ready' && playerSearch.results.length > 0 && <ul aria-label="Matching players" className="divide-y divide-line rounded-card border border-line">{playerSearch.results.map((p) => {
            const name = `${p.first_name} ${p.last_name}`.trim();
            const context = p.last_team ? `${p.last_team} · ${p.last_season} (${p.last_division})${p.last_jersey != null ? ` · #${p.last_jersey}` : ''}` : 'Not on a roster yet';
            return <li key={p.player_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0"><span className="font-semibold text-ink">{name}</span> <span className="font-display tabular-nums text-mut">OVR {p.overall_rating ?? '-'}</span>
                <span className="block text-sm text-mut">Latest: {context}</span></span>
              {p.in_season
                ? <span className="text-sm text-mut">Already in this season</span>
                : !p.linked
                  ? <span className="text-sm text-mut">No account: link one first</span>
                  : <Button variant="secondary" size="sm" onClick={() => addExistingPlayer(p)} disabled={busy === `add-${p.player_id}`} aria-label={`Add ${name} to ${entry?.name}`}>Add to {entry?.name}</Button>}
            </li>;
          })}</ul>}
        </div>

        <form noValidate onSubmit={createPlayer} aria-label="New player" className="space-y-4 border-t border-line pt-6">
          <h4 className="font-display text-lg font-black uppercase tracking-tight text-ink">Create a new player</h4>
          {!newAccount
            ? <AccountPicker label="1. The new player's verified account" idPrefix="New player" onPick={(acc) => { setNewAccount(acc); setError(''); setMessage(''); }}
              pickLabel={(acc) => (acc.linked_player_id || acc.key_player_id ? 'Use their player' : 'Choose')} />
            : <p className="flex flex-wrap items-center gap-2 text-sm text-ink">Account: <span className="font-semibold">{newAccount.email}</span>
              <Button variant="quiet" size="sm" onClick={() => setNewAccount(null)}>Change</Button></p>}
          {newAccount && (newAccount.linked_player_id || newAccount.key_player_id) && <div role="group" aria-label="Existing player for this account" className="space-y-3 rounded-card border border-line p-3 text-sm">
            <p className="text-ink">{newAccount.linked_player_id
              ? `This account already has a player: ${newAccount.linked_player_name}${newAccount.linked_player_place ? ` (${newAccount.linked_player_place})` : ''}. A person has one player in every season, so add that player instead of creating another.`
              : `${newAccount.key_player_name}${newAccount.key_player_place ? ` (${newAccount.key_player_place})` : ''} is waiting for this account (the same email). Link that player and add them instead of creating another.`}</p>
            <Button onClick={() => addAccountPlayer(newAccount)} disabled={busy === 'add-account-player'}>
              {newAccount.linked_player_id ? `Add ${newAccount.linked_player_name} to ${entry?.name}` : `Link ${newAccount.key_player_name} and add to ${entry?.name}`}
            </Button>
          </div>}
          {newAccount && !newAccount.linked_player_id && !newAccount.key_player_id && <>
            <div className="flex flex-wrap items-start gap-4">
              <FutCard details player={previewPlayer(newPlayer, null)} portrait={portraits.new?.status === 'local' ? portraits.new : undefined} />
              <div className="space-y-2">
                {seasonPlace(newPlayer, entry?.name)}
                <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-ctl border border-line bg-raise px-4 text-sm font-semibold text-ink hover:border-mut">
                  {portraits.new?.status === 'local' ? 'Change picture' : 'Choose portrait (500 × 500 PNG)'}
                  <input type="file" accept="image/png" className="sr-only" aria-label="New portrait file" onChange={(e) => {
                    const file = e.target.files?.[0]; e.target.value = '';
                    if (file) setPortrait('new', { file, url: URL.createObjectURL(file), status: 'local' });
                  }} />
                </label>
                {portraits.new?.status === 'local' && <Button variant="quiet" size="sm" onClick={() => setPortrait('new', null)}>Remove picture</Button>}
                <p className="text-sm text-mut">The picture uploads when the player is created.</p>
              </div>
            </div>
            {playerFields(newPlayer, setNewPlayer, 'New')}
            <Button type="submit" disabled={busy === 'create-player'}>{busy === 'create-player' ? 'Creating...' : 'Create player'}</Button>
          </>}
          {portraits.new?.status === 'failed' && <div role="group" aria-label="New player portrait" className="flex flex-wrap items-center gap-2 rounded-card border border-line p-3 text-sm text-live">
            The portrait for {portraits.new.name} is not saved.
            {portraits.new.membershipId && <Button variant="secondary" size="sm" onClick={() => uploadNewPortrait(portraits.new).then((ok) => ok && (report(null, `Portrait saved for ${portraits.new.name}.`), loadRoster(entryId)))} disabled={busy === 'new-portrait'}>Retry portrait upload</Button>}
            <Button variant="quiet" size="sm" onClick={() => setPortrait('new', null)}>Discard picture</Button>
          </div>}
        </form>
      </div>}
    </Sheet>
  </div>;
}
