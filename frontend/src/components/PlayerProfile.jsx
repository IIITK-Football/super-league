/* eslint-disable react/prop-types -- this codebase does not use prop-types */
import { useEffect, useState } from 'react';
import { ArrowLeft, Hexagon } from 'lucide-react';
import { useLeague } from '../context/LeagueContext';
import styles from './PlayerProfile.module.css';
import { API_BASE_URL } from '../lib/api';
import FutCard from './players/FutCard';
import { canonicalAttributes, catalogStyle, statValue } from '../lib/playerCard';
import { Button, EmptyState, ErrorState, Skeleton } from './ui';

const CORE_STATS = ['Pace', 'Shooting', 'Passing', 'Dribbling', 'Defending', 'Physicality'];

// A player's page: the FUT card, identity, core stats and season history. The card shows the season being browsed.
export default function PlayerProfile({ onBack }) {
    const { setView, seasonScope } = useLeague();
    const seasonId = seasonScope?.season?.id || '';
    const [player, setPlayer] = useState(null);
    const [status, setStatus] = useState('loading');
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const raw = sessionStorage.getItem('selectedPlayer');
        if (!raw) {
            setView('teams');
            return;
        }

        const base = JSON.parse(raw);
        const cacheKey = `player_profile_${base.id}_${seasonId}`;
        const cachedProfile = sessionStorage.getItem(cacheKey);
        if (cachedProfile) {
            setPlayer(JSON.parse(cachedProfile));
            setStatus('ready');
            return;
        }

        setStatus('loading');
        fetch(`${API_BASE_URL}/players/${base.id}${seasonId ? `?season_id=${seasonId}` : ''}`)
            .then((r) => r.json())
            .then((res) => {
                if (res.success) {
                    setPlayer(res.data);
                    setStatus('ready');
                    sessionStorage.setItem(cacheKey, JSON.stringify(res.data));
                } else {
                    setStatus('error');
                }
            })
            .catch(() => setStatus('error'));
    }, [setView, seasonId, attempt]);

    const handleBack = () => {
        sessionStorage.removeItem('selectedPlayer');
        if (onBack) onBack();
        else setView('teams');
    };

    const back = (
        <Button variant="quiet" onClick={handleBack} className="w-max px-0">
            <ArrowLeft size={18} aria-hidden="true" />
            Back to squad
        </Button>
    );

    if (status === 'loading') {
        return (
            <div aria-busy="true" aria-label="Loading player" className="mx-auto max-w-6xl space-y-6">
                {back}
                <div className="grid gap-6 md:grid-cols-[260px_1fr]">
                    <Skeleton className="mx-auto h-[380px] w-[260px] rounded-card" />
                    <div className="space-y-4">
                        <Skeleton className="h-10 w-2/3" />
                        <Skeleton className="h-24 w-full" />
                    </div>
                </div>
            </div>
        );
    }

    if (status === 'error' || !player) {
        return (
            <div className="mx-auto max-w-3xl space-y-5">
                {back}
                {status === 'error'
                    ? <ErrorState title="This player could not load" message="Check your connection and try again." onRetry={() => setAttempt((n) => n + 1)} />
                    : <EmptyState title="Player not found">This player is not in this season.</EmptyState>}
            </div>
        );
    }

    // The canonical card fields (stats, preferred foot, the one play style); empty stays empty.
    const attrs = canonicalAttributes(player.attributes);
    const bio = attrs.bio || {};
    const playStyle = catalogStyle(attrs.playStyle);

    return (
        <div className="mx-auto max-w-6xl space-y-8 pb-12">
            {back}

            <div className={styles.mainLayout}>
                <div className={styles.cardArea}>
                    <FutCard player={player} position={player.position || 'RES'} />
                </div>

                <div className={styles.headerArea}>
                    <div>
                        <span className="block font-display text-2xl font-bold leading-tight text-mut sm:text-3xl">
                            {player.first_name}
                        </span>
                        <span className="block font-display text-4xl font-bold leading-none text-ink sm:text-5xl lg:text-6xl">
                            {player.last_name}
                        </span>
                    </div>

                    <dl className={`w-max rounded-card border border-line bg-surf p-4 ${styles.bioGrid}`}>
                        <div>
                            <dt className="text-xs uppercase tracking-wider text-mut">Position</dt>
                            <dd className="mt-1 font-semibold text-ink">{player.position || '—'}</dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-wider text-mut">Preferred foot</dt>
                            <dd className="mt-1 font-semibold text-ink">{bio.preferredFoot || '—'}</dd>
                        </div>
                    </dl>
                </div>

                <section aria-label="Core attributes" className={`${styles.attrsArea} rounded-card border border-line bg-surf p-5 sm:p-6`}>
                    <h2 className="mb-6 border-b border-line pb-4 font-display text-2xl font-bold text-ink">Core attributes</h2>
                    <div className={styles.coreAttributesGrid}>
                        {CORE_STATS.map((category) => {
                            const total = statValue(attrs, category);
                            return (
                                <div key={category} className="grid gap-2 text-sm">
                                    <div className="flex items-baseline justify-between font-semibold text-mut">
                                        <span>{category}</span>
                                        <span className="font-display text-2xl font-bold tabular-nums text-ink">{total ?? '—'}</span>
                                    </div>
                                    <div className="h-1.5 w-full overflow-hidden rounded-pill bg-raise" role="presentation">
                                        <div className="h-full bg-acc" style={{ width: `${total ?? 0}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {playStyle && (
                    <section aria-label="Play style" className={`${styles.stylesArea} rounded-card border border-line bg-surf p-5`}>
                        <div className="grid grid-cols-[auto_1fr] items-center gap-5">
                            {playStyle.imageUrl ? (
                                <img
                                    src={playStyle.imageUrl}
                                    alt={playStyle.name}
                                    className="size-14 select-none object-contain"
                                    onContextMenu={(e) => e.preventDefault()}
                                    draggable="false"
                                />
                            ) : (
                                <div className="grid size-14 place-content-center rounded-ctl border border-line bg-raise">
                                    <Hexagon size={26} aria-hidden="true" className="text-mut" />
                                </div>
                            )}
                            <div className="grid gap-1">
                                <span className="font-display text-xl font-bold text-ink">{playStyle.name}</span>
                                <p className="text-sm leading-relaxed text-mut">
                                    {playStyle.description || 'A play style from the catalogue.'}
                                </p>
                            </div>
                        </div>
                    </section>
                )}

                <div className={styles.historyArea}>
                    <SeasonHistory player={player} />
                </div>
            </div>
        </div>
    );
}

// One line per season (team, number, position, goals, assists) and a career line that adds them up. Goals and
// assists always belong to a season; the career line is computed, never stored.
export function SeasonHistory({ player }) {
    const seasons = player?.seasons || [];
    return (
        <section aria-label="Season history" className="col-span-full rounded-card border border-line bg-surf p-5 sm:p-6">
            <h2 className="mb-4 border-b border-line pb-4 font-display text-2xl font-bold text-ink">Season history</h2>
            {seasons.length === 0 ? (
                <p className="text-sm text-mut">No seasons played yet.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs uppercase tracking-wider text-mut">
                                <th scope="col" className="py-2 pr-4 font-semibold">Season</th>
                                <th scope="col" className="py-2 pr-4 font-semibold">Team</th>
                                <th scope="col" className="py-2 pr-4 font-semibold">No.</th>
                                <th scope="col" className="py-2 pr-4 font-semibold">Pos.</th>
                                <th scope="col" className="py-2 pr-4 text-right font-semibold">Goals</th>
                                <th scope="col" className="py-2 text-right font-semibold">Assists</th>
                            </tr>
                        </thead>
                        <tbody>
                            {seasons.map((line) => (
                                <tr key={line.season.id} className="border-t border-line">
                                    <td className="py-2 pr-4 font-semibold text-ink">{line.division?.name ? `${line.division.name} ` : ''}{line.season.name}</td>
                                    <td className="py-2 pr-4 text-ink">{line.team?.name || '—'}</td>
                                    <td className="py-2 pr-4 tabular-nums">{line.jersey_number ?? '—'}</td>
                                    <td className="py-2 pr-4">{line.position || '—'}</td>
                                    <td className="py-2 pr-4 text-right font-display text-lg font-bold tabular-nums">{line.goals}</td>
                                    <td className="py-2 text-right font-display text-lg font-bold tabular-nums">{line.assists}</td>
                                </tr>
                            ))}
                        </tbody>
                        {player.career && (
                            <tfoot>
                                <tr className="border-t border-ink font-bold">
                                    <td className="py-2 pr-4" colSpan={4}>Career ({player.career.seasons} {player.career.seasons === 1 ? 'season' : 'seasons'})</td>
                                    <td className="py-2 pr-4 text-right font-display text-lg tabular-nums">{player.career.goals}</td>
                                    <td className="py-2 text-right font-display text-lg tabular-nums">{player.career.assists}</td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            )}
        </section>
    );
}
