import React, { useEffect, useState } from 'react';
import { useLeague } from '../context/LeagueContext';
import { ArrowLeft, Loader2, Shield, Hexagon } from 'lucide-react';
import { Loader } from './Loader';
import styles from './PlayerProfile.module.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const getStatColor = (val) => {
    if (val >= 80) return 'bg-[#00e676]';
    if (val >= 70) return 'bg-[#ffc400]';
    if (val >= 60) return 'bg-[#ff9100]';
    return 'bg-[#ff1744]';
};

const getCardBackground = (rating) => {
    const num = parseInt(rating) || 50;
    if (num >= 85) return "url('/gold.png')";
    if (num >= 70) return "url('/silver.png')";
    return "url('/bronze.png')";
};

const getCardTextColor = (rating) => {
    const num = parseInt(rating) || 50;
    if (num >= 85) return "text-amber-950";
    if (num >= 70) return "text-zinc-900";
    return "text-orange-950";
};

// THE MAGIC MULTIPLIER FUNCTION
const getAdjustedStat = (val, isMens) => {
    return parseInt(val) || 0;
};

const defaultAttributes = {
    bio: { preferredFoot: "Right" },
    stats: {
        Pace: { total: 0 },
        Shooting: { total: 0 },
        Passing: { total: 0 },
        Dribbling: { total: 0 },
        Defending: { total: 0 },
        Physicality: { total: 0 }
    },
    playStyles: []
};

export default function PlayerProfile({ onBack }) {
    // 1. PULL DIVISION FROM CONTEXT
    const { setView, division } = useLeague();
    const [player, setPlayer] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const isMens = division === 'mens'; // Check if we should apply the buff

useEffect(() => {
        const raw = sessionStorage.getItem('selectedPlayer');
        if (!raw) {
            setView('teams');
            return;
        }

        const base = JSON.parse(raw);

        // 1. THE FIX: Check if we already fetched this player's deep data recently
        const cachedProfile = sessionStorage.getItem(`player_profile_${base.id}`);
        if (cachedProfile) {
            setPlayer(JSON.parse(cachedProfile));
            setLoading(false);
            return; // Exit early! No API call needed.
        }

        // 2. If not cached, fetch it from the API
        fetch(`${API_BASE_URL}/players/${base.id}`)
            .then(r => r.json())
            .then(res => {
                if (res.success) {
                    setPlayer(res.data);
                    // 3. Save the successful result to memory so we never have to fetch it again this session!
                    sessionStorage.setItem(`player_profile_${base.id}`, JSON.stringify(res.data));
                }
                else setError('Failed to load player.');
            })
            .catch(() => setError('Failed to load player.'))
            .finally(() => setLoading(false));
    }, [setView]);

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

    const attrs = player.attributes || defaultAttributes;
    const stats = attrs.stats || defaultAttributes.stats;
    const bio = attrs.bio || defaultAttributes.bio;
    const stylesArr = attrs.playStyles || [];

    // 2. APPLY MULTIPLIER TO OVERALL RATING
    const displayRating = getAdjustedStat(player.overall_rating || 50, isMens);
    
    // Pass the calculated displayRating to ensure the card color upgrades if they cross a threshold!
    const cardBgImage = getCardBackground(displayRating);
    const cardTextColor = getCardTextColor(displayRating);

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
                    <div className="relative w-max drop-shadow-2xl">
                        <div
                            className="relative w-[260px] h-[380px] bg-center bg-no-repeat select-none overflow-hidden z-10"
                            style={{
                                backgroundImage: cardBgImage,
                                backgroundSize: '100% 100%'
                            }}
                        >
                            <div className={`absolute top-[22%] left-[16%] flex flex-col items-start z-10 ${cardTextColor}`}>
                                <span className="text-4xl font-black leading-none tabular-nums">
                                    {/* Display the buffed overall rating */}
                                    {displayRating}
                                </span>
                                <span className="text-sm font-bold uppercase tracking-wider">
                                    {player.position || 'RES'}
                                </span>
                            </div>

                            <div className="absolute top-[18%] left-0 w-full flex justify-center">
                                {player.image_url ? (
                                    <img
                                        src={player.image_url}
                                        alt={player.name}
                                        className="h-[175px] object-contain drop-shadow-2xl select-none" // <-- Added select-none
            onContextMenu={(e) => e.preventDefault()} // <-- Disables right-click
            draggable="false" // <-- Disables dragging
                                    />
                                ) : (
                                    <Shield className={`h-[175px] w-auto opacity-40 ${cardTextColor}`} />
                                )}
                            </div>

                            <div className={`absolute bottom-[28%] left-0 w-full text-center ${cardTextColor}`}>
                                <div className="font-black text-[14px] uppercase tracking-widest">
                                    {player.first_name || player.last_name}
                                </div>
                            </div>

                            <div className={`absolute bottom-[19%] left-0 w-full px-6 ${cardTextColor}`}>
                                <div className={`text-center ${styles.cardStatsGrid}`}>
                                    {[
                                        { label: 'PAC', value: stats.Pace?.total },
                                        { label: 'SHO', value: stats.Shooting?.total },
                                        { label: 'PAS', value: stats.Passing?.total },
                                        { label: 'DRI', value: stats.Dribbling?.total },
                                        { label: 'DEF', value: stats.Defending?.total },
                                        { label: 'PHY', value: stats.Physicality?.total },
                                    ].map((stat) => {
                                        // 3. APPLY MULTIPLIER TO EACH INDIVIDUAL CARD STAT
                                        const finalVal = getAdjustedStat(stat.value, isMens);
                                        return (
                                            <div key={stat.label} className="grid grid-rows-2 justify-items-center">
                                                <span className="text-[9px] font-bold opacity-80">
                                                    {stat.label}
                                                </span>
                                                <span className="text-[15px] font-black leading-none">
                                                    {finalVal}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {stylesArr.length > 0 && stylesArr[0].icon_url && (
                            <img
                                src={stylesArr[0].icon_url}
                                alt={stylesArr[0].name}
                                className="absolute top-[48%] left-[26px] -translate-x-1/2 -translate-y-1/2 z-20 w-8 h-8 object-contain"
                                onContextMenu={(e) => e.preventDefault()}
            draggable="false"
                            />
                        )}
                    </div>
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
                            <span className="font-bold text-sm block mt-1">{bio.preferredFoot || 'Right'}</span>
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
                                const rawVal = stats[category]?.total || 0;
                                const val = getAdjustedStat(rawVal, isMens);

                                return (
                                    <div key={category} className="grid gap-2 text-sm">
                                        <div className="flex justify-between text-gray-300 font-bold uppercase tracking-wider">
                                            <span>{category}</span>
                                            <span className="text-white text-lg tabular-nums">{val}</span>
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
            </div>
        </div>
    );
}
