import { useEffect, useState } from 'react';
import { ArrowLeft, Save, Shield, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { getPlayStyle, PLAY_STYLES } from '../data/playStyles';
import './TeamBuilder.css';

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
    const { user } = useAuth();
    const [registration, setRegistration] = useState(null);
    const [players, setPlayers] = useState([]);
    const [activePlayer, setActivePlayer] = useState(0);
    const [activeTab, setActiveTab] = useState('basic');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        let cancelled = false;
        const loadTeam = async () => {
            if (!user?.id) return;
            const { data, error: loadError } = await supabase
                .from('team_registrations')
                .select('id, team_name, division, team_members(*)')
                .eq('captain_id', user.id)
                .maybeSingle();
            if (cancelled) return;
            if (loadError) setError(loadError.message);
            if (data) {
                setRegistration(data);
                setPlayers((data.team_members || []).map(fromMember));
            }
            setLoading(false);
        };
        loadTeam();
        return () => { cancelled = true; };
    }, [user?.id]);

    const currentPlayer = players[activePlayer];
    const updatePlayer = (field, value) => setPlayers((current) => current.map((player, index) => index === activePlayer ? { ...player, [field]: value } : player));
    const updateStat = (stat, value) => updatePlayer('stats', { ...currentPlayer.stats, [stat]: Number(value) || 0 });

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (players.some((player) => !player.position)) {
            setError('Choose a position for every player before saving.');
            return;
        }
        setSaving(true);
        setError('');
        setSuccess('');
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
                const { error: updateError } = await supabase.rpc('captain_update_team_member', {
                    p_member_id: player.id,
                    p_position: player.position,
                    p_jersey_number: Number(player.jerseyNumber) || null,
                    p_overall_rating: Number(player.overallRating) || 50,
                    p_attributes: attributes,
                });
                if (updateError) throw updateError;
            }
            setSuccess('Player roles and profiles saved.');
        } catch (saveError) {
            setError(saveError.message || 'Could not save player profiles.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="min-h-screen bg-black" />;

    if (!registration) return <main className="team-builder">
        <Link to="/" className="team-builder-back"><ArrowLeft size={16} /> Back to tournaments</Link>
        <div className="team-builder-empty"><Users size={32} /><p>Captain workspace</p><h1>No squad<br /><em>assigned.</em></h1><span>A dictator will assign your team and roster here.</span>{error && <p className="team-builder-error">{error}</p>}</div>
    </main>;

    if (!players.length) return <main className="team-builder">
        <Link to="/" className="team-builder-back"><ArrowLeft size={16} /> Back to tournaments</Link>
        <div className="team-builder-empty"><Shield size={32} /><p>{registration.team_name}</p><h1>Roster<br /><em>pending.</em></h1><span>Your dictator is forming the player roster.</span></div>
    </main>;

    return <main className="team-builder">
        <Link to="/" className="team-builder-back"><ArrowLeft size={16} /> Back to tournaments</Link>
        <div className="team-builder-shell team-builder-shell-wide">
            <div className="team-builder-heading"><Users size={28} /><p>Captain workspace / {registration.division}</p><h1>Set your<br /><em>lineup.</em></h1><span>Assign roles and player attributes for {registration.team_name}. Your dictator manages the roster.</span></div>
            <form onSubmit={handleSubmit} className="team-builder-form">
                <div className="team-builder-player-nav"><div className="team-builder-player-tabs">{players.map((player, index) => <button type="button" key={player.id} onClick={() => { setActivePlayer(index); setActiveTab('basic'); }} className={index === activePlayer ? 'is-active' : ''}>{String(index + 1).padStart(2, '0')} {player.fullName || 'Player'}</button>)}</div></div>
                <div className="team-builder-card">
                    <div className="team-builder-card-head"><div><p>{currentPlayer?.fullName}</p><span>{currentPlayer?.email || registration.team_name}</span></div></div>
                    <div className="team-builder-form-tabs"><button type="button" onClick={() => setActiveTab('basic')} className={activeTab === 'basic' ? 'is-active' : ''}>Position</button><button type="button" onClick={() => setActiveTab('bio')} className={activeTab === 'bio' ? 'is-active' : ''}>Bio & Playstyle</button><button type="button" onClick={() => setActiveTab('stats')} className={activeTab === 'stats' ? 'is-active' : ''}>Attributes</button></div>
                    {activeTab === 'basic' && <div className="team-builder-grid team-builder-basic"><label>Player<select value={activePlayer} onChange={(event) => setActivePlayer(Number(event.target.value))}>{players.map((player, index) => <option key={player.id} value={index}>{player.fullName}</option>)}</select></label><label>Position<select value={currentPlayer.position} onChange={(event) => updatePlayer('position', event.target.value)} required><option value="">Choose position</option>{positions.map((position) => <option key={position}>{position}</option>)}</select></label><label>Jersey number<input type="number" min="1" max="99" value={currentPlayer.jerseyNumber} onChange={(event) => updatePlayer('jerseyNumber', event.target.value)} /></label><label>Overall rating<input type="number" min="1" max="99" value={currentPlayer.overallRating} onChange={(event) => updatePlayer('overallRating', event.target.value)} /></label>{currentPlayer.imageUrl && <img src={currentPlayer.imageUrl} alt={currentPlayer.fullName} className="team-builder-preview" />}</div>}
                    {activeTab === 'bio' && <div className="team-builder-grid"><label>Preferred foot<select value={currentPlayer.preferredFoot} onChange={(event) => updatePlayer('preferredFoot', event.target.value)}><option>Right</option><option>Left</option><option>Both</option></select></label><PlayStylePicker value={currentPlayer.playStyleId} onChange={(value) => updatePlayer('playStyleId', value)} /></div>}
                    {activeTab === 'stats' && <div className="team-builder-stats">{statKeys.map((stat) => <label key={stat}>{stat}<input type="number" min="1" max="99" value={currentPlayer.stats[stat]} onChange={(event) => updateStat(stat, event.target.value)} /></label>)}</div>}
                </div>
                {(error || success) && <p className={error ? 'team-builder-error' : 'team-builder-success'}>{error || success}</p>}
                <button className="team-builder-submit" type="submit" disabled={saving}>{saving ? 'Saving player profiles...' : <><Save size={18} /> Save player profiles</>}</button>
            </form>
        </div>
    </main>;
}
