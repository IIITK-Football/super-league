import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { getPlayStyle, PLAY_STYLES } from '../data/playStyles';
import { CARD_STATS, FEET, applyCardDraft, cardDraft } from '../lib/playerCard';
import { API_BASE_URL } from '../lib/api';
import { rosterPlayerRpcArgs } from '../lib/rosterPlayerUpdate';
import { Button, Card, EmptyState, ErrorState, Crest, Field, Notice, Sheet, Skeleton, Tabs, useConfirm } from '../components/ui';

const API_URL = API_BASE_URL;
const positions = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST'];
const MB = 1024 * 1024;

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

// The image checks mirror the API: a club logo is a 256 x 256 PNG of at most 5 MB; a player portrait is a 500 x 500
// PNG of at most 5 MB. The size is read from the file itself, so a renamed file is judged by what it is.
function readImageSize(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image file.')); };
        img.src = url;
    });
}

async function imageProblem(file, { label, side }) {
    if (file.type !== 'image/png') return `${label} must be a PNG file.`;
    if (file.size > 5 * MB) return `${label} must be 5 MB or smaller.`;
    try {
        const { width, height } = await readImageSize(file);
        if (width !== side || height !== side) return `${label} must be ${side} × ${side} pixels (this one is ${width} × ${height}). Crop it first; uploads are not cropped.`;
        return null;
    } catch (error) {
        return error.message;
    }
}
const logoProblem = (file) => imageProblem(file, { label: 'Club logo', side: 256 });
const portraitProblem = (file) => imageProblem(file, { label: 'Player image', side: 500 });

const messageOf = (error, fallback) => error?.message || fallback;

// Previews a chosen file (or shows the saved image) as a thumbnail, and gives a labelled file input that the keyboard
// can reach.
function useFilePreview(file) {
    const [url, setUrl] = useState(null);
    useEffect(() => {
        if (!file) { setUrl(null); return undefined; }
        const next = URL.createObjectURL(file);
        setUrl(next);
        return () => URL.revokeObjectURL(next);
    }, [file]);
    return url;
}

function ImageSlot({ label, hint, file, currentUrl, alt, disabled, error, onFile }) {
    const preview = useFilePreview(file);
    const src = preview || currentUrl;
    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            {src
                ? <img src={src} alt={alt} className="size-24 shrink-0 rounded-card border border-line object-cover" />
                : <div aria-hidden="true" className="flex size-24 shrink-0 items-center justify-center rounded-card border border-dashed border-line text-sm text-mut">No image</div>}
            <Field
                className="min-w-0 flex-1"
                label={label}
                type="file"
                accept="image/png"
                hint={hint}
                error={error}
                disabled={disabled}
                onChange={(event) => { onFile(event.target.files?.[0] ?? null); event.target.value = ''; }}
            />
        </div>
    );
}

function PlayStylePicker({ value, onChange }) {
    const style = getPlayStyle(value);
    return <div className="space-y-3">
        <Field label="Play style" as="select" value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">No play style</option>
            {PLAY_STYLES.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </Field>
        {style
            ? <div className="flex items-center gap-3 rounded-ctl border border-line p-3">
                <img src={style.imageUrl} alt="" className="size-12 shrink-0 object-contain" />
                <div><p className="font-semibold">{style.name}</p><p className="text-sm text-mut">{style.description}</p></div>
            </div>
            : <p className="text-sm text-mut">A play style is optional. Choose one to show its icon and ability on the card.</p>}
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

const PLAYER_TABS = [
    { id: 'details', label: 'Details' },
    { id: 'style', label: 'Play style' },
    { id: 'attributes', label: 'Attributes' },
];

// Team name, short name, logo and colour. Used in the team details sheet and, for a captain with no logo or colour
// yet, inline on the setup page. The colour starts unset: nothing is pre-chosen for the captain.
function BrandingForm({ team, draft, setDraft, notice, saving, onSubmit, onCancel, onLogo, dirty, submitLabel, setup }) {
    const colourSet = Boolean(draft.color);
    return <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <div className="flex items-center gap-4">
            <Crest name={draft.name || team?.name} src={team?.logo_url} color={draft.color || undefined} size="lg" />
            <p className="text-sm text-mut">The logo and colour appear on the team card and the public team page.</p>
        </div>
        <Field label="Team name" required value={draft.name} maxLength={60} error={draft.nameError}
            onChange={(event) => setDraft({ ...draft, name: event.target.value, nameError: '' })}
            hint="2 to 60 characters." />
        <Field label="Short name" value={draft.shortName} maxLength={5} error={draft.shortError}
            onChange={(event) => setDraft({ ...draft, shortName: event.target.value, shortError: '' })}
            hint="2 to 5 letters or numbers, shown where space is tight." />
        <ImageSlot
            label={setup || team?.logo_url ? 'Team logo' : 'Team logo (required)'}
            hint="PNG, exactly 256 × 256 pixels, 5 MB or smaller. Not cropped."
            file={draft.logoFile}
            currentUrl={team?.logo_url}
            alt={`${draft.name || team?.name || 'Team'} logo preview`}
            error={draft.logoError}
            onFile={onLogo}
        />
        <div className="space-y-2">
            <p className="text-sm font-semibold">Team colour</p>
            <div className="flex flex-wrap items-center gap-3">
                <input type="color" value={colourSet ? draft.color : '#000000'} aria-label="Team colour"
                    onChange={(event) => setDraft({ ...draft, color: event.target.value, colorError: '' })}
                    className="size-11 cursor-pointer rounded-ctl border border-line bg-surf p-1" />
                <span className="text-sm text-mut">{colourSet ? draft.color.toUpperCase() : 'Not set. Pick a colour.'}</span>
            </div>
            {draft.colorError && <p className="text-sm text-live">{draft.colorError}</p>}
        </div>
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between sm:items-center">
            <p className="text-sm text-mut">{dirty ? 'Unsaved team details' : 'No unsaved changes'}</p>
            <div className="flex gap-3">
                {onCancel && <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>}
                <Button type="submit" disabled={saving} aria-busy={saving || undefined}>{saving ? 'Saving...' : submitLabel}</Button>
            </div>
        </div>
    </form>;
}

export function TeamBuilder() {
    const { user, hasRole } = useAuth();
    const confirm = useConfirm();
    // Dictator first: a dictator keeps dictator access even when they also captain a team.
    const isDictator = hasRole('dictator');
    const [registration, setRegistration] = useState(null);
    const [registrations, setRegistrations] = useState([]);
    const [players, setPlayers] = useState([]);
    const [activePlayer, setActivePlayer] = useState(0);
    const [activeTab, setActiveTab] = useState('details');
    const [loading, setLoading] = useState(true);
    const [rosterLoading, setRosterLoading] = useState(false);
    const [portraitFile, setPortraitFile] = useState(null);
    const [portraitError, setPortraitError] = useState('');
    const [uploadingImage, setUploadingImage] = useState(false);
    const [saving, setSaving] = useState(false);
    const [positionMissingFor, setPositionMissingFor] = useState(null);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [brandingOpen, setBrandingOpen] = useState(false);
    const [brand, setBrand] = useState(null); // the team details draft; null until a team is open
    const [brandSaving, setBrandSaving] = useState(false);
    const [brandNotice, setBrandNotice] = useState(null);
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

    const brandDraft = (team) => ({
        name: team?.name || '', shortName: team?.short_name || '', color: team?.team_color || '', logoFile: null,
        nameError: '', shortError: '', logoError: '', colorError: '',
    });
    const brandDirty = Boolean(brand) && (
        brand.name.trim() !== (registration?.team?.name || '')
        || brand.shortName.trim() !== (registration?.team?.short_name || '')
        || brand.color !== (registration?.team?.team_color || '')
        || brand.logoFile != null
    );
    const changedPlayers = players.filter(isChanged);
    const dirty = changedPlayers.length > 0 || brandDirty;

    // Leaving the page with unsaved edits asks first (in-app links are guarded by the shell's navigation).
    useEffect(() => {
        if (!dirty) return undefined;
        const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    // Runs the change of team only after unsaved edits are discarded (or there are none).
    const discardIfConfirmed = async (run) => {
        if (dirty) {
            const ok = await confirm({
                title: 'Discard unsaved changes?',
                description: 'Edits to this team that you have not saved will be lost.',
                confirmLabel: 'Discard changes',
                tone: 'danger',
            });
            if (!ok) return;
        }
        run();
    };

    // Loads the context's roster; only the latest choice may fill it (a late answer for an earlier choice is ignored).
    const openContext = (context) => {
        setRegistration(context);
        setPlayers([]);
        setActivePlayer(0);
        setActiveTab('details');
        setPortraitFile(null);
        setPositionMissingFor(null);
        setBrand(context ? brandDraft(context.team) : null);
        setBrandingOpen(false);
        setBrandNotice(null);
        setError(''); setSuccess('');
        const key = context?.id ?? null;
        latestRegistration.current = key;
        if (!context) { setRosterLoading(false); return; }
        setRosterLoading(true);
        loadRoster(context)
            .then((roster) => { if (latestRegistration.current === key) setPlayers(roster.map(fromMember)); })
            .catch((rosterError) => { if (latestRegistration.current === key) { setPlayers([]); setError(messageOf(rosterError, 'Could not load the roster.')); } })
            .finally(() => { if (latestRegistration.current === key) setRosterLoading(false); });
    };

    const teamsById = async (ids) => {
        if (!ids.length) return {};
        const { data: rows, error: teamsError } = await supabase.from('teams').select('id, name, short_name, logo_url, team_color').in('id', ids);
        if (teamsError) setError(teamsError.message);
        return Object.fromEntries((rows || []).map((team) => [team.id, team]));
    };

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

    const openBrandingSheet = () => {
        setBrand(brandDraft(registration.team));
        setBrandNotice(null);
        setBrandingOpen(true);
    };
    const closeBrandingSheet = async () => {
        if (brandSaving) return;
        if (brandDirty) {
            const ok = await confirm({
                title: 'Discard team details?',
                description: 'Your unsaved name, short name, logo or colour will be lost.',
                confirmLabel: 'Discard changes',
                tone: 'danger',
            });
            if (!ok) return;
        }
        setBrand(brandDraft(registration?.team));
        setBrandNotice(null);
        setBrandingOpen(false);
    };

    const handleBrandingSubmit = async (event) => {
        event.preventDefault();
        if (!registration?.registrationId || readOnly || brandSaving) return; // team details need the user's own writable assignment
        const name = brand.name.trim();
        const short = brand.shortName.trim();
        const problems = {};
        if (name.length < 2) problems.nameError = 'Enter a team name of 2 to 60 characters.';
        if (short && !/^[A-Za-z0-9]{2,5}$/.test(short)) problems.shortError = 'The short name must be 2 to 5 letters or numbers.';
        if (!registration.team?.logo_url && !brand.logoFile) problems.logoError = 'Upload a team logo before saving.';
        if (!brand.color) problems.colorError = 'Pick a team colour before saving.';
        if (Object.keys(problems).length) { setBrand((d) => ({ ...d, ...problems })); return; }

        setBrandSaving(true);
        setBrandNotice(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const formData = new FormData();
            formData.append('team_entry_id', registration.team_entry_id);
            formData.append('team_color', brand.color);
            if (name !== registration.team?.name) formData.append('team_name', name);
            if (short !== (registration.team?.short_name || '')) formData.append('short_name', short);
            if (brand.logoFile) formData.append('logo', brand.logoFile);

            const response = await fetch(`${API_URL}/captain/team-branding`, {
                method: 'POST',
                credentials: 'include',
                headers: { Authorization: `Bearer ${session?.access_token || ''}` },
                body: formData,
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || result.message || 'Could not save team details.');

            // The team is shown in every list it appears in, so each one takes the saved values.
            const savedTeam = result.data;
            setRegistration((current) => ({ ...current, team: { ...current.team, ...savedTeam } }));
            setRegistrations((list) => list.map((r) => (r.team_id === registration.team_id ? { ...r, team: { ...r.team, ...savedTeam } } : r)));
            setTeams((list) => list.map((t) => (t.id === registration.team_id ? { ...t, ...savedTeam } : t)));
            setBrand(brandDraft({ ...registration.team, ...savedTeam }));
            setBrandingOpen(false);
            setBrandNotice(null);
            setSuccess('Team details saved.');
        } catch (saveError) {
            setBrandNotice({ tone: 'error', text: messageOf(saveError, 'Could not save team details.') });
        } finally {
            setBrandSaving(false);
        }
    };

    // The logo is checked as soon as it is chosen, so a bad file never reaches the server.
    const chooseLogo = async (file) => {
        const problem = file ? await logoProblem(file) : null;
        setBrand((d) => ({ ...d, logoFile: problem ? null : file, logoError: problem ?? '' }));
    };

    const handleImageUpload = async (file) => {
        if (readOnly || !file) return;
        setError('');
        setSuccess('');
        setPortraitError('');
        const problem = await portraitProblem(file);
        if (problem) { setPortraitError(problem); return; }
        setPortraitFile(file);
        setUploadingImage(true);
        try {
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
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.message || result.error || 'Could not upload the player image.');

            updatePlayer('imageUrl', result.imageUrl);
            setSuccess(`Uploaded ${currentPlayer.fullName}'s image. Save to apply.`);
        } catch (uploadError) {
            setPortraitError(messageOf(uploadError, 'Could not upload the player image.'));
        } finally {
            setUploadingImage(false);
            setPortraitFile(null);
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (readOnly || saving) return;
        setError('');
        setSuccess('');

        // Only changed players are saved, so nothing unedited is rewritten. An empty rating stays "not set"; a rating
        // that is set must be 1..99. Nothing is filled in.
        if (!changedPlayers.length) { setSuccess('No player changes to save.'); return; }
        for (const player of changedPlayers) {
            if (!player.position) {
                const index = players.indexOf(player);
                setActivePlayer(index);
                setActiveTab('details');
                setPositionMissingFor(player.id);
                setError(`Choose a position for ${player.fullName} before saving.`);
                return;
            }
            const rating = Number(player.overallRating);
            if (player.overallRating !== '' && (!Number.isInteger(rating) || rating < 1 || rating > 99)) { setError(`The overall rating for ${player.fullName} must be between 1 and 99, or left empty.`); return; }
            const attributes = attributesForSave(player);
            if (attributes.error) { setError(`${player.fullName}: ${attributes.error}`); return; }
        }
        setSaving(true);
        let saved = 0;
        let failed = null;
        try {
            for (const player of changedPlayers) {
                // The database decides who may change what. There is deliberately no direct-update fallback:
                // captains have no write access to players or rosters, so a fallback would change nothing yet still
                // report success.
                const attributes = attributesForSave(player).value;
                const { error: rpcError } = await supabase.rpc('captain_update_roster_player', rosterPlayerRpcArgs(player, attributes));
                if (rpcError) { failed = { player, message: messageOf(rpcError, 'Could not save.') }; break; }
                saved += 1;
                setPlayers((current) => current.map((p) => (p.id === player.id ? fromMember({
                    id: p.id, name: p.fullName, position: p.position, jersey_number: p.jerseyNumber, image_url: p.imageUrl,
                    overall_rating: p.overallRating === '' ? null : Number(p.overallRating), attributes,
                }) : p)));
            }
        } finally {
            setSaving(false);
        }
        if (failed) setError(`Saved ${saved} of ${changedPlayers.length}, failed at ${failed.player.fullName}: ${failed.message}`);
        else setSuccess(`Saved ${saved} ${saved === 1 ? 'player' : 'players'}.`);
    };

    if (loading) return <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></main>;

    const pickers = isDictator && <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Division" as="select" value={divisionId} onChange={(event) => { const v = event.target.value; discardIfConfirmed(() => chooseDivision(v)); }}>
            <option value="">{divisions.length ? 'Choose a division' : 'No divisions yet'}</option>
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Field>
        <Field label="Season" as="select" value={seasonId} disabled={!divisionId || picking.seasons} onChange={(event) => { const v = event.target.value; discardIfConfirmed(() => chooseSeason(v)); }}>
            <option value="">{picking.seasons ? 'Loading seasons...' : divisionId && !seasons.length ? 'This division has no seasons' : 'Choose a season'}</option>
            {seasons.map((x) => <option key={x.id} value={x.id}>{x.name}{x.is_current ? ' (current)' : ''}</option>)}
        </Field>
        <Field label="Team" as="select" value={teamId} disabled={!seasonId || picking.teams} onChange={(event) => { const v = event.target.value; discardIfConfirmed(() => chooseTeam(v)); }}>
            <option value="">{picking.teams ? 'Loading teams...' : seasonId && !teams.length ? 'No teams in this season' : 'Choose a team'}</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Field>
    </div>;

    const captainPicker = !isDictator && registrations.length > 1 && <Field label="Your team" as="select" value={registration?.id || ''} onChange={(event) => { const v = event.target.value; discardIfConfirmed(() => selectRegistration(v)); }}>
        {registrations.map((item) => <option key={item.id} value={item.id}>{teamLabel(item)} · {item.season?.division?.name} {item.season?.name}{item.season?.is_current ? '' : ' (past season, read only)'}</option>)}
    </Field>;

    const heading = <header className="space-y-1">
        <p className="text-sm text-mut">{isDictator ? 'Dictator workspace' : 'Captain workspace'}</p>
        <h1 className="font-display text-3xl font-bold">Team builder</h1>
    </header>;

    if (!registration) return <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 text-ink sm:px-6">
        {heading}
        {isDictator
            ? <>
                <p className="text-mut">Pick a division, season and team to manage its roster.</p>
                {pickers}
                {error && <Notice tone="error">{error}</Notice>}
            </>
            : <EmptyState title="No squad assigned">A dictator will assign your team and roster here.{error && <span className="mt-2 block text-live">{error}</span>}</EmptyState>}
    </main>;

    // A captain whose team has no logo or colour yet sets them up before the roster.
    if ((!registration.team?.logo_url || !registration.team?.team_color) && !isDictator && registration.registrationId && !readOnly) return <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6 text-ink sm:px-6">
        {heading}
        <Card className="space-y-5">
            <div>
                <h2 className="font-display text-2xl font-bold">Set up {teamLabel(registration)}</h2>
                <p className="text-mut">{registration.season?.division?.name} {registration.season?.name}. Add a logo and colour before you edit the roster.</p>
            </div>
            <BrandingForm
                setup
                team={registration.team}
                draft={brand}
                setDraft={setBrand}
                onLogo={chooseLogo}
                notice={brandNotice}
                saving={brandSaving}
                dirty={brandDirty}
                submitLabel="Save team details"
                onSubmit={handleBrandingSubmit}
            />
        </Card>
    </main>;

    const teamCard = <section className="flex flex-col gap-4 rounded-card bg-blk p-5 text-blkink sm:flex-row sm:items-center">
        <Crest name={teamLabel(registration)} src={registration.team?.logo_url} color={registration.team?.team_color || undefined} size="lg" />
        <div className="min-w-0 flex-1">
            <p className="font-display text-3xl font-bold leading-tight">{teamLabel(registration)}</p>
            <p className="text-sm opacity-80">{registration.season?.division?.name} {registration.season?.name}</p>
        </div>
        {registration.registrationId && !readOnly && <Button variant="secondary" onClick={openBrandingSheet}>Edit team details</Button>}
    </section>;

    const brandingSheet = <Sheet open={brandingOpen} onClose={closeBrandingSheet} title="Team details">
        <BrandingForm
            team={registration.team}
            draft={brand}
            setDraft={setBrand}
            onLogo={chooseLogo}
            notice={brandNotice}
            saving={brandSaving}
            dirty={brandDirty}
            submitLabel="Save team details"
            onCancel={closeBrandingSheet}
            onSubmit={handleBrandingSubmit}
        />
    </Sheet>;

    const saveBar = !readOnly && players.length > 0 && <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t border-line bg-surf px-4 py-3 sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm text-mut" aria-live="polite">{changedPlayers.length ? `${changedPlayers.length} unsaved ${changedPlayers.length === 1 ? 'change' : 'changes'}` : 'No unsaved changes'}</p>
        <Button type="submit" disabled={saving || !changedPlayers.length} aria-busy={saving || undefined}>{saving ? 'Saving...' : 'Save player profiles'}</Button>
    </div>;

    if (!players.length) return <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 text-ink sm:px-6">
        {heading}
        {pickers}
        {captainPicker}
        {teamCard}
        {rosterLoading && <Skeleton className="h-24 w-full" />}
        {!rosterLoading && error && <ErrorState message={`The roster could not be loaded: ${error}`} onRetry={() => openContext(registration)} />}
        {!rosterLoading && !error && <EmptyState title="Roster pending">{isDictator ? 'No players on this roster yet. Add them in Teams and rosters.' : 'Your dictator is forming the player roster.'}</EmptyState>}
        {brandingSheet}
    </main>;

    const panel = currentPlayer && <Card className="space-y-6">
        <div>
            <h2 className="font-display text-2xl font-bold">{currentPlayer.fullName || 'Player'}</h2>
            <p className="text-sm text-mut">{currentPlayer.jerseyNumber ? `#${currentPlayer.jerseyNumber}` : 'No jersey number yet'}{currentPlayer.position ? ` · ${currentPlayer.position}` : ''}</p>
        </div>
        <Tabs label="Player details" tabs={PLAYER_TABS} value={activeTab} onChange={setActiveTab} />
        {activeTab === 'details' && <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Position" as="select" required value={currentPlayer.position}
                error={positionMissingFor === currentPlayer.id && !currentPlayer.position ? 'Choose a position. It is required before saving.' : undefined}
                onChange={(event) => { updatePlayer('position', event.target.value); setPositionMissingFor(null); }}>
                <option value="">Choose a position</option>
                {positions.map((position) => <option key={position}>{position}</option>)}
            </Field>
            <Field label="Jersey number" type="number" min="0" max="99" value={currentPlayer.jerseyNumber} onChange={(event) => updatePlayer('jerseyNumber', event.target.value)} />
            <Field label="Overall rating" type="number" min="1" max="99" placeholder="Not set" value={currentPlayer.overallRating} onChange={(event) => updatePlayer('overallRating', event.target.value)} hint="Leave empty if not set." />
            <div className="sm:col-span-2">
                <ImageSlot
                    label="Player image"
                    hint="Optional. PNG, exactly 500 × 500 pixels, 5 MB or smaller. Uploading saves the file; Save player profiles applies it."
                    file={portraitFile}
                    currentUrl={currentPlayer.imageUrl}
                    alt={`${currentPlayer.fullName} card image`}
                    disabled={uploadingImage}
                    error={portraitError || undefined}
                    onFile={handleImageUpload}
                />
            </div>
        </div>}
        {activeTab === 'style' && <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Preferred foot" as="select" value={currentPlayer.preferredFoot} onChange={(event) => updatePlayer('preferredFoot', event.target.value)}>
                <option value="">Not set</option>
                {FEET.map((foot) => <option key={foot}>{foot}</option>)}
            </Field>
            <PlayStylePicker value={currentPlayer.playStyleId} onChange={(value) => updatePlayer('playStyleId', value)} />
        </div>}
        {activeTab === 'attributes' && <div className="grid gap-4 sm:grid-cols-3">
            {CARD_STATS.map(({ key }) => <Field key={key} label={key} type="number" min="1" max="99" placeholder="Not set" value={currentPlayer.stats[key]} onChange={(event) => updateStat(key, event.target.value)} />)}
        </div>}
    </Card>;

    return <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 text-ink sm:px-6">
        {heading}
        {pickers}
        {captainPicker}
        {teamCard}
        {readOnly && <Notice tone="warning">Past season: captains can view it but not change it.</Notice>}
        <form onSubmit={handleSubmit} className="space-y-6 pb-2" noValidate>
            <fieldset disabled={readOnly || saving} className="space-y-6">
                <section aria-label="Squad" className="space-y-3">
                    <h2 className="font-display text-xl font-bold">Squad</h2>
                    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
                        {players.map((player, index) => {
                            const selected = index === activePlayer;
                            return <button
                                key={player.id}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => { setActivePlayer(index); setActiveTab('details'); }}
                                className={`min-h-11 shrink-0 rounded-pill border px-4 text-sm font-semibold transition-colors duration-200 ease-out ${selected ? 'border-ink bg-ink text-bg' : 'border-line bg-surf text-ink hover:border-mut'}`}
                            >
                                <span className="tabular-nums text-mut">{String(index + 1).padStart(2, '0')}</span> {player.fullName || 'Player'}
                                {isChanged(player) && <span className="sr-only"> (unsaved changes)</span>}
                            </button>;
                        })}
                    </div>
                </section>
                {panel}
                {(error || success) && <Notice tone={error ? 'error' : 'success'}>{error || success}</Notice>}
                {saveBar}
            </fieldset>
        </form>
        {brandingSheet}
    </main>;
}
