import { useEffect, useState } from 'react';
import { ArrowLeft, ImagePlus, Plus, Save, Trash2, UploadCloud, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import './TeamBuilder.css';

const statKeys = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physicality'];
const emptyPlayer = {
    firstName: '', lastName: '', email: '', position: '', jerseyNumber: '', imageFile: null, imageUrl: '',
    preferredFoot: 'Right', playStyleName: '', playStyleDescription: '', playStyleImageFile: null, playStyleIconUrl: '',
    overallRating: 50, stats: { pace: 50, shooting: 50, passing: 50, dribbling: 50, defending: 50, physicality: 50 },
};

const fromMember = (member) => {
    const attributes = member.attributes || {};
    const bio = attributes.bio || {};
    const playStyle = attributes.playStyles?.[0] || {};
    const stats = attributes.stats || {};
    return {
        ...emptyPlayer,
        firstName: member.first_name || member.name?.split(' ')[0] || '',
        lastName: member.last_name || member.name?.split(' ').slice(1).join(' ') || '',
        email: member.email || '', position: member.position || '', jerseyNumber: member.jersey_number || '',
        imageUrl: member.image_url || '', preferredFoot: bio.preferredFoot || 'Right',
        playStyleName: playStyle.name || '', playStyleDescription: playStyle.description || '', playStyleIconUrl: playStyle.icon_url || '',
        overallRating: member.overall_rating || 50,
        stats: Object.fromEntries(statKeys.map((key) => [key, stats[key]?.total || 50])),
    };
};

async function uploadImage(file, prefix) {
    if (!file) return null;
    const extension = file.name.split('.').pop();
    const path = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${extension}`;
    const { error } = await supabase.storage.from('player-images').upload(path, file);
    if (error) throw error;
    return supabase.storage.from('player-images').getPublicUrl(path).data.publicUrl;
}

export function TeamBuilder() {
    const { user } = useAuth();
    const [teamName, setTeamName] = useState('');
    const [division, setDivision] = useState('mens');
    const [players, setPlayers] = useState([{ ...emptyPlayer }]);
    const [activePlayer, setActivePlayer] = useState(0);
    const [activeTab, setActiveTab] = useState('basic');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        const loadTeam = async () => {
            const { data } = await supabase.from('team_registrations').select('id, team_name, division, team_members(*)').eq('captain_id', user.id).maybeSingle();
            if (data) {
                setTeamName(data.team_name || '');
                setDivision(data.division || 'mens');
                setPlayers(data.team_members?.length ? data.team_members.map(fromMember) : [{ ...emptyPlayer }]);
            }
            setLoading(false);
        };
        loadTeam();
    }, [user.id]);

    const currentPlayer = players[activePlayer] || players[0];
    const updatePlayer = (field, value) => setPlayers((current) => current.map((player, index) => index === activePlayer ? { ...player, [field]: value } : player));
    const updateStat = (stat, value) => updatePlayer('stats', { ...currentPlayer.stats, [stat]: Number(value) || 0 });
    const addPlayer = () => { setPlayers((current) => [...current, { ...emptyPlayer }]); setActivePlayer(players.length); setActiveTab('basic'); };
    const removePlayer = () => { if (players.length === 1) return; setPlayers((current) => current.filter((_, index) => index !== activePlayer)); setActivePlayer(Math.max(0, activePlayer - 1)); };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!teamName.trim() || players.some((player) => !player.firstName.trim() || !player.lastName.trim() || !player.position.trim())) {
            setError('Complete each player\'s name and position before saving.');
            return;
        }
        setSaving(true); setError(''); setSuccess('');
        try {
            const preparedPlayers = await Promise.all(players.map(async (player, index) => {
                const imageUrl = player.imageFile ? await uploadImage(player.imageFile, `player_${index}`) : player.imageUrl || null;
                const playStyleIconUrl = player.playStyleImageFile ? await uploadImage(player.playStyleImageFile, `style_${index}`) : player.playStyleIconUrl || null;
                return {
                    name: `${player.firstName.trim()} ${player.lastName.trim()}`,
                    first_name: player.firstName.trim(), last_name: player.lastName.trim(), email: player.email.trim() || null,
                    position: player.position.trim().toUpperCase(), jersey_number: Number(player.jerseyNumber) || null,
                    image_url: imageUrl, overall_rating: Number(player.overallRating) || 50,
                    attributes: {
                        bio: { preferredFoot: player.preferredFoot },
                        playStyles: player.playStyleName ? [{ name: player.playStyleName.trim(), description: player.playStyleDescription.trim(), icon_url: playStyleIconUrl }] : [],
                        stats: Object.fromEntries(statKeys.map((stat) => [stat[0].toUpperCase() + stat.slice(1), { total: Number(player.stats[stat]) || 50 }])),
                    },
                };
            }));
            const { data: registration, error: registrationError } = await supabase.from('team_registrations').upsert({ captain_id: user.id, team_name: teamName.trim(), division }, { onConflict: 'captain_id' }).select('id').single();
            if (registrationError) throw registrationError;
            const { error: deleteError } = await supabase.from('team_members').delete().eq('registration_id', registration.id);
            if (deleteError) throw deleteError;
            const { error: membersError } = await supabase.from('team_members').insert(preparedPlayers.map((player) => ({ ...player, registration_id: registration.id })));
            if (membersError) throw membersError;
            setSuccess('Team and player cards saved successfully.');
        } catch (saveError) { setError(saveError.message || 'Failed to save the team.'); }
        setSaving(false);
    };

    if (loading) return <div className="min-h-screen bg-black" />;

    return <main className="team-builder">
        <Link to="/" className="team-builder-back"><ArrowLeft size={16} /> Back to tournaments</Link>
        <div className="team-builder-shell team-builder-shell-wide">
            <div className="team-builder-heading"><Users size={28} /><p>Captain workspace</p><h1>Build your<br /><em>squad.</em></h1><span>Create a player card for every teammate.</span></div>
            <form onSubmit={handleSubmit} className="team-builder-form">
                <div className="team-builder-topline"><label>Team name<input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="e.g. The Rovers" maxLength={60} required /></label><label>Division<select value={division} onChange={(event) => setDivision(event.target.value)}><option value="mens">Super League</option><option value="womens">WSL</option><option value="freshers">Freshers Tournament</option></select></label></div>
                <div className="team-builder-player-nav"><div className="team-builder-player-tabs">{players.map((player, index) => <button type="button" key={index} onClick={() => { setActivePlayer(index); setActiveTab('basic'); }} className={index === activePlayer ? 'is-active' : ''}>{String(index + 1).padStart(2, '0')} {player.firstName || 'New player'}</button>)}</div><button type="button" onClick={addPlayer} aria-label="Add player"><Plus size={18} /></button></div>
                <div className="team-builder-card">
                    <div className="team-builder-card-head"><div><p>Player {String(activePlayer + 1).padStart(2, '0')}</p><span>Build their profile card</span></div><button type="button" onClick={removePlayer} disabled={players.length === 1} aria-label="Remove player"><Trash2 size={16} /></button></div>
                    <div className="team-builder-form-tabs"><button type="button" onClick={() => setActiveTab('basic')} className={activeTab === 'basic' ? 'is-active' : ''}>Basic</button><button type="button" onClick={() => setActiveTab('bio')} className={activeTab === 'bio' ? 'is-active' : ''}>Bio & Playstyle</button><button type="button" onClick={() => setActiveTab('stats')} className={activeTab === 'stats' ? 'is-active' : ''}>Attributes</button></div>
                    {activeTab === 'basic' && <div className="team-builder-grid team-builder-basic"><input value={currentPlayer.firstName} onChange={(event) => updatePlayer('firstName', event.target.value)} placeholder="First name" required /><input value={currentPlayer.lastName} onChange={(event) => updatePlayer('lastName', event.target.value)} placeholder="Last name" required /><input type="email" value={currentPlayer.email} onChange={(event) => updatePlayer('email', event.target.value)} placeholder="Email (optional)" /><input value={currentPlayer.position} onChange={(event) => updatePlayer('position', event.target.value)} placeholder="Position (e.g. ST)" required /><input type="number" min="1" max="99" value={currentPlayer.jerseyNumber} onChange={(event) => updatePlayer('jerseyNumber', event.target.value)} placeholder="Jersey number" /><label className="team-builder-upload"><UploadCloud size={18} /> Player image<input type="file" accept="image/*" onChange={(event) => updatePlayer('imageFile', event.target.files?.[0] || null)} /></label>{currentPlayer.imageUrl && !currentPlayer.imageFile && <img src={currentPlayer.imageUrl} alt="Current player" className="team-builder-preview" />}<label>Overall rating<input type="number" min="1" max="99" value={currentPlayer.overallRating} onChange={(event) => updatePlayer('overallRating', event.target.value)} /></label></div>}
                    {activeTab === 'bio' && <div className="team-builder-grid"><label>Preferred foot<select value={currentPlayer.preferredFoot} onChange={(event) => updatePlayer('preferredFoot', event.target.value)}><option>Right</option><option>Left</option><option>Both</option></select></label><input value={currentPlayer.playStyleName} onChange={(event) => updatePlayer('playStyleName', event.target.value)} placeholder="PlayStyle name (e.g. Finesse Shot+)" /><textarea value={currentPlayer.playStyleDescription} onChange={(event) => updatePlayer('playStyleDescription', event.target.value)} placeholder="Describe the signature playstyle" /><label className="team-builder-upload"><ImagePlus size={18} /> PlayStyle icon<input type="file" accept="image/*" onChange={(event) => updatePlayer('playStyleImageFile', event.target.files?.[0] || null)} /></label>{currentPlayer.playStyleIconUrl && !currentPlayer.playStyleImageFile && <img src={currentPlayer.playStyleIconUrl} alt="Current playstyle" className="team-builder-style-preview" />}</div>}
                    {activeTab === 'stats' && <div className="team-builder-stats">{statKeys.map((stat) => <label key={stat}>{stat}<input type="number" min="1" max="99" value={currentPlayer.stats[stat]} onChange={(event) => updateStat(stat, event.target.value)} /></label>)}</div>}
                </div>
                {(error || success) && <p className={error ? 'team-builder-error' : 'team-builder-success'}>{error || success}</p>}
                <button className="team-builder-submit" type="submit" disabled={saving}>{saving ? 'Saving squad...' : <><Save size={18} /> Save team and player cards</>}</button>
            </form>
        </div>
    </main>;
}
