/* eslint-disable react/prop-types -- this codebase does not use prop-types */
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { API_BASE_URL } from '../lib/api';
import { supabase } from '../lib/supabase';
import { cn } from '../utils/cn';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
function usePrefersMotion() {
    const [motion, setMotion] = useState(() => !window.matchMedia?.(REDUCED_MOTION).matches);
    useEffect(() => {
        const query = window.matchMedia?.(REDUCED_MOTION);
        if (!query) return undefined;
        const update = () => setMotion(!query.matches);
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, []);
    return motion;
}

// Divisions from data, each with its current season and its live or next match (when there is one).
async function loadDivisionCards() {
    const { data: divisions, error } = await supabase.from('divisions')
        .select('id, slug, name, primary_color, logo_url, landing_video_key, is_featured, archived_at')
        .eq('visibility', 'public').is('archived_at', null)
        .order('sort_order', { ascending: true }).order('name', { ascending: true });
    if (error) throw error;
    const visible = (divisions || []).filter((d) => !d.archived_at);
    if (visible.length === 0) return [];

    const { data: seasons, error: seasonsError } = await supabase.from('seasons')
        .select('id, division_id, name').in('division_id', visible.map((d) => d.id)).eq('is_current', true)
        .eq('visibility', 'public').is('archived_at', null);
    if (seasonsError) throw seasonsError;
    const seasonIds = (seasons || []).map((s) => s.id);

    let matches = [];
    if (seasonIds.length) {
        const { data, error: matchError } = await supabase.from('matches')
            .select('id, season_id, status, date, home_score, away_score, home:teams!home_team_id(name), away:teams!away_team_id(name)')
            .in('season_id', seasonIds).in('status', ['live', 'scheduled']).order('date', { ascending: true });
        if (matchError) throw matchError;
        matches = data || [];
    }

    return visible.map((division) => {
        const season = (seasons || []).find((s) => s.division_id === division.id) || null;
        const own = matches.filter((m) => season && m.season_id === season.id);
        const live = own.find((m) => m.status === 'live') || null;
        const next = own.find((m) => m.status === 'scheduled') || null;
        return { division, season, live, next };
    });
}

function useDivisionCards() {
    const [state, setState] = useState({ status: 'loading', cards: [] });
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let cancelled = false;
        loadDivisionCards().then(
            (cards) => { if (!cancelled) setState({ status: 'ready', cards }); },
            () => { if (!cancelled) setState({ status: 'error', cards: [] }); },
        );
        return () => { cancelled = true; };
    }, [attempt]);
    return { ...state, retry: () => { setState({ status: 'loading', cards: [] }); setAttempt((n) => n + 1); } };
}

// The live score or next kick-off of a division, one line.
function MatchLine({ match }) {
    const home = match.home?.name;
    const away = match.away?.name;
    if (!home || !away) return null;
    const live = match.status === 'live';
    const when = match.date ? new Date(match.date).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    return (
        <span className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase tracking-wider">
            {live && <span aria-hidden="true" className="size-1.5 shrink-0 animate-pulse-dot rounded-full bg-live" />}
            <span className="truncate">{home}</span>{' '}
            <span className="shrink-0 font-display tabular-nums">{live ? `${match.home_score ?? 0} - ${match.away_score ?? 0}` : 'vs'}</span>{' '}
            <span className="truncate">{away}</span>
            {!live && when && <span className="shrink-0 opacity-60">{when}</span>}
        </span>
    );
}

// A division as a glass panel along the bottom of the hero. The division whose clip is playing is lit.
function DivisionCard({ card, active }) {
    const { division, season, live, next } = card;
    const match = live || next;
    return (
        <Link
            to={`/${division.slug}`}
            aria-current={active ? 'true' : undefined}
            className={cn(
                'lift group flex min-h-24 items-center gap-4 rounded-card border p-4 backdrop-blur-xl transition-colors duration-500 sm:p-5',
                active ? 'border-white bg-white text-black' : 'border-white/15 bg-black/40 text-white hover:bg-black/55',
            )}
        >
            {division.logo_url && <img src={division.logo_url} alt="" className="h-12 w-12 shrink-0 object-contain" />}
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-baseline gap-2">
                    <span className="truncate font-display text-xl uppercase leading-none tracking-tight sm:text-2xl">{division.name}</span>
                    {season && <span className={cn('eyebrow shrink-0', active ? 'text-black/50' : 'text-white/50')}>{season.name}</span>}
                </span>
                {match && <span className={active ? 'text-black/75' : 'text-white/75'}><MatchLine match={match} /></span>}
            </span>
            <ArrowRight aria-hidden="true" size={18} className="shrink-0 transition-transform group-hover:translate-x-1" />
        </Link>
    );
}

function LandingVideo({ videoKey }) {
    const ref = useRef(null);
    const motion = usePrefersMotion();
    const [paused, setPaused] = useState(false);
    useEffect(() => {
        const video = ref.current;
        if (!video || !videoKey || !motion) return undefined;
        const source = `${API_BASE_URL}/media/${encodeURIComponent(videoKey)}/master.m3u8`;
        let hls;
        if (Hls.isSupported()) {
            hls = new Hls();
            hls.loadSource(source);
            hls.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = source;
        }
        return () => { hls?.destroy(); video.pause(); video.removeAttribute('src'); video.load(); };
    }, [videoKey, motion]);
    if (!motion || !videoKey) return null;
    return <>
        <video ref={ref} aria-hidden="true" autoPlay muted playsInline loop className="absolute inset-0 size-full object-cover" />
        <button type="button" className="absolute bottom-6 right-6 z-10 rounded-pill bg-black/70 px-4 py-2 text-sm text-white" onClick={() => {
            if (paused) ref.current?.play(); else ref.current?.pause();
            setPaused(!paused);
        }}>{paused ? 'Play background video' : 'Pause background video'}</button>
    </>;
}

export function LeagueLanding() {
    const { status, cards, retry } = useDivisionCards();
    const current = cards.find((card) => card.division.is_featured);
    const others = cards.filter((card) => card !== current);
    return <main className="bg-black text-white">
        <section className="relative isolate flex min-h-svh flex-col overflow-hidden">
            <div className="absolute inset-0 overflow-hidden">
                <LandingVideo videoKey={current?.division.landing_video_key} />
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black/60" />
            </div>
            <header className="relative flex justify-end p-6"><Link to="/login" className="glass rounded-pill px-5 py-3">Sign in</Link></header>
            <div className="pointer-events-none relative flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center [&_a]:pointer-events-auto">
                {current ? <>
                    {current.division.logo_url && <img src={current.division.logo_url} alt="" className="h-24 w-24 object-contain sm:h-36 sm:w-36" />}
                    <h1 className="font-display text-6xl font-black uppercase sm:text-8xl">{current.division.name}</h1>
                    {current.season && <p className="eyebrow">{current.season.name}</p>}
                    <Link to={`/${current.division.slug}`} className="lift rounded-pill bg-white px-7 py-4 font-bold text-black">Enter {current.division.name}</Link>
                </> : status === 'loading' ? <Skeleton className="h-20 w-64" /> : <h1 className="font-display text-5xl">Divisions</h1>}
                {others.length > 0 && <a href="#divisions" className="text-sm underline underline-offset-4">Explore other divisions</a>}
            </div>
        </section>
        <section id="divisions" aria-label="Divisions" className="mx-auto max-w-7xl space-y-5 px-4 py-16 sm:px-8">
            <h2 className="font-display text-4xl">{current ? 'Other divisions' : 'Divisions'}</h2>
            {status === 'loading' && <ul aria-busy="true" aria-label="Loading divisions"><li><Skeleton className="h-24" /></li></ul>}
            {status === 'error' && <ErrorState title="Divisions could not load" message="Check your connection and try again." onRetry={retry} />}
            {status === 'ready' && cards.length === 0 && <EmptyState title="No divisions yet">Divisions appear here once they are set up.</EmptyState>}
            {others.length > 0 && <ul className="grid list-none gap-3 p-0 md:grid-cols-3">{others.map((card) => <li key={card.division.id}><DivisionCard card={card} /></li>)}</ul>}
        </section>
    </main>;
}
