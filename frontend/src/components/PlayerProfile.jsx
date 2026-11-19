import React, { useEffect, useState } from 'react';
import { useLeague } from '../context/LeagueContext';
import { ArrowLeft, Loader2, Shield, Hexagon } from 'lucide-react';
import { Loader } from './Loader';
import styles from './PlayerProfile.module.css';
import { API_BASE_URL } from '../lib/api';
import FutCard from './players/FutCard';
import { canonicalAttributes, statValue } from '../lib/playerCard';


const getStatColor = (val) => {
    if (val >= 80) return 'bg-[#00e676]';
    if (val >= 70) return 'bg-[#ffc400]';
    if (val >= 60) return 'bg-[#ff9100]';
    return 'bg-[#ff1744]';
};



export default function PlayerProfile({ onBack }) {
    // 1. PULL DIVISION FROM CONTEXT
    const { setView, seasonScope } = useLeague();
    // The card shows the season being browsed; the history below lists every season.
    const seasonId = seasonScope?.season?.id || '';
    const [player, setPlayer] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);


useEffect(() => {
        const raw = sessionStorage.getItem('selectedPlayer');
        if (!raw) {
            setView('teams');
            return;
        }

        const base = JSON.parse(raw);

        // 1. THE FIX: Check if we already fetched this player's deep data recently
        const cacheKey = `player_profile_${base.id}_${seasonId}`;
        const cachedProfile = sessionStorage.getItem(cacheKey);
        if (cachedProfile) {
            setPlayer(JSON.parse(cachedProfile));
            setLoading(false);
            return; // Exit early! No API call needed.
        }

        // 2. If not cached, fetch it from the API
        fetch(`${API_BASE_URL}/players/${base.id}${seasonId ? `?season_id=${seasonId}` : ''}`)
            .then(r => r.json())
            .then(res => {
                if (res.success) {
                    setPlayer(res.data);
                    // 3. Save the successful result to memory so we never have to fetch it again this session!
                    sessionStorage.setItem(cacheKey, JSON.stringify(res.data));
                }
                else setError('Failed to load player.');
            })
            .catch(() => setError('Failed to load player.'))
            .finally(() => setLoading(false));
    }, [setView, seasonId]);

    const handleBack = () => {
      sessionStorage.removeItem('selectedPlayer');
      if (onBack) onBack();
      else setView('teams');
  };

    if (loading) {
        return <Loader text="Loading Player..." />;
    }

    if (error || !player) {
        return (
            <div className="grid place-content-center justify-items-center min-h-[50vh] text-zinc-500 gap-4">
                <Shield className="w-12 h-12 text-zinc-700" />
                <span className="font-black tracking-[0.3em] uppercase text-sm">
                    {error || 'Player not found'}
                </span>
                <button
                    onClick={handleBack}
                    className="text-xs text-zinc-400 hover:text-white uppercase tracking-widest font-bold transition-colors"
                >
                    Back to Teams
                </button>
            </div>
        );
    }

    // The canonical card fields (stats, preferred foot, play styles); empty stays empty.
    const attrs = canonicalAttributes(player.attributes);
    const bio = attrs.bio || {};
    const stylesArr = attrs.playStyles || [];

    return (
        <div className="w-full bg-[#0F0E13] min-h-screen text-white p-4 md:p-8 font-sans pb-20 animate-in fade-in duration-300">
            <button
                onClick={handleBack}
                className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-6 group w-max"
            >
                <ArrowLeft
                    size={20}
                    className="group-hover:-translate-x-1 transition-transform"
                />
                Back to Squad
            </button>

            <div className={styles.mainLayout}>
                <div className={styles.cardArea}>
                    <FutCard player={player} position={player.position || 'RES'} />
                </div>

                <div className={styles.headerArea}>
                    <div>
                        <span className="block text-2xl sm:text-3xl font-bold text-gray-300 leading-tight">
                            {player.first_name}
                        </span>
                        <span className="block text-4xl sm:text-5xl lg:text-6xl font-black leading-none">
                            {player.last_name}
                        </span>
                    </div>

                    <div className={`bg-[#1A1820] w-max rounded-xl p-3 border border-white/5 ${styles.bioGrid}`}>
                        <div>
                            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Position</p>
                            <span className="bg-white/10 px-2 py-1 rounded text-sm font-bold">
                                {player.position || '—'}
                            </span>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Pref. Foot</p>
                            <span className="font-bold text-sm block mt-1">{bio.preferredFoot || '—'}</span>
                        </div>
                    </div>
                </div>

                <div className={styles.attrsArea}>
                    <div className="bg-[#1A1820] rounded-2xl p-6 border border-white/5 h-full">
                        <h3 className="text-xl font-black uppercase tracking-widest mb-6 border-b border-white/10 pb-4">
                            Core Attributes
                        </h3>

                        <div className={styles.coreAttributesGrid}>
                            {['Pace', 'Shooting', 'Passing', 'Dribbling', 'Defending', 'Physicality'].map(category => {
                                // 4. APPLY MULTIPLIER TO PROGRESS BARS
                                const total = statValue(attrs, category);
                                const val = total ?? 0;

                                return (
                                    <div key={category} className="grid gap-2 text-sm">
                                        <div className="flex justify-between text-gray-300 font-bold uppercase tracking-wider">
                                            <span>{category}</span>
                                            <span className="text-white text-lg tabular-nums">{total ?? '—'}</span>
                                        </div>

                                        <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full ${getStatColor(val)}`}
                                                style={{ width: `${val}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {stylesArr.length > 0 && (
                    <div className={styles.stylesArea}>
                        {stylesArr.map(style => (
                            <div
                                key={style.name}
                                className="bg-[#1C1C24] rounded-2xl p-5 border border-white/5 grid grid-cols-[auto_1fr] gap-5 items-center shadow-lg"
                            >
                                {style.icon_url ? (
                                    <img
                                        src={style.icon_url}
                                        alt={style.name}
                                        className="w-14 h-14 object-contain drop-shadow-md select-none"
                                        onContextMenu={(e) => e.preventDefault()}
                                         draggable="false"
                                    />
                                ) : (
                                    <div className="w-14 h-14 grid place-content-center bg-black/50 rounded-xl border border-white/10">
                                        <Hexagon size={26} className="text-[#E8C881]" />
                                    </div>
                                )}

                                <div className="grid gap-1">
                                    <span className="font-black text-xl text-white tracking-wide">
                                        {style.name}
                                    </span>
                                    <p className="text-sm text-zinc-400 leading-relaxed">
                                        {style.description || `Grants unique mechanics and precision on the pitch.`}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <SeasonHistory player={player} />
            </div>
        </div>
    );
}

// One line per season (team, number, position, goals, assists) and a career line that adds them up. Goals and
// assists always belong to a season; the career line is computed, never stored.
export function SeasonHistory({ player }) {
    const seasons = player?.seasons || [];
    return (
        <section aria-label="Season history" className="col-span-full bg-[#1A1820] rounded-2xl p-6 border border-white/5">
            <h3 className="text-xl font-black uppercase tracking-widest mb-4 border-b border-white/10 pb-4">Season history</h3>
            {seasons.length === 0 ? (
                <p className="text-sm text-zinc-500">No seasons played yet.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400">
                                <th className="py-2 pr-4">Season</th>
                                <th className="py-2 pr-4">Team</th>
                                <th className="py-2 pr-4">No.</th>
                                <th className="py-2 pr-4">Pos.</th>
                                <th className="py-2 pr-4 text-right">Goals</th>
                                <th className="py-2 text-right">Assists</th>
                            </tr>
                        </thead>
                        <tbody>
                            {seasons.map((line) => (
                                <tr key={line.season.id} className="border-t border-white/5">
                                    <td className="py-2 pr-4 font-bold">{line.division?.name ? `${line.division.name} ` : ''}{line.season.name}</td>
                                    <td className="py-2 pr-4 text-zinc-300">{line.team?.name || '—'}</td>
                                    <td className="py-2 pr-4 tabular-nums">{line.jersey_number ?? '—'}</td>
                                    <td className="py-2 pr-4">{line.position || '—'}</td>
                                    <td className="py-2 pr-4 text-right tabular-nums">{line.goals}</td>
                                    <td className="py-2 text-right tabular-nums">{line.assists}</td>
                                </tr>
                            ))}
                        </tbody>
                        {player.career && (
                            <tfoot>
                                <tr className="border-t border-white/20 font-black">
                                    <td className="py-2 pr-4" colSpan={4}>Career ({player.career.seasons} {player.career.seasons === 1 ? 'season' : 'seasons'})</td>
                                    <td className="py-2 pr-4 text-right tabular-nums">{player.career.goals}</td>
                                    <td className="py-2 text-right tabular-nums">{player.career.assists}</td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            )}
        </section>
    );
}
