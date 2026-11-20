import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ImagePlus, Loader2, Save, Shield, UploadCloud, Users, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { getPlayStyle, PLAY_STYLES } from '../data/playStyles';
import { CARD_STATS, FEET, applyCardDraft, cardDraft } from '../lib/playerCard';
import { API_BASE_URL } from '../lib/api';
import { rosterPlayerRpcArgs } from '../lib/rosterPlayerUpdate';
import './TeamBuilder.css';
import './TeamBranding.css';

const API_URL = API_BASE_URL;
const positions = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST'];

const getPlayStyleId = (name) => PLAY_STYLES.find((style) => style.name.toLowerCase() === name?.replace(/\+$/, '').toLowerCase())?.id || '';

// A roster place as the form edits it. Card fields come from the canonical attributes; anything not set stays empty
// (no default foot, no generated stats or rating). `saved` records what was loaded, so only changed players are saved.
const editable = (p) => JSON.stringify([p.position, p.jerseyNumber, p.imageUrl, p.overallRating, p.preferredFoot, p.playStyleId, p.stats]);
export const fromMember = (member) => {
    const card = cardDraft(member.attributes);
    const player = {
        id: member.id,
        fullName: member.name || [member.first_name, member.last_name].filter(Boolean).join(' '),
        position: member.position || '',
        jerseyNumber: member.jersey_number ?? '',
        imageUrl: member.image_url || '',
        preferredFoot: card.preferredFoot,
        playStyleId: getPlayStyleId(card.playStyle),
        overallRating: member.overall_rating == null ? '' : String(member.overall_rating),
        attributes: member.attributes || {},
        stats: card.stats,
    };
    return { ...player, saved: editable(player) };
};

// The attributes to save for an edited player: the stored card with the form's values applied (one play style, or
// none).
export const attributesForSave = (player) => applyCardDraft(player.attributes, {
    stats: player.stats, preferredFoot: player.preferredFoot, playStyle: getPlayStyle(player.playStyleId)?.name || '',
});
export const isChanged = (player) => editable(player) !== player.saved;

function PlayStylePicker({ value, onChange }) {
    const style = getPlayStyle(value);
    return <div className="team-builder-playstyle">
        <label>PlayStyle
            <select value={value} onChange={(event) => onChange(event.target.value)}>
                <option value="">Choose a PlayStyle</option>
                {PLAY_STYLES.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
        </label>
        {style ? <div className="team-builder-playstyle-preview">
            <img src={style.imageUrl} alt={`${style.name} PlayStyle`} />
            <div><strong>{style.name}</strong><p>{style.description}</p></div>
        </div> : <p className="team-builder-playstyle-hint">Select a PlayStyle to preview its icon and ability.</p>}
    </div>;
}

// The roster of a registration's team in its season: each roster place with the player's card. The id used for
// saving is the roster place (captain_update_roster_player checks that it belongs to the captain's team and season).
// The team's own name (the registration keeps an older copy that can differ, so it is never shown).
const teamLabel = (registration) => registration?.team?.name || 'Your team';

export async function loadRoster(registration) {
    if (!registration?.team_id || !registration?.season_id) return [];
    const { data: entry, error: entryError } = await supabase
        .from('team_entries')
        .select('id')
        .eq('team_id', registration.team_id)
        .eq('season_id', registration.season_id)
        .maybeSingle();
    if (entryError) throw entryError;
    if (!entry) return [];
    const { data, error } = await supabase
        .from('roster_memberships')
        .select('id, jersey_number, position, player:players(id, first_name, last_name, image_url, overall_rating, attributes)')
        .eq('team_entry_id', entry.id)
        .order('jersey_number', { ascending: true });
    if (error) throw error;
    return (data || []).filter((place) => place.player).map((place) => ({
        id: place.id,
        player_id: place.player.id,
        first_name: place.player.first_name,
        last_name: place.player.last_name,
        position: place.position,
        jersey_number: place.jersey_number,
        image_url: place.player.image_url,
        overall_rating: place.player.overall_rating,
        attributes: place.player.attributes,
    }));
}

// A team context the builder works on: a team in a season, with the signed-in user's own captain assignment for it if
// they have one (only then may the team's details be changed here). Captains get their own assignments; dictators
// pick any team.
const SEASON_FIELDS = 'id, name, is_current, status, archived_at, division:divisions(id, name)';
// A captain writes only while the season is current or upcoming and not completed or archived (D-03 addendum); the
// database says the same. A completed or archived season opens read-only.
const seasonReadOnly = (season) => Boolean(season) && (season.status === 'completed' || season.archived_at != null);

export function TeamBuilder() {
    const { user, hasRole } = useAuth();
    // Dictator first: a dictator keeps dictator access even when they also captain a team.
    const isDictator = hasRole('dictator');
    const [registration, setRegistration] = useState(null);
    const [registrations, setRegistrations] = useState([]);
    const [players, setPlayers] = useState([]);
    const [activePlayer, setActivePlayer] = useState(0);
    const [activeTab, setActiveTab] = useState('basic');
    const [loading, setLoading] = useState(true);
    const [rosterLoading, setRosterLoading] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [saving, setSaving] = useState(false);
    const [teamLogoFile, setTeamLogoFile] = useState(null);
    const [teamColor, setTeamColor] = useState('#ffffff');
    const [teamName, setTeamName] = useState('');
    const [shortName, setShortName] = useState('');
    const [teamColorSelected, setTeamColorSelected] = useState(false);
    const [savingBranding, setSavingBranding] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [brandingModalOpen, setBrandingModalOpen] = useState(false);
    const [brandingError, setBrandingError] = useState('');
    const [brandingSuccess, setBrandingSuccess] = useState('');
    // Dictator selection: division -> season -> team, as in Teams & Rosters.
    const [divisions, setDivisions] = useState([]);
    const [divisionId, setDivisionId] = useState('');
    const [seasons, setSeasons] = useState([]);
    const [seasonId, setSeasonId] = useState('');
    const [teams, setTeams] = useState([]);
    const [teamId, setTeamId] = useState('');
    const [picking, setPicking] = useState({ seasons: false, teams: false });
    const latestRegistration = useRef(null);
    const latestPick = useRef({ seasons: 0, teams: 0 });
    const entryByTeam = useRef({}); // the chosen season's team entries, by team (the dictator's choice)
    // A captain edits only a current or upcoming season; a completed season of their own team opens read-only.
    const readOnly = !isDictator && seasonReadOnly(registration?.season);

    // Loads the context's roster; only the latest choice may fill it (a late answer for an earlier choice is ignored).
    const openContext = (context) => {
        setRegistration(context);
        setPlayers([]);
        setActivePlayer(0);
        setActiveTab('basic');
        setTeamLogoFile(null);
        setTeamColor(context?.team?.team_color || '#ffffff');
        setTeamName(context?.team?.name || '');
        setShortName(context?.team?.short_name || '');
        setTeamColorSelected(Boolean(context?.team?.team_color));
        setError(''); setSuccess(''); setBrandingError(''); setBrandingSuccess('');
        const key = context?.id ?? null;
        latestRegistration.current = key;
        if (!context) { setRosterLoading(false); return; }
        setRosterLoading(true);
        loadRoster(context)
            .then((roster) => { if (latestRegistration.current === key) setPlayers(roster.map(fromMember)); })
            .catch((rosterError) => { if (latestRegistration.current === key) { setPlayers([]); setError(rosterError.message || 'Could not load the roster.'); } })
            .finally(() => { if (latestRegistration.current === key) setRosterLoading(false); });
    };

    const teamsById = async (ids) => {
        if (!ids.length) return {};
        const { data: rows, error: teamsError } = await supabase.from('teams').select('id, name, short_name, logo_url, team_color').in('id', ids);
        if (teamsError) setError(teamsError.message);
        return Object.fromEntries((rows || []).map((team) => [team.id, team]));
    };

    useEffect(() => {
        let cancelled = false;
        const start = async () => {
            if (!user?.id) return;
            // The user's own captain assignments (any number): a captain's team entries, or the ones a dictator also captains.
            const { data: assigned, error: ownError } = await supabase
                .from('captain_assignments')
                .select(`id, team_entry:team_entries!inner(id, team_id, season_id, season:seasons(${SEASON_FIELDS}))`)
                .eq('user_id', user.id);
            if (cancelled) return;
            if (ownError) setError(ownError.message);
            const own = (assigned || []).filter((a) => a.team_entry).map((a) => ({
                id: a.id, team_entry_id: a.team_entry.id, team_id: a.team_entry.team_id, season_id: a.team_entry.season_id, season: a.team_entry.season,
            }));
            const byId = await teamsById(own.map((r) => r.team_id).filter(Boolean));
            if (cancelled) return;
            const mine = own.map((r) => ({ ...r, registrationId: r.id, team: byId[r.team_id] || null }))
                .sort((a, b) => Number(b.season?.is_current === true) - Number(a.season?.is_current === true) || teamLabel(a).localeCompare(teamLabel(b)));
            setRegistrations(mine);
            if (isDictator) {
                const { data: rows, error: divisionsError } = await supabase.from('divisions').select('id, name').order('sort_order', { ascending: true });
                if (cancelled) return;
                if (divisionsError) setError(divisionsError.message);
                setDivisions(rows || []);
                setLoading(false);
                // Start on the dictator's own current team if they captain one.
                const preferred = mine.find((r) => r.season?.is_current);
                if (preferred?.season?.division?.id) {
                    setDivisionId(preferred.season.division.id);
                    await loadSeasons(preferred.season.division.id);
                    setSeasonId(preferred.season_id);
                    await loadTeams(preferred.season_id);
                    setTeamId(preferred.team_id);
                    openContext(preferred);
                }
                return;
            }
            setLoading(false);
            openContext(mine[0] || null);
        };
        start();
        return () => { cancelled = true; };
    }, [user?.id, isDictator]); // eslint-disable-line react-hooks/exhaustive-deps

    const loadSeasons = async (dId) => {
        const n = ++latestPick.current.seasons;
        setPicking((p) => ({ ...p, seasons: true }));
        const { data, error: err } = await supabase.from('seasons').select('id, name, is_current').eq('division_id', dId).order('sort_order', { ascending: true });
        if (n !== latestPick.current.seasons) return;
        if (err) setError(err.message);
        setSeasons(data || []);
        setPicking((p) => ({ ...p, seasons: false }));
    };
    const loadTeams = async (sId) => {
        const n = ++latestPick.current.teams;
        setPicking((p) => ({ ...p, teams: true }));
        const { data: entries, error: err } = await supabase.from('team_entries').select('id, team_id').eq('season_id', sId);
        const byId = await teamsById((entries || []).map((e) => e.team_id));
        entryByTeam.current = Object.fromEntries((entries || []).map((e) => [e.team_id, e.id]));
        if (n !== latestPick.current.teams) return;
        if (err) setError(err.message);
        setTeams(Object.values(byId).sort((a, b) => a.name.localeCompare(b.name)));
        setPicking((p) => ({ ...p, teams: false }));
    };
    const chooseDivision = (id) => {
        setDivisionId(id); setSeasons([]); setSeasonId(''); setTeams([]); setTeamId('');
        latestPick.current.seasons += 1; latestPick.current.teams += 1; openContext(null);
        if (id) loadSeasons(id);
    };
    const chooseSeason = (id) => {
        setSeasonId(id); setTeams([]); setTeamId('');
        latestPick.current.teams += 1; openContext(null);
        if (id) loadTeams(id);
    };
    const chooseTeam = (id) => {
        setTeamId(id);
        if (!id) { openContext(null); return; }
        const season = seasons.find((x) => x.id === seasonId);
        const division = divisions.find((d) => d.id === divisionId);
        const own = registrations.find((r) => r.team_id === id && r.season_id === seasonId);
        openContext({
            id: own?.id || `${id}:${seasonId}`, registrationId: own?.id || null, team_entry_id: entryByTeam.current[id] || null, team_id: id, season_id: seasonId,
            season: { ...season, division }, team: teams.find((t) => t.id === id) || null,
        });
    };

    const currentPlayer = players[activePlayer];
    const selectRegistration = (registrationId) => openContext(registrations.find((item) => item.id === registrationId) || null);
    const updatePlayer = (field, value) => setPlayers((current) => current.map((player, index) => index === activePlayer ? { ...player, [field]: value } : player));
    const updateStat = (stat, value) => updatePlayer('stats', { ...currentPlayer.stats, [stat]: value });

    const handleLogoChange = (event) => {
        const file = event.target.files?.[0];
        if (!file) {
            setTeamLogoFile(null);
            return;
        }

        setError('');
        setBrandingError('');
        const setBrandErr = (msg) => {
            if (brandingModalOpen) setBrandingError(msg);
            else setError(msg);
        };

        if (file.type !== 'image/png') {
            setBrandErr('Club logo must be in PNG format.');
            setTeamLogoFile(null);
            event.target.value = '';
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            setBrandErr('Club logo must be no larger than 5 MB.');
            setTeamLogoFile(null);
            event.target.value = '';
            return;
        }

        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            if (img.naturalWidth !== 256 || img.naturalHeight !== 256) {
                setBrandErr(`Club logo must be exactly 256x256 pixels (selected image is ${img.naturalWidth}x${img.naturalHeight}px). Uploads cannot be auto-cropped; please provide a 256x256 PNG.`);
                setTeamLogoFile(null);
                event.target.value = '';
                return;
            }
            setTeamLogoFile(file);
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            setBrandErr('Could not read the selected image file.');
            setTeamLogoFile(null);
            event.target.value = '';
        };
        img.src = objectUrl;
    };

    const handleBrandingSubmit = async (event) => {
        event.preventDefault();
        if (!registration?.registrationId || readOnly) return; // team details need the user's own writable assignment
        setError('');
        setSuccess('');
        setBrandingError('');
        setBrandingSuccess('');
        const setBrandErr = (msg) => {
            if (brandingModalOpen) setBrandingError(msg);
            else setError(msg);
        };

        if (!teamLogoFile && !registration?.team?.logo_url) {
            setBrandErr('Upload your team logo before continuing.');
            return;
        }
        if (teamLogoFile && teamLogoFile.type !== 'image/png') {
            setBrandErr('Club logo must be in PNG format.');
            return;
        }
        if (!registration?.team?.team_color && !teamColorSelected) {
            setBrandErr('Choose your team color before continuing.');
            return;
        }

        setSavingBranding(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const formData = new FormData();
            formData.append('team_entry_id', registration.team_entry_id);
            formData.append('team_color', teamColor);
            if (teamName.trim() && teamName.trim() !== registration.team?.name) formData.append('team_name', teamName.trim());
            if (shortName.trim() !== (registration.team?.short_name || '')) formData.append('short_name', shortName.trim());
            if (teamLogoFile) formData.append('logo', teamLogoFile);

            const response = await fetch(`${API_URL}/captain/team-branding`, {
                method: 'POST',
                credentials: 'include',
                headers: { Authorization: `Bearer ${session?.access_token || ''}` },
                body: formData,
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not save team details.');

            setRegistration((current) => ({
                ...current,
                team: { ...current.team, ...result.data },
            }));
            setTeamLogoFile(null);
            setTeamColorSelected(true);
            setSuccess('Team details saved.');
            setBrandingSuccess('Team details saved.');
            setTimeout(() => {
                setBrandingModalOpen(false);
                setBrandingSuccess('');
            }, 1000);
        } catch (saveError) {
            setBrandErr(saveError.message || 'Could not save team branding.');
        } finally {
            setSavingBranding(false);
        }
    };

    const handleImageUpload = async (event) => {
        if (readOnly) return;
        const file = event.target.files?.[0];
        if (!file) return;
        
        setUploadingImage(true);
        setError('');
        try {
            if (!file.type.includes('png') && !file.name.toLowerCase().endsWith('.png')) {
                throw new Error('Player image must be in PNG format (.png). Please convert and upload a PNG file.');
            }

            const sourceUrl = URL.createObjectURL(file);
            const image = new Image();
            image.src = sourceUrl;
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => reject(new Error('Could not open that image file.'));
            });

            const width = image.width;
            const height = image.height;
            URL.revokeObjectURL(sourceUrl);

            if (width !== 500 || height !== 500) {
                throw new Error(`Player image must be exactly 500 × 500 pixels (selected image is ${width} × ${height}). Please resize and upload again.`);
            }

            const formData = new FormData();
            formData.append('membership_id', currentPlayer.id);
            formData.append('image', file, 'portrait.png');

            const { data: { session } } = await supabase.auth.getSession();
            const response = await fetch(`${API_URL}/admin/freshers/player-image`, {
                method: 'POST',
                credentials: 'include',
                headers: { Authorization: `Bearer ${session?.access_token}` },
                body: formData,
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.message || result.error || 'Failed to upload player image.');

            updatePlayer('imageUrl', result.imageUrl);
            setSuccess(`Image uploaded successfully for ${currentPlayer.fullName}!`);
        } catch (uploadError) {
            setError(uploadError.message || 'Could not upload player image.');
        } finally {
            setUploadingImage(false);
            event.target.value = '';
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (readOnly) return;
        setError('');
        setSuccess('');

        // Only changed players are saved, so nothing unedited is rewritten. An empty rating stays "not set"; a rating
        // that is set must be 1..99. Nothing is filled in.
        const changed = players.filter(isChanged);
        if (!changed.length) { setSuccess('No changes to save.'); return; }
        for (const player of changed) {
            const rating = Number(player.overallRating);
            if (player.overallRating !== '' && (!Number.isInteger(rating) || rating < 1 || rating > 99)) { setError(`The overall rating for ${player.fullName} must be between 1 and 99, or left empty.`); return; }
            const attributes = attributesForSave(player);
            if (attributes.error) { setError(`${player.fullName}: ${attributes.error}`); return; }
        }
        setSaving(true);
        try {
            for (const player of changed) {
                // The database decides who may change what. There is deliberately no direct-update fallback:
                // captains have no write access to players or rosters, so a fallback would change nothing yet still
                // report success.
                const attributes = attributesForSave(player).value;
                const { error: rpcError } = await supabase.rpc('captain_update_roster_player', rosterPlayerRpcArgs(player, attributes));
                if (rpcError) throw rpcError;
                setPlayers((current) => current.map((p) => (p.id === player.id ? fromMember({
                    id: p.id, name: p.fullName, position: p.position, jersey_number: p.jerseyNumber, image_url: p.imageUrl,
                    overall_rating: p.overallRating === '' ? null : Number(p.overallRating), attributes,
                }) : p)));
            }
            setSuccess('Player profiles and images saved successfully.');
        } catch (saveError) {
            setError(saveError.message || 'Could not save player profiles.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="min-h-screen bg-black" />;

    const dictatorPicker = isDictator && <div className="team-builder-grid" aria-label="Choose a team">
        <label>Division<select aria-label="Division" value={divisionId} onChange={(event) => chooseDivision(event.target.value)}>
            <option value="">{divisions.length ? 'Choose a division' : 'No divisions yet'}</option>
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select></label>
        <label>Season<select aria-label="Season" value={seasonId} disabled={!divisionId || picking.seasons} onChange={(event) => chooseSeason(event.target.value)}>
            <option value="">{picking.seasons ? 'Loading seasons...' : divisionId && !seasons.length ? 'This division has no seasons' : 'Choose a season'}</option>
            {seasons.map((x) => <option key={x.id} value={x.id}>{x.name}{x.is_current ? ' (current)' : ''}</option>)}
        </select></label>
        <label>Team<select aria-label="Team" value={teamId} disabled={!seasonId || picking.teams} onChange={(event) => chooseTeam(event.target.value)}>
            <option value="">{picking.teams ? 'Loading teams...' : seasonId && !teams.length ? 'No teams in this season' : 'Choose a team'}</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>
    </div>;
    const captainPicker = !isDictator && registrations.length > 1 && <label>Your team<select aria-label="Your team" value={registration?.id || ''} onChange={(event) => selectRegistration(event.target.value)}>
        {registrations.map((item) => <option key={item.id} value={item.id}>{teamLabel(item)} · {item.season?.division?.name} {item.season?.name}{item.season?.is_current ? '' : ' (past season, read only)'}</option>)}
    </select></label>;
    const workspace = isDictator ? 'Dictator workspace' : 'Captain workspace';

    if (!registration) return <main className="team-builder">
        <Link to="/" className="team-builder-back"><ArrowLeft size={16} /> Back to tournaments</Link>
        {isDictator
            ? <div className="team-builder-shell"><div className="team-builder-heading"><Users size={28} /><p>{workspace}</p><h1>Choose a<br /><em>team.</em></h1><span>Pick a division, season and team to manage its roster.</span></div>{dictatorPicker}{error && <p role="alert" className="team-builder-error">{error}</p>}</div>
            : <div className="team-builder-empty"><Users size={32} /><p>{workspace}</p><h1>No squad<br /><em>assigned.</em></h1><span>A dictator will assign your team and roster here.</span>{error && <p className="team-builder-error">{error}</p>}</div>}
    </main>;

    if ((!registration.team?.logo_url || !registration.team?.team_color) && !isDictator && registration.registrationId && !readOnly) return <main className="team-builder">
        <Link to="/" className="team-builder-back"><ArrowLeft size={16} /> Back to tournaments</Link>
        <div className="team-builder-shell">
            <div className="team-builder-heading"><Shield size={28} /><p>Captain workspace / {registration.season?.division?.name} {registration.season?.name}</p><h1>Brand your<br /><em>team.</em></h1><span>Set your team identity before entering the Team Builder.</span></div>
            <form onSubmit={handleBrandingSubmit} className="team-builder-form team-builder-brand-form">
                <div className="team-builder-brand-preview" style={{ borderColor: teamColor }}>
                    {teamLogoFile ? <span>{teamLogoFile.name}</span> : registration.team?.logo_url ? <img src={registration.team.logo_url} alt={`${teamLabel(registration)} logo`} /> : <Shield size={38} />}
                    <strong>{teamLabel(registration)}</strong>
                </div>
                <label>Team logo (Required)
                    <input type="file" accept="image/png" required={!registration.team?.logo_url} onChange={handleLogoChange} />
                </label>
                <span className="team-builder-brand-hint">PNG only, exactly 256x256 px; maximum file size 5 MB. Cropping is disabled.</span>
                <label className="team-builder-color-label">Team color (Required)
                    <span className="team-builder-color-picker">
                        <input type="color" value={teamColor} onChange={(event) => { setTeamColor(event.target.value); setTeamColorSelected(true); }} aria-label="Choose your team's color" />
                        <span>{teamColor.toUpperCase()}</span>
                    </span>
                </label>
                {(error || success) && <p className={error ? 'team-builder-error' : 'team-builder-success'}>{error || success}</p>}
                <button className="team-builder-submit" type="submit" disabled={savingBranding}>
                    {savingBranding ? <><Loader2 size={18} className="animate-spin" /> Saving team identity...</> : <><UploadCloud size={18} /> Save team identity</>}
                </button>
            </form>
        </div>
    </main>;

    if (!players.length) return <main className="team-builder">
        <Link to="/" className="team-builder-back"><ArrowLeft size={16} /> Back to tournaments</Link>
        {dictatorPicker}{captainPicker}
        <div className="team-builder-empty"><Shield size={32} /><p>{teamLabel(registration)}</p>{rosterLoading
            ? <><h1>Loading<br /><em>roster.</em></h1><span>Loading the roster...</span></>
            : error
            ? <><h1>Roster<br /><em>unavailable.</em></h1><span role="alert" className="team-builder-error">The roster could not be loaded: {error}</span></>
            : <><h1>Roster<br /><em>pending.</em></h1><span>{isDictator ? 'No players on this roster yet. Add them in Teams & Rosters.' : 'Your dictator is forming the player roster.'}</span></>}</div>
    </main>;

    return <main className="team-builder">
        <Link to="/" className="team-builder-back"><ArrowLeft size={16} /> Back to tournaments</Link>
        <div className="team-builder-shell team-builder-shell-wide">
            <div className="team-builder-heading">
                <Users size={28} />
                <p>{workspace} / {registration.season?.division?.name} {registration.season?.name}</p>
                <h1>Set your<br /><em>lineup.</em></h1>
                <span>Set positions, ratings, and images for {teamLabel(registration)}.</span>

                <div className="team-builder-identity-badge" style={{ borderLeftColor: registration.team?.team_color || '#d9ff4a' }}>
                    {registration.team?.logo_url ? (
                        <img src={registration.team.logo_url} alt={`${teamLabel(registration)} logo`} />
                    ) : (
                        <Shield size={28} />
                    )}
                    <div className="team-builder-identity-info">
                        <strong>{teamLabel(registration)}</strong>
                        <span>Color: {registration.team?.team_color || '#FFFFFF'}</span>
                    </div>
                    {registration.registrationId && !readOnly && (
                        <button
                            type="button"
                            onClick={() => {
                                setBrandingModalOpen(true);
                                setBrandingError('');
                                setBrandingSuccess('');
                                setTeamLogoFile(null);
                            }}
                            className="team-builder-identity-edit-btn"
                        >
                            <Shield size={14} /> Change Logo
                        </button>
                    )}
                </div>
            </div>
            <form onSubmit={handleSubmit} className="team-builder-form">
                {dictatorPicker}{captainPicker}
                {readOnly && <p className="team-builder-brand-hint">This is a past season: captains can view it but not change it.</p>}
                <div className="team-builder-player-nav"><div className="team-builder-player-tabs">{players.map((player, index) => <button type="button" key={player.id} onClick={() => { setActivePlayer(index); setActiveTab('basic'); }} className={index === activePlayer ? 'is-active' : ''}>{String(index + 1).padStart(2, '0')} {player.fullName || 'Player'}</button>)}</div></div>
                <fieldset disabled={readOnly} className="team-builder-preview-fieldset">
                <div className="team-builder-card">
                    <div className="team-builder-card-head"><div><p>{currentPlayer?.fullName}</p><span>{currentPlayer?.jerseyNumber ? `#${currentPlayer.jerseyNumber}` : 'No jersey number yet'}{currentPlayer?.position ? ` · ${currentPlayer.position}` : ''}</span></div></div>
                    <div className="team-builder-form-tabs"><button type="button" onClick={() => setActiveTab('basic')} className={activeTab === 'basic' ? 'is-active' : ''}>Position & Details</button><button type="button" onClick={() => setActiveTab('bio')} className={activeTab === 'bio' ? 'is-active' : ''}>Bio & Playstyle</button><button type="button" onClick={() => setActiveTab('stats')} className={activeTab === 'stats' ? 'is-active' : ''}>Attributes</button></div>
                    {activeTab === 'basic' && <div className="team-builder-grid team-builder-basic">
                        <label>Player<select value={activePlayer} onChange={(event) => setActivePlayer(Number(event.target.value))}>{players.map((player, index) => <option key={player.id} value={index}>{player.fullName}</option>)}</select></label>
                        <label>Position (Mandatory)<select value={currentPlayer.position} onChange={(event) => updatePlayer('position', event.target.value)}><option value="">Choose position</option>{positions.map((position) => <option key={position}>{position}</option>)}</select></label>
                        <label>Jersey number<input type="number" min="0" max="99" value={currentPlayer.jerseyNumber} onChange={(event) => updatePlayer('jerseyNumber', event.target.value)} /></label>
                        <label>Overall rating<input type="number" min="1" max="99" placeholder="Not set" value={currentPlayer.overallRating} onChange={(event) => updatePlayer('overallRating', event.target.value)} /></label>
                        
                        <div className="col-span-2 space-y-2">
                            <label className="block">Player Image (Mandatory for Captain)</label>
                            <div className="flex items-center gap-4">
                                {currentPlayer.imageUrl ? (
                                    <img src={currentPlayer.imageUrl} alt={currentPlayer.fullName} className="w-16 h-16 rounded-lg object-cover border border-[#d9ff4a]" />
                                ) : (
                                    <div className="w-16 h-16 rounded-lg bg-white/5 border border-dashed border-white/20 flex items-center justify-center text-zinc-500 text-xs">No image</div>
                                )}
                                <label className="flex-1 cursor-pointer flex items-center gap-2 px-4 py-3 bg-[#191c1d] border border-[#303536] hover:border-[#d9ff4a] rounded-lg text-xs font-bold text-zinc-300 uppercase tracking-wider transition-colors">
                                    {uploadingImage ? <Loader2 size={16} className="animate-spin text-[#d9ff4a]" /> : <ImagePlus size={16} className="text-[#d9ff4a]" />}
                                    <span>{uploadingImage ? 'Uploading to Cloudflare...' : (currentPlayer.imageUrl ? 'Change Image' : 'Upload Image')}</span>
                                    <input type="file" accept="image/png" onChange={handleImageUpload} disabled={uploadingImage} hidden />
                                </label>
                            </div>
                            <span className="text-[10px] text-zinc-500">Must be a PNG format file with exact 500 × 500 resolution</span>
                        </div>
                    </div>}
                    {activeTab === 'bio' && <div className="team-builder-grid"><label>Preferred foot<select value={currentPlayer.preferredFoot} onChange={(event) => updatePlayer('preferredFoot', event.target.value)}><option value="">Not set</option>{FEET.map((foot) => <option key={foot}>{foot}</option>)}</select></label><PlayStylePicker value={currentPlayer.playStyleId} onChange={(value) => updatePlayer('playStyleId', value)} /></div>}
                    {activeTab === 'stats' && <div className="team-builder-stats">{CARD_STATS.map(({ key }) => <label key={key}>{key}<input type="number" min="1" max="99" placeholder="Not set" value={currentPlayer.stats[key]} onChange={(event) => updateStat(key, event.target.value)} /></label>)}</div>}
                </div>
                {(error || success) && <p className={error ? 'team-builder-error' : 'team-builder-success'}>{error || success}</p>}
                <button className="team-builder-submit" type="submit" disabled={saving}>{saving ? 'Saving player profiles...' : <><Save size={18} /> Save player profiles</>}</button>
                </fieldset>
            </form>
        </div>

        {brandingModalOpen && (
            <div className="team-builder-modal-backdrop" onClick={() => !savingBranding && setBrandingModalOpen(false)}>
                <div className="team-builder-modal-card" onClick={(e) => e.stopPropagation()}>
                    <div className="team-builder-modal-head">
                        <h2><Shield size={18} className="text-[#d9ff4a]" /> Team details</h2>
                        <button type="button" onClick={() => !savingBranding && setBrandingModalOpen(false)} aria-label="Close modal">
                            <X size={20} />
                        </button>
                    </div>
                    <form onSubmit={handleBrandingSubmit} className="team-builder-form team-builder-brand-form">
                        <div className="team-builder-brand-preview" style={{ borderColor: teamColor }}>
                            {teamLogoFile ? (
                                <span>{teamLogoFile.name} (Selected)</span>
                            ) : registration.team?.logo_url ? (
                                <img src={registration.team.logo_url} alt={`${teamLabel(registration)} logo`} />
                            ) : (
                                <Shield size={38} />
                            )}
                            <strong>{teamLabel(registration)}</strong>
                        </div>
                        <label>Team name
                            <input type="text" value={teamName} maxLength={60} onChange={(event) => setTeamName(event.target.value)} aria-label="Team name" />
                        </label>
                        <label>Short name
                            <input type="text" value={shortName} maxLength={5} onChange={(event) => setShortName(event.target.value)} aria-label="Short name" />
                        </label>
                        <label>New team logo
                            <input
                                type="file"
                                accept="image/png"
                                onChange={handleLogoChange}
                            />
                        </label>
                        <span className="team-builder-brand-hint">PNG only, exactly 256x256 px; maximum file size 5 MB. Cropping is disabled.</span>
                        <label className="team-builder-color-label">Team color
                            <span className="team-builder-color-picker">
                                <input
                                    type="color"
                                    value={teamColor}
                                    onChange={(event) => {
                                        setTeamColor(event.target.value);
                                        setTeamColorSelected(true);
                                    }}
                                    aria-label="Choose your team's color"
                                />
                                <span>{teamColor.toUpperCase()}</span>
                            </span>
                        </label>
                        {(brandingError || brandingSuccess) && (
                            <p className={brandingError ? 'team-builder-error' : 'team-builder-success'}>
                                {brandingError || brandingSuccess}
                            </p>
                        )}
                        <div className="flex gap-3 mt-2">
                            <button
                                className="team-builder-submit flex-1"
                                type="submit"
                                disabled={savingBranding}
                            >
                                {savingBranding ? (
                                    <><Loader2 size={18} className="animate-spin" /> Saving identity...</>
                                ) : (
                                    <><UploadCloud size={18} /> Update Logo & Color</>
                                )}
                            </button>
                            <button
                                type="button"
                                className="px-4 py-2 border border-[#303536] bg-[#191c1d] hover:bg-[#252a2b] text-zinc-300 rounded text-xs font-bold uppercase tracking-wider transition-colors"
                                onClick={() => setBrandingModalOpen(false)}
                                disabled={savingBranding}
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        )}
    </main>;
}
