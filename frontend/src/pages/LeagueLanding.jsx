import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { ArrowLeft, ArrowRight, Menu, Pause, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../lib/api';
import './LeagueLanding.css';

const STREAM_BASE_URL = 'https://pub-b7d837d92cb644838cb24feef9b3329e.r2.dev';
const STREAM_POSTERS = {
    wsl1: `${STREAM_BASE_URL}/loading-wsl1.avif`,
    wsl2: `${STREAM_BASE_URL}/loading-wsl2.avif`,
    wsl3: `${STREAM_BASE_URL}/loading-wsl3.avif`,
    superLeague1: `${STREAM_BASE_URL}/loading-superLeague1.avif`,
    superLeague2: `${STREAM_BASE_URL}/loading-superLeague2.avif`,
    superLeague3: `${STREAM_BASE_URL}/loading-superLeague3.avif`,
    freshers1: `${STREAM_BASE_URL}/loading-freshers1.avif`,
    freshers2: `${STREAM_BASE_URL}/loading-freshers2.avif`,
    freshers3: `${STREAM_BASE_URL}/loading-freshers3.avif`,
};
const STREAMS = {
    'super-league': ['superLeague1', 'superLeague2', 'superLeague3'],
    wsl: ['wsl1', 'wsl2', 'wsl3'],
    freshers: ['freshers1', 'freshers2', 'freshers3'],
};

const tournaments = [
    {
        id: 'super-league',
        eyebrow: 'IIIT Kottayam',
        title: 'Super League',
        detail: 'Men\'s division',
        accent: '#d9ff4a',
    },
    {
        id: 'wsl',
        eyebrow: 'IIIT Kottayam',
        title: 'WSL',
        detail: 'Women\'s division',
        accent: '#ff8a65',
    },
    {
        id: 'freshers',
        eyebrow: 'New season',
        title: 'Freshers',
        detail: 'Tournament 2026',
        accent: '#7dd3fc',
    },
];

// WARM-START
// Background probe. For each clip, in carousel order, it:
//   1. measures real download throughput (once, from the cheapest rung),
//   2. picks the best rung for that clip: the smallest one that covers the card at this screen's pixel
//      ratio, as long as the measured bandwidth can afford it,
//   3. downloads that rung into the HTTP cache and records it in `streamPlans`.
// When a slide later builds its hls.js instance it starts on the recorded rung (startLevel) with the
// measured bandwidth as its estimate, so it plays the optimal quality straight from cache.
// Needs the /media responses to be cacheable (Cache-Control forwarded by the proxy).
const warmedStreams = new Set();
const streamPlans = new Map(); // streamName -> { level }  (index into hls.js's sorted level list)
let measuredBandwidth = 0;     // bits per second, smoothed across the background downloads

const BANDWIDTH_SAFETY = 0.7;  // only pick a rung whose BANDWIDTH <= measured * this
const MAX_DPR = 2;             // cap devicePixelRatio when matching rung width to card width

const playlistUris = (text) => text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));

// `variants` must be in hls.js's level order (height, then bitrate), lowest first.
function pickLevel(variants, cardWidthCssPx, bandwidth) {
    const neededPx = cardWidthCssPx * Math.min(window.devicePixelRatio || 1, MAX_DPR);
    let target = 0;
    for (let i = 0; i < variants.length; i += 1) {
        if (i > 0 && bandwidth && variants[i].bandwidth > bandwidth * BANDWIDTH_SAFETY) break;
        target = i;
        if (variants[i].width >= neededPx) break;
    }
    return target;
}

async function warmStream(name, signal, cardWidthCssPx) {
    const masterUrl = new URL(`${API_BASE_URL}/media/${name}/master.m3u8`, window.location.href).href;
    const masterRes = await fetch(masterUrl, { signal });
    if (!masterRes.ok) throw new Error(`master ${masterRes.status}`);
    const masterLines = (await masterRes.text()).split('\n').map((line) => line.trim());

    const variants = [];
    masterLines.forEach((line, index) => {
        if (!line.startsWith('#EXT-X-STREAM-INF')) return;
        const bandwidth = Number((/BANDWIDTH=(\d+)/.exec(line) || [])[1]);
        const resolution = /RESOLUTION=(\d+)x(\d+)/.exec(line);
        const uri = masterLines.slice(index + 1).find((next) => next && !next.startsWith('#'));
        if (bandwidth && uri) {
            variants.push({
                bandwidth,
                uri,
                width: resolution ? Number(resolution[1]) : 0,
                height: resolution ? Number(resolution[2]) : 0,
            });
        }
    });
    // Same order hls.js uses for its level indexes: height first, then bitrate.
    variants.sort((a, b) => (a.height - b.height) || (a.bandwidth - b.bandwidth));
    if (!variants.length) return;

    // Downloads one rung's playlist and segments (bodies must be read in full to be cached) and
    // folds the observed throughput into measuredBandwidth.
    const fetchRung = async (variant) => {
        const levelUrl = new URL(variant.uri, masterUrl).href;
        const levelRes = await fetch(levelUrl, { signal });
        if (!levelRes.ok) throw new Error(`level ${levelRes.status}`);
        const segmentUrls = playlistUris(await levelRes.text()).map((uri) => new URL(uri, levelUrl).href);

        const started = performance.now();
        const sizes = await Promise.all(segmentUrls.map(async (url) => {
            const res = await fetch(url, { signal });
            if (!res.ok) throw new Error(`segment ${res.status}`);
            return (await res.arrayBuffer()).byteLength;
        }));
        const seconds = (performance.now() - started) / 1000;
        const bytes = sizes.reduce((sum, size) => sum + size, 0);
        // Ignore near-instant transfers: those came from the cache and say nothing about the network.
        if (seconds >= 0.03 && bytes > 0) {
            const sample = (bytes * 8) / seconds;
            measuredBandwidth = measuredBandwidth ? (measuredBandwidth * 0.5) + (sample * 0.5) : sample;
        }
    };

    // Until we have a throughput figure, take a sample from the cheapest rung before choosing.
    let downloaded = -1; // index of the rung already in the cache for this clip
    if (!measuredBandwidth) {
        await fetchRung(variants[0]);
        downloaded = 0;
    }

    let level = pickLevel(variants, cardWidthCssPx, measuredBandwidth);
    if (level !== downloaded) {
        await fetchRung(variants[level]);
        downloaded = level;
    }

    // Downloading the chosen rung gave a better measurement; re-check and, if it changes the answer,
    // warm the corrected rung too so playback still starts from cache.
    const refined = pickLevel(variants, cardWidthCssPx, measuredBandwidth);
    if (refined !== level) {
        level = refined;
        if (level !== downloaded) await fetchRung(variants[level]);
    }
    streamPlans.set(name, { level });
}
// WARM-END

const CLIP_COUNT = tournaments.length * 3;
const streamNameAt = (index) => STREAMS[tournaments[index % tournaments.length].id][Math.floor(index / tournaments.length)];

// Load and decode every AVIF loader image up front, in carousel order (slide 0 first). References are
// kept so the browser does not drop the decoded images. Returns a promise that resolves once every
// poster has been decoded (or has failed); the video probe waits for it, so posters always win.
const warmedPosters = [];
let posterWarmup = null;
function warmPosters() {
    if (posterWarmup) return posterWarmup;
    posterWarmup = Promise.all(Array.from({ length: CLIP_COUNT }, (_, index) => new Promise((resolve) => {
        const image = new Image();
        image.decoding = 'async';
        warmedPosters.push(image);
        image.onerror = () => resolve();
        image.src = STREAM_POSTERS[streamNameAt(index)];
        if (image.decode) image.decode().then(resolve, resolve);
        else image.onload = () => resolve();
    })));
    return posterWarmup;
}

export function LeagueLanding() {
    const [carouselIndex, setCarouselIndex] = useState(0);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [failedVideoSrc, setFailedVideoSrc] = useState('');
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const isPausedRef = useRef(isPaused);
    const touchStart = useRef(null);
    const navigate = useNavigate();
    const activeTournamentIndex = carouselIndex % tournaments.length;
    const mediaIndex = Math.floor(carouselIndex / tournaments.length);
    const activeTournament = tournaments[activeTournamentIndex];
    const streamName = STREAMS[activeTournament.id][mediaIndex];
    const videoSrc = `${API_BASE_URL}/media/${streamName}/master.m3u8`;
    const posterSrc = STREAM_POSTERS[streamName];
    const videoFailed = failedVideoSrc === videoSrc;
    const totalSlides = tournaments.length * 3;

    const goTo = (index) => {
        setCarouselIndex((index + totalSlides) % totalSlides);
    };

    useEffect(() => {
        isPausedRef.current = isPaused;
    }, [isPaused]);

    // Upfront loading, strictly in this order: all nine AVIFs first; then, once they are decoded and the
    // first clip has its first frame, the background probe over the other eight clips in carousel order;
    // finally clip 0 again so a second pass through the carousel starts on its optimal rung too.
    useEffect(() => {
        const postersDone = warmPosters();
        if (navigator.connection?.saveData) return undefined;
        const controller = new AbortController();

        (async () => {
            // Posters gate the video probe (capped at 4s so a slow image can never block it forever).
            await Promise.race([postersDone, new Promise((resolve) => setTimeout(resolve, 4000))]);
            if (controller.signal.aborted) return;
            const video = videoRef.current;
            await new Promise((resolve) => {
                if (!video || video.readyState >= 2) { resolve(); return; } // already has a frame
                const timer = setTimeout(resolve, 3000);
                video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
            });

            for (let step = 1; step <= CLIP_COUNT; step += 1) {
                if (controller.signal.aborted) return;
                const name = streamNameAt(step % CLIP_COUNT); // slides 1..8, then 0
                if (warmedStreams.has(name)) continue;
                try {
                    const cardWidth = videoRef.current?.clientWidth || window.innerWidth;
                    await warmStream(name, controller.signal, cardWidth);
                    warmedStreams.add(name);
                } catch (error) {
                    if (controller.signal.aborted) return;
                    console.info('Carousel prefetch skipped for', name, error);
                }
            }
        })();

        return () => controller.abort();
    }, []);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return undefined;

        let hls;
        const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const useNativeHls = isAppleMobile && Boolean(video.canPlayType('application/vnd.apple.mpegurl'));
        const startPlayback = () => {
            if (!isPausedRef.current) video.play().catch((error) => {
                // Autoplay can still be denied by browser policy.
                console.info('Carousel video autoplay was blocked:', error);
            });
        };
        // iOS Safari's native HLS handles mobile power, memory, and autoplay policies best.
        if (useNativeHls) {
            video.src = videoSrc;
            video.addEventListener('loadedmetadata', startPlayback, { once: true });
        } else if (Hls.isSupported()) {
            // The background probe's choice for this clip, if it has run yet; otherwise hls.js decides.
            const plan = streamPlans.get(streamName);
            hls = new Hls({
                startLevel: plan ? plan.level : -1,
                // With no plan (slide 0, or a slide skipped to before it was probed) hls.js would otherwise
                // download a throwaway first segment just to test bandwidth before loading the real one.
                // We already supply an estimate, so skip that extra round trip.
                testBandwidth: false,
                capLevelToPlayerSize: true,
                maxBufferLength: 8,
                maxMaxBufferLength: 12,
                abrEwmaDefaultEstimate: measuredBandwidth || 1200000,
                lowLatencyMode: false,
            });
            hlsRef.current = hls;
            hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data.fatal) {
                    console.error('Carousel HLS playback failed:', data.type, data.details, videoSrc);
                    setFailedVideoSrc(videoSrc);
                }
            });
            hls.loadSource(videoSrc);
            hls.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = videoSrc;
            video.addEventListener('loadedmetadata', startPlayback, { once: true });
        } else {
            console.error('This browser does not support HLS playback.');
            setFailedVideoSrc(videoSrc);
        }

        return () => {
            hls?.destroy();
            if (hlsRef.current === hls) hlsRef.current = null;
            video.removeEventListener('loadedmetadata', startPlayback);
            video.pause();
                video.removeAttribute('src');
                video.load();
        };
    }, [videoSrc]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (isPaused) video.pause();
        else video.play().catch(() => {});
    }, [isPaused, carouselIndex]);

    const openTournament = () => navigate(`/${activeTournament.id}`);
    const advanceWhenClipEnds = () => {
        if (!isPausedRef.current) setCarouselIndex((index) => (index + 1) % totalSlides);
    };

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'ArrowLeft') goTo(carouselIndex - 1);
            if (event.key === 'ArrowRight') goTo(carouselIndex + 1);
            if (event.key === 'Enter') navigate(`/${tournaments[activeTournamentIndex].id}`);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [carouselIndex, activeTournamentIndex, navigate]);

    return (
        <main
            className="league-landing"
            style={{ '--active-accent': activeTournament.accent }}
            onTouchStart={(event) => { touchStart.current = event.touches[0].clientX; }}
            onTouchEnd={(event) => {
                if (touchStart.current === null) return;
                const distance = event.changedTouches[0].clientX - touchStart.current;
                if (Math.abs(distance) > 45) goTo(carouselIndex + (distance < 0 ? 1 : -1));
                touchStart.current = null;
            }}
        >
            <div className="landing-noise" aria-hidden="true" />
            <header className="landing-header">
                <button className="landing-wordmark" onClick={() => goTo(0)} aria-label="Go to Super League">
                    <span>SUPER</span>
                    <span>LEAGUE</span>
                </button>
                <button
                    className="landing-menu"
                    onClick={() => setIsMenuOpen((isOpen) => !isOpen)}
                    aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
                    aria-expanded={isMenuOpen}
                >
                    <Menu size={26} strokeWidth={1.5} />
                </button>
            </header>

            <div className="landing-stage">
                <div className="landing-copy" key={activeTournament.id}>
                    <p className="landing-kicker">{activeTournament.eyebrow}</p>
                    <button className="landing-title" onClick={openTournament} aria-label={`Open ${activeTournament.title}`}>
                        {activeTournament.title}
                    </button>
                    <p className="landing-detail">{activeTournament.detail}</p>
                </div>

                <div className="landing-card-wrap">
                    <div className="landing-card">
                        {videoFailed ? (
                            <img src={posterSrc} alt={`${activeTournament.title} video preview`} className="landing-card-image" />
                        ) : (
                            <video
                                ref={videoRef}
                                key={`${activeTournament.id}-${mediaIndex}`}
                                src={Hls.isSupported() ? undefined : videoSrc}
                                poster={posterSrc}
                                className="landing-card-image"
                                autoPlay
                                muted
                                playsInline
                                preload="metadata"
                                onEnded={advanceWhenClipEnds}
                                onError={() => setFailedVideoSrc(videoSrc)}
                            />
                        )}
                        <span className="landing-card-shade" />
                        <span className="landing-card-mark">SL / 26</span>
                        <button type="button" className="landing-enter-button" onClick={openTournament}>
                            <span>Enter {activeTournament.title === 'Freshers' ? "Fresher's Tournament" : activeTournament.title}</span>
                        </button>
                        <span className="landing-redirect-note">Opens the {activeTournament.title} page</span>
                    </div>
                    <button type="button" className="landing-arrow landing-arrow-left" onPointerDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); goTo(carouselIndex - 1); }} aria-label="Previous carousel video">
                        <ArrowLeft size={20} strokeWidth={1.5} />
                    </button>
                    <button type="button" className="landing-arrow landing-arrow-right" onPointerDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); goTo(carouselIndex + 1); }} aria-label="Next carousel video">
                        <ArrowRight size={20} strokeWidth={1.5} />
                    </button>
                </div>

            </div>

            <footer className="landing-footer">
                <div className="landing-progress" aria-label="Tournament selection">
                    {tournaments.map((tournament, index) => (
                        <button key={tournament.id} className={`landing-progress-dot ${index === activeTournamentIndex ? 'is-active' : ''}`} onClick={() => goTo(index + (mediaIndex * tournaments.length))} aria-label={`Show ${tournament.title}`} />
                    ))}
                </div>
                <button
                    type="button"
                    className="landing-play-pause"
                    onClick={() => setIsPaused((paused) => !paused)}
                    aria-label={isPaused ? 'Play carousel video' : 'Pause carousel video'}
                    title={isPaused ? 'Play' : 'Pause'}
                >
                    {isPaused ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}
                    <span>{isPaused ? 'Play' : 'Pause'}</span>
                </button>
            </footer>

            <div className={`landing-menu-panel ${isMenuOpen ? 'is-open' : ''}`}>
                <button onClick={() => navigate('/login')}>Sign in / Join</button>
                {tournaments.map((tournament) => (
                    <button key={tournament.id} onClick={() => navigate(`/${tournament.id}`)}>
                        {tournament.title}
                    </button>
                ))}
            </div>
        </main>
    );
}
