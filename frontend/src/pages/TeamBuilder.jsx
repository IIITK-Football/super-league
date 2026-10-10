import { useEffect, useState } from 'react';
import { ArrowLeft, ImagePlus, Loader2, Save, Shield, UploadCloud, Users, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { getPlayStyle, PLAY_STYLES } from '../data/playStyles';
import { API_BASE_URL } from '../lib/api';
import './TeamBuilder.css';
import './TeamBranding.css';

const API_URL = API_BASE_URL;
const statKeys = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physicality'];
const positions = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST'];

const getPlayStyleId = (name) => PLAY_STYLES.find((style) => style.name.toLowerCase() === name?.replace(/\+$/, '').toLowerCase())?.id || '';

const fromMember = (member) => {
    const attributes = member.attributes || {};
    const bio = attributes.bio || {};
    const playStyle = attributes.playStyles?.[0] || {};
    const stats = attributes.stats || {};
    return {
        id: member.id,
        fullName: member.name || [member.first_name, member.last_name].filter(Boolean).join(' '),
        email: member.email || '',
        position: member.position || '',
        jerseyNumber: member.jersey_number || '',
        imageUrl: member.image_url || '',
        preferredFoot: bio.preferredFoot || 'Right',
        playStyleId: getPlayStyleId(playStyle.name),
        overallRating: member.overall_rating || 50,
        attributes,
        stats: Object.fromEntries(statKeys.map((key) => [key, stats[key[0].toUpperCase() + key.slice(1)]?.total ?? 50])),
    };
};

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

export function TeamBuilder() {
    const { user, role } = useAuth();
    const isDictatorPreview = role === 'dictator' || role === 'admin';
    const [registration, setRegistration] = useState(null);
    const [registrations, setRegistrations] = useState([]);
    const [players, setPlayers] = useState([]);
    const [activePlayer, setActivePlayer] = useState(0);
    const [activeTab, setActiveTab] = useState('basic');
    const [loading, setLoading] = useState(true);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [saving, setSaving] = useState(false);
    const [teamLogoFile, setTeamLogoFile] = useState(null);
    const [teamColor, setTeamColor] = useState('#ffffff');
    const [teamColorSelected, setTeamColorSelected] = useState(false);
    const [savingBranding, setSavingBranding] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [brandingModalOpen, setBrandingModalOpen] = useState(false);
    const [brandingError, setBrandingError] = useState('');
    const [brandingSuccess, setBrandingSuccess] = useState('');

    useEffect(() => {
        let cancelled = false;
        const loadTeam = async () => {
            if (!user?.id) return;
            let query = supabase
                .from('team_registrations')
                .select('id, team_id, team_name, division, team_members(*)')
                .order('team_name', { ascending: true });
            if (!isDictatorPreview) query = query.eq('captain_id', user.id);
            const { data, error: loadError } = isDictatorPreview
                ? await query
                : await query.maybeSingle();
            if (cancelled) return;
            if (loadError) setError(loadError.message);
            const teamRegistrations = (isDictatorPreview ? data || [] : data ? [data] : []);
            const teamIds = teamRegistrations.map((item) => item.team_id).filter(Boolean);
            let teamsById = {};
            if (teamIds.length) {
                const { data: teams, error: teamsError } = await supabase
                    .from('teams')
                    .select('id, logo_url, team_color')
                    .in('id', teamIds);
                if (teamsError) setError(teamsError.message);
                teamsById = Object.fromEntries((teams || []).map((team) => [team.id, team]));
            }
            if (cancelled) return;
            const choices = teamRegistrations.map((item) => ({ ...item, team: teamsById[item.team_id] || null }));
            setRegistrations(choices);
            const selected = isDictatorPreview
                ? choices[0] || null
                : choices[0] || null;
            setRegistration(selected);
            setPlayers((selected?.team_members || []).map(fromMember));
            setTeamColor(selected?.team?.team_color || '#ffffff');
            setTeamColorSelected(Boolean(selected?.team?.team_color));
            setLoading(false);
        };
        loadTeam();
        return () => { cancelled = true; };
    }, [user?.id, isDictatorPreview]);

    const currentPlayer = players[activePlayer];
    const selectRegistration = (registrationId) => {
        const selected = registrations.find((item) => item.id === registrationId) || null;
        setRegistration(selected);
        setPlayers((selected?.team_members || []).map(fromMember));
        setActivePlayer(0);
        setActiveTab('basic');
        setTeamLogoFile(null);
        setTeamColor(selected?.team?.team_color || '#ffffff');
        setTeamColorSelected(Boolean(selected?.team?.team_color));
        setError('');
        setSuccess('');
        setBrandingError('');
        setBrandingSuccess('');
    };
    const updatePlayer = (field, value) => setPlayers((current) => current.map((player, index) => index === activePlayer ? { ...player, [field]: value } : player));
    const updateStat = (stat, value) => updatePlayer('stats', { ...currentPlayer.stats, [stat]: Number(value) || 0 });

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
        if (isDictatorPreview) return;
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
            formData.append('team_color', teamColor);
            if (teamLogoFile) formData.append('logo', teamLogoFile);

            const response = await fetch(`${API_URL}/captain/team-branding`, {
                method: 'POST',
                credentials: 'include',
                headers: { Authorization: `Bearer ${session?.access_token || ''}` },
                body: formData,
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not save team branding.');

            setRegistration((current) => ({
                ...current,
                team: { ...current.team, ...result.data },
            }));
            setTeamLogoFile(null);
            setTeamColorSelected(true);
            setSuccess('Team logo and color saved.');
            setBrandingSuccess('Team logo and color saved.');
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
        if (isDictatorPreview) return;
        const file = event.target.files?.[0];
        if (!file) return;
        
        if (!currentPlayer?.email?.trim() || !currentPlayer.email.includes('@')) {
            setError(`Please enter a valid email for ${currentPlayer?.fullName || 'the player'} before uploading an image.`);
            return;
        }

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

            if (width !== 512 || height !== 512) {
                throw new Error(`Player image must be exactly 512 × 512 pixels (selected image is ${width} × ${height}). Please resize and upload again.`);
            }

            const formData = new FormData();
            formData.append('email', currentPlayer.email.trim());
            formData.append('image', file, `${currentPlayer.email.trim()}.png`);

            const { data: { session } } = await supabase.auth.getSession();
            const response = await fetch(`${API_URL}/admin/freshers/player-image`, {
                method: 'POST',
                credentials: 'include',
                headers: { Authorization: `Bearer ${session?.access_token}` },
                body: formData,
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to upload player image.');

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
        if (isDictatorPreview) return;
        setError('');
        setSuccess('');

        // Removed mandatory validation for all players to allow partial saving
        setSaving(true);
        try {
            for (const player of players) {
                const style = getPlayStyle(player.playStyleId);
                const oldAttributes = player.attributes || {};
                const attributes = {
                    ...oldAttributes,
                    bio: { ...(oldAttributes.bio || {}), preferredFoot: player.preferredFoot },
                    playStyles: style ? [{ name: style.name, description: style.description, icon_url: style.imageUrl }] : [],
                    stats: Object.fromEntries(statKeys.map((stat) => [stat[0].toUpperCase() + stat.slice(1), { total: Number(player.stats[stat]) || 50 }])),
                };

                let rpcError = null;
                try {
                    const { error } = await supabase.rpc('captain_update_team_member', {
                        p_member_id: player.id,
                        p_position: player.position || null,
                        p_jersey_number: Number(player.jerseyNumber) || null,
                        p_overall_rating: Number(player.overallRating) || 50,
                        p_attributes: attributes,
                        p_email: player.email ? player.email.trim() : null,
                        p_image_url: player.imageUrl || null,
                    });
                    rpcError = error;
                } catch (e) {
                    rpcError = e;
                }

                if (rpcError) {
                    // Fallback to direct update if RPC fails
                    const { error: directError } = await supabase
                        .from('team_members')
                        .update({
                            position: player.position || null,
                            jersey_number: Number(player.jerseyNumber) || null,
                            overall_rating: Number(player.overallRating) || 50,
                            attributes: attributes,
                            email: player.email ? player.email.trim() : null,
                            image_url: player.imageUrl || null,
                        })
                        .eq('id', player.id);
                    if (directError) throw directError;
                }
            }
            setSuccess('Player profiles, mandatory emails, and Cloudflare images saved successfully.');
        } catch (saveError) {
            setError(saveError.message || 'Could not save player profiles.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="min-h-screen bg-black" />;

    if (!registration) return <main className="team-builder">
        <Link to="/" className="team-builder-back"><ArrowLeft size={16} /> Back to tournaments</Link>
        <div className="team-builder-empty"><Users size={32} /><p>{isDictatorPreview ? 'Dictator preview' : 'Captain workspace'}</p><h1>No squad<br /><em>assigned.</em></h1><span>{isDictatorPreview ? 'No captain teams have been assigned yet.' : 'A dictator will assign your team and roster here.'}</span>{error && <p className="team-builder-error">{error}</p>}</div>
    </main>;

    if ((!registration.team?.logo_url || !registration.team?.team_color) && !isDictatorPreview) return <main className="team-builder">
        <Link to="/" className="team-builder-back"><ArrowLeft size={16} /> Back to tournaments</Link>
        <div className="team-builder-shell">
            <div className="team-builder-heading"><Shield size={28} /><p>Captain workspace / {registration.division}</p><h1>Brand your<br /><em>team.</em></h1><span>Set your team identity before entering the Team Builder.</span></div>
            <form onSubmit={handleBrandingSubmit} className="team-builder-form team-builder-brand-form">
                <div className="team-builder-brand-preview" style={{ borderColor: teamColor }}>
                    {teamLogoFile ? <span>{teamLogoFile.name}</span> : registration.team?.logo_url ? <img src={registration.team.logo_url} alt={`${registration.team_name} logo`} /> : <Shield size={38} />}
                    <strong>{registration.team_name}</strong>
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

    if ((!registration.team?.logo_url || !registration.team?.team_color) && isDictatorPreview) return <main className="team-builder">
        <Link to="/" className="team-builder-back"><ArrowLeft size={16} /> Back to tournaments</Link>
        <div className="team-builder-shell">
            <div className="team-builder-heading"><Shield size={28} /><p>Dictator preview / {registration.division}</p><h1>Brand your<br /><em>team.</em></h1><span>This captain is prompted to upload a team logo and choose its color before accessing the roster.</span></div>
            <div className="team-builder-form team-builder-brand-form">
                <label>Captain team
                    <select value={registration.id} onChange={(event) => selectRegistration(event.target.value)}>
                        {registrations.map((item) => <option key={item.id} value={item.id}>{item.team_name}</option>)}
                    </select>
                </label>
                <div className="team-builder-brand-preview" style={{ borderColor: teamColor }}>
                    {registration.team?.logo_url ? <img src={registration.team.logo_url} alt={`${registration.team_name} logo`} /> : <Shield size={38} />}
                    <strong>{registration.team_name}</strong>
                </div>
                <p className="team-builder-brand-hint">Captain view preview — changes are disabled.</p>
            </div>
        </div>
    </main>;

    if (!players.length) return <main className="team-builder">
        <Link to="/" className="team-builder-back"><ArrowLeft size={16} /> Back to tournaments</Link>
        <div className="team-builder-empty"><Shield size={32} /><p>{registration.team_name}</p><h1>Roster<br /><em>pending.</em></h1><span>{isDictatorPreview ? 'This is what captains see while their roster is being formed.' : 'Your dictator is forming the player roster.'}</span></div>
    </main>;

    return <main className="team-builder">
        <Link to="/" className="team-builder-back"><ArrowLeft size={16} /> Back to tournaments</Link>
        <div className="team-builder-shell team-builder-shell-wide">
            <div className="team-builder-heading">
                <Users size={28} />
                <p>{isDictatorPreview ? 'Dictator preview' : 'Captain workspace'} / {registration.division}</p>
                <h1>Set your<br /><em>lineup.</em></h1>
                <span>Assign roles, mandatory emails, and images for {registration.team_name}.</span>

                <div className="team-builder-identity-badge" style={{ borderLeftColor: registration.team?.team_color || '#d9ff4a' }}>
                    {registration.team?.logo_url ? (
                        <img src={registration.team.logo_url} alt={`${registration.team_name} logo`} />
                    ) : (
                        <Shield size={28} />
                    )}
                    <div className="team-builder-identity-info">
                        <strong>{registration.team_name}</strong>
                        <span>Color: {registration.team?.team_color || '#FFFFFF'}</span>
                    </div>
                    {!isDictatorPreview && (
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
                {isDictatorPreview && <label>Captain team<select value={registration.id} onChange={(event) => selectRegistration(event.target.value)}>{registrations.map((item) => <option key={item.id} value={item.id}>{item.team_name}</option>)}</select></label>}
                {isDictatorPreview && <p className="team-builder-brand-hint">Captain view preview — editing and uploads are disabled.</p>}
                <div className="team-builder-player-nav"><div className="team-builder-player-tabs">{players.map((player, index) => <button type="button" key={player.id} onClick={() => { setActivePlayer(index); setActiveTab('basic'); }} className={index === activePlayer ? 'is-active' : ''}>{String(index + 1).padStart(2, '0')} {player.fullName || 'Player'}</button>)}</div></div>
                <fieldset disabled={isDictatorPreview} className="team-builder-preview-fieldset">
                <div className="team-builder-card">
                    <div className="team-builder-card-head"><div><p>{currentPlayer?.fullName}</p><span>{currentPlayer?.email || 'Email required'}</span></div></div>
                    <div className="team-builder-form-tabs"><button type="button" onClick={() => setActiveTab('basic')} className={activeTab === 'basic' ? 'is-active' : ''}>Position & Details</button><button type="button" onClick={() => setActiveTab('bio')} className={activeTab === 'bio' ? 'is-active' : ''}>Bio & Playstyle</button><button type="button" onClick={() => setActiveTab('stats')} className={activeTab === 'stats' ? 'is-active' : ''}>Attributes</button></div>
                    {activeTab === 'basic' && <div className="team-builder-grid team-builder-basic">
                        <label>Player<select value={activePlayer} onChange={(event) => setActivePlayer(Number(event.target.value))}>{players.map((player, index) => <option key={player.id} value={index}>{player.fullName}</option>)}</select></label>
                        <label>Position (Mandatory)<select value={currentPlayer.position} onChange={(event) => updatePlayer('position', event.target.value)}><option value="">Choose position</option>{positions.map((position) => <option key={position}>{position}</option>)}</select></label>
                        <label className="col-span-2">Player email (Mandatory for Captain)<input type="email" value={currentPlayer.email || ''} onChange={(event) => updatePlayer('email', event.target.value)} placeholder="e.g. ebinthomas24bcs99@iiitkottayam.ac.in" /></label>
                        <label>Jersey number<input type="number" min="1" max="99" value={currentPlayer.jerseyNumber} onChange={(event) => updatePlayer('jerseyNumber', event.target.value)} /></label>
                        <label>Overall rating<input type="number" min="1" max="99" value={currentPlayer.overallRating} onChange={(event) => updatePlayer('overallRating', event.target.value)} /></label>
                        
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
                            <span className="text-[10px] text-zinc-500">Must be a PNG format file with exact 512 × 512 resolution</span>
                        </div>
                    </div>}
                    {activeTab === 'bio' && <div className="team-builder-grid"><label>Preferred foot<select value={currentPlayer.preferredFoot} onChange={(event) => updatePlayer('preferredFoot', event.target.value)}><option>Right</option><option>Left</option><option>Both</option></select></label><PlayStylePicker value={currentPlayer.playStyleId} onChange={(value) => updatePlayer('playStyleId', value)} /></div>}
                    {activeTab === 'stats' && <div className="team-builder-stats">{statKeys.map((stat) => <label key={stat}>{stat}<input type="number" min="1" max="99" value={currentPlayer.stats[stat]} onChange={(event) => updateStat(stat, event.target.value)} /></label>)}</div>}
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
                        <h2><Shield size={18} className="text-[#d9ff4a]" /> Change Team Logo & Color</h2>
                        <button type="button" onClick={() => !savingBranding && setBrandingModalOpen(false)} aria-label="Close modal">
                            <X size={20} />
                        </button>
                    </div>
                    <form onSubmit={handleBrandingSubmit} className="team-builder-form team-builder-brand-form">
                        <div className="team-builder-brand-preview" style={{ borderColor: teamColor }}>
                            {teamLogoFile ? (
                                <span>{teamLogoFile.name} (Selected)</span>
                            ) : registration.team?.logo_url ? (
                                <img src={registration.team.logo_url} alt={`${registration.team_name} logo`} />
                            ) : (
                                <Shield size={38} />
                            )}
                            <strong>{registration.team_name}</strong>
                        </div>
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
