import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom'; // IMPORT NAVIGATE
import { useApi } from '../hooks/useApi';
import { supabase } from '../lib/supabase';
import { GlassPanel } from '../components/GlassPanel';
import { Send, User, LogOut, Trophy, Medal } from 'lucide-react';
import teamStyles from './Teams.module.css';
import { cn } from '../utils/cn';
import { API_BASE_URL } from '../lib/api';

const getTeamColorClass = (teamName) => {
    if (!teamName) return teamStyles.defaultTeam;
    const cleanName = teamName.trim();
    const map = {
        'KFC': teamStyles.kfc,
        'HRZxKadayadis': teamStyles.hrzx,
        'MILF': teamStyles.milf,
        'BBC': teamStyles.bbc,
        'AL Balal': teamStyles.alBalal,
        'AC Nilan': teamStyles.acNilan,
        'Red Wolves': teamStyles.redWolves,
        'DILF': teamStyles.dilf,
        'FAAAH United': teamStyles.faaah,
        'KULASTHREE FC': teamStyles.kulasthree,
        'Fivestars': teamStyles.fivestars
    };
    return map[cleanName] || teamStyles.defaultTeam;
};

export function UserProfile() {
    const { user, profile, setProfile, signOut } = useAuth();
    const navigate = useNavigate(); // USE NAVIGATE
    const { data: lbResp, loading: lbLoading } = useApi('/predictions/leaderboard');

    const leaderboard = lbResp?.data?.overall || [];
    const myEntry = leaderboard.find(entry => entry.user_id === user?.id);
    const myPoints = myEntry ? myEntry.total_points : 0;
    const myRank = myEntry ? leaderboard.findIndex(e => e.user_id === user?.id) + 1 : null;

    const [nickname, setNickname] = useState(profile?.nickname || '');
    const [mensFlair, setMensFlair] = useState(profile?.mens_team_flair || '');
    const [womensFlair, setWomensFlair] = useState(profile?.womens_team_flair || '');
    const [wcFlair, setWcFlair] = useState(profile?.wc_team_flair || ''); // NEW WC FLAIR STATE

    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState(null);

    const [mensTeams, setMensTeams] = useState([]);
    const [womensTeams, setWomensTeams] = useState([]);
    const [wcTeams, setWcTeams] = useState([]); // NEW WC TEAMS LIST

    useEffect(() => {
        const fetchAllTeams = async () => {
            // Fetch League Teams
            const { data: leagueData } = await supabase.from('teams').select('*').order('name');
            if (leagueData) {
                setMensTeams(leagueData.filter(t => t.division === 'mens'));
                setWomensTeams(leagueData.filter(t => t.division === 'womens'));
            }

            // Fetch World Cup Teams (Assuming they are in 'wc_teams' table or similar from your API)
            try {
               const res = await fetch(`${API_BASE_URL}/wc/teams`);
               const json = await res.json();
               if (json.success && json.data) {
                 // Sort them alphabetically for the dropdown
                 const sortedWcTeams = json.data.sort((a, b) => a.name.localeCompare(b.name));
                 setWcTeams(sortedWcTeams);
               }
            } catch (err) {
               console.error("Failed to fetch WC teams for profile", err);
            }
        };
        fetchAllTeams();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        // Require WC flair now too!
        if (!nickname.trim() || !mensFlair || !womensFlair || !wcFlair) return;

        setSaving(true);
        setError(null);
        setSuccess(false);

        const updatedProfile = {
            nickname: nickname.trim(),
            mens_team_flair: mensFlair,
            womens_team_flair: womensFlair,
            wc_team_flair: wcFlair, // SAVE WC FLAIR
        };

        const { error: updateError } = await supabase
            .from('user_profiles')
            .update(updatedProfile)
            .eq('id', user.id);

        if (updateError) {
            console.error("Profile saving error:", updateError.message);
            setError("Failed to update profile. Please try again.");
            setSaving(false);
            return;
        }

        setProfile({ ...profile, id: user.id, email: user.email, ...updatedProfile });
        setSaving(false);
        setSuccess(true);

        setTimeout(() => setSuccess(false), 3000);
    };

    const hasChanges =
        nickname !== (profile?.nickname || '') ||
        mensFlair !== (profile?.mens_team_flair || '') ||
        womensFlair !== (profile?.womens_team_flair || '') ||
        wcFlair !== (profile?.wc_team_flair || ''); // CHECK FOR WC CHANGES

    if (!user) return null;

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-12 w-full max-w-2xl mx-auto mt-8">
            <div className="text-center space-y-4 mb-8">
                <h1 className="text-4xl sm:text-5xl font-black tracking-tighter uppercase text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-500">
                    Your Profile
                </h1>
            </div>

            <GlassPanel className="p-8 sm:p-10 relative z-10 border border-white/10 bg-black/60 backdrop-blur-2xl">
                <div className="flex flex-col items-center justify-center mb-8">
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-white text-black flex items-center justify-center font-black text-4xl mb-4">
                        {nickname ? nickname.charAt(0).toUpperCase() : <User size={40} />}
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-2xl font-black text-white">{profile?.nickname || 'Unknown'}</span>
                    </div>

                    <div className="flex flex-wrap justify-center gap-2 mt-3">
                        {profile?.mens_team_flair && (
                            <span className={cn("px-3 py-1 rounded-full text-[10px] text-white font-bold leading-none tracking-wide shadow-custom border border-white/10", getTeamColorClass(profile.mens_team_flair))}>
                                {profile.mens_team_flair}
                            </span>
                        )}
                        {profile?.womens_team_flair && (
                            <span className={cn("px-3 py-1 rounded-full text-[10px] text-white font-bold leading-none tracking-wide shadow-custom border border-white/10", getTeamColorClass(profile.womens_team_flair))}>
                                {profile.womens_team_flair}
                            </span>
                        )}
                        {/* Display WC Flair Badge */}
                        {profile?.wc_team_flair && (
                            <span className="px-3 py-1 rounded-full text-[10px] text-black bg-[var(--fifa-gold)] font-black leading-none tracking-wide shadow-custom border border-white/10 uppercase">
                                {profile.wc_team_flair}
                            </span>
                        )}
                    </div>

                    {!lbLoading && (
                        <div className="flex items-center gap-4 mt-6 w-full max-w-xs">
                            <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                                <div className="flex items-center justify-center gap-1.5 mb-1">
                                    {myRank && myRank <= 3 && <Trophy size={14} className="text-yellow-500" />}
                                    <span className="text-2xl font-black text-white">{myRank ? `#${myRank}` : '—'}</span>
                                </div>
                                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Rank</p>
                            </div>
                            <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                                <div className="flex items-center justify-center gap-1.5 mb-1">
                                    <Medal size={14} className="text-zinc-400" />
                                    <span className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-400">{myPoints.toLocaleString()}</span>
                                </div>
                                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Fantasy Pts</p>
                            </div>
                        </div>
                    )}
                </div>

                {error && (
                    <div className="bg-red-500/20 border border-red-500/50 text-red-200 p-3 rounded-lg mb-6 text-sm font-bold text-center">
                        {error}
                    </div>
                )}

                {success && (
                    <div className="bg-green-500/20 border border-green-500/50 text-green-200 p-3 rounded-lg mb-6 text-sm font-bold text-center">
                        Profile updated successfully!
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6 text-left">
                    <div>
                        <label className="block text-xs font-black uppercase tracking-widest text-zinc-500 mb-2 ml-1">
                            Nickname
                        </label>
                        <input
                            type="text"
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            placeholder="e.g. MasterPredictor99"
                            className="w-full bg-black/50 border border-white/10 rounded-xl px-5 py-4 text-white font-bold placeholder-zinc-700 outline-none focus:border-white/40 transition-colors"
                            required
                            maxLength={20}
                            minLength={3}
                        />
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wider mt-2 ml-1">Visible on global leaderboards.</p>
                    </div>

                    {/* Team Flair Grid - Now 3 Columns on large screens */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 ml-1">
                                Men's Club
                            </label>
                            <select
                                value={mensFlair}
                                onChange={(e) => setMensFlair(e.target.value)}
                                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-bold outline-none focus:border-white/40 transition-colors appearance-none cursor-pointer"
                                required
                            >
                                <option value="" disabled>Select Club...</option>
                                {mensTeams.map((t) => <option key={t.id} value={t.name} className="bg-zinc-900">{t.name}</option>)}
                            </select>
                        </div>

                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 ml-1">
                                Women's Club
                            </label>
                            <select
                                value={womensFlair}
                                onChange={(e) => setWomensFlair(e.target.value)}
                                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-bold outline-none focus:border-white/40 transition-colors appearance-none cursor-pointer"
                                required
                            >
                                <option value="" disabled>Select Club...</option>
                                {womensTeams.map((t) => <option key={t.id} value={t.name} className="bg-zinc-900">{t.name}</option>)}
                            </select>
                        </div>

                        {/* NEW WORLD CUP FLAIR DROPDOWN */}
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-[var(--fifa-gold)] mb-2 ml-1">
                                World Cup Nation
                            </label>
                            <select
                                value={wcFlair}
                                onChange={(e) => setWcFlair(e.target.value)}
                                className="w-full bg-black/50 border border-[var(--fifa-gold)]/50 rounded-xl px-4 py-3 text-sm text-white font-bold outline-none focus:border-[var(--fifa-gold)] transition-colors appearance-none cursor-pointer"
                                required
                            >
                                <option value="" disabled>Select Nation...</option>
                                {wcTeams.map((t) => <option key={t.id} value={t.name} className="bg-zinc-900">{t.name}</option>)}
                            </select>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={saving || !nickname || !mensFlair || !womensFlair || !wcFlair || !hasChanges}
                        className="w-full group h-14 bg-white text-black hover:bg-zinc-200 rounded-xl font-bold uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 mt-4 disabled:opacity-50"
                    >
                        {saving ? "Saving..." : hasChanges ? "Save Changes" : "No Changes"}
                        {hasChanges && !saving && <Send className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
                    </button>
                </form>

                <div className="mt-8 pt-8 border-t border-white/5 text-center">
                    <button
                        onClick={() => {
                            signOut();
                            navigate('/'); // REPLACE setView WITH navigate
                        }}
                        className="flex items-center gap-2 text-xs text-red-500/80 hover:text-red-400 uppercase tracking-widest font-bold transition-colors mx-auto"
                    >
                        <LogOut size={16} /> Log Out
                    </button>
                </div>
            </GlassPanel>
        </div>
    );
}
