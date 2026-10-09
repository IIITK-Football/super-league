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
        detail: "Men's division",
        accent: '#d9ff4a',
    },
    {
        id: 'wsl',
        eyebrow: 'IIIT Kottayam',
        title: 'WSL',
        detail: "Women's division",
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

const CLIP_COUNT = tournaments.length * 3;
const masterUrlFor = (name) =>
    `${API_BASE_URL}/media/${name}/master.m3u8`;

// Carousel order:
// Super League 1, WSL 1, Freshers 1,
// Super League 2, WSL 2, Freshers 2, etc.
function streamNameAt(index) {
    const safeIndex = ((index % CLIP_COUNT) + CLIP_COUNT) % CLIP_COUNT;

    return STREAMS[
        tournaments[safeIndex % tournaments.length].id
    ][Math.floor(safeIndex / tournaments.length)];
}

function levelBitrate(level) {
    return (
        Number(level?.maxBitrate) ||
        Number(level?.bitrate) ||
        Number(level?.averageBitrate) ||
        Number(level?.realBitrate) ||
        0
    );
}

// Do not assume that hls.levels[0] is the highest-quality rendition.
// Select the highest available bitrate using the actual level metadata.
function highestBitrateLevelIndex(levels) {
    if (!levels?.length) return -1;

    let bestIndex = -1;

    for (let index = 0; index < levels.length; index += 1) {
        const level = levels[index];

        if (level?.supported === false) continue;

        if (
            bestIndex === -1 ||
            levelBitrate(level) > levelBitrate(levels[bestIndex])
        ) {
            bestIndex = index;
        }
    }

    return bestIndex;
}

function describeLevel(level, index) {
    const levelUrls = Array.isArray(level?.url)
        ? level.url.join(' ')
        : String(level?.url || level?.uri || '');

    const vMatch = /(?:^|[\/_-])v([012])(?:[\/._-]|$)/i.exec(levelUrls);
    const name = vMatch ? `V${vMatch[1]}` : `level ${index}`;

    const bitrate = levelBitrate(level);
    const resolution =
        level?.width && level?.height
            ? ` ${level.width}x${level.height}`
            : '';

    return (
        `${name}${resolution}` +
        (bitrate ? ` ${(bitrate / 1_000_000).toFixed(2)} Mbps` : '')
    );
}

// Warm lightweight AVIF posters only.
// HLS.js handles all video downloads and buffering.
const warmedPosters = [];
let posterWarmup = null;

function warmPosters() {
    if (posterWarmup) return posterWarmup;

    posterWarmup = Promise.all(
        Object.values(STREAM_POSTERS).map(
            (src) =>
                new Promise((resolve) => {
                    const image = new Image();

                    image.decoding = 'async';
                    warmedPosters.push(image);

                    image.onload = () => resolve();
                    image.onerror = () => resolve();

                    image.src = src;

                    if (image.decode) {
                        image.decode().then(resolve, resolve);
                    }
                }),
        ),
    );

    return posterWarmup;
}

// Two seconds per segment means a 4-second buffer is approximately
// two segments. HLS.js may cross a segment boundary, so this is a target.
const HLS_BUFFER_TARGET_SECONDS = 4;

export function LeagueLanding() {
    const [carouselIndex, setCarouselIndex] = useState(0);
    const [activeSlot, setActiveSlot] = useState(0);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [failedVideoSrc, setFailedVideoSrc] = useState('');

    // Two persistent video elements and two independent HLS.js instances.
    // The active and scout roles alternate between slots 0 and 1.
    const videoRefs = useRef([null, null]);
    const hlsRefs = useRef([null, null]);

    // Track which stream is assigned to each persistent slot.
    // A promoted scout keeps its existing source and buffered media.
    const assignedStreamsRef = useRef([null, null]);

    const manifestReadyRef = useRef([false, false]);
    const startedLoadingRef = useRef([false, false]);
    const recoveryCountRef = useRef([0, 0]);

    const failedStreamsRef = useRef(new Set());

    const currentStreamRef = useRef(null);
    const activeSlotRef = useRef(0);
    const carouselIndexRef = useRef(0);
    const isPausedRef = useRef(isPaused);
    const failedVideoSrcRef = useRef(failedVideoSrc);

    const tryPlayRef = useRef(null);
    const tryStartScoutRef = useRef(null);

    const touchStart = useRef(null);
    const navigate = useNavigate();

    const activeTournamentIndex =
        carouselIndex % tournaments.length;

    const mediaIndex =
        Math.floor(carouselIndex / tournaments.length);

    const activeTournament =
        tournaments[activeTournamentIndex];

    const streamName =
        STREAMS[activeTournament.id][mediaIndex];

    const videoSrc = masterUrlFor(streamName);
    const posterSrc = STREAM_POSTERS[streamName];

    const nextStreamName = streamNameAt(carouselIndex + 1);
    const nextPosterSrc = STREAM_POSTERS[nextStreamName];

    const videoFailed = failedVideoSrc === videoSrc;
    const totalSlides = CLIP_COUNT;

    // All derived values are initialized before event handlers read them.
    // This avoids the previous streamName temporal-dead-zone error.
    currentStreamRef.current = streamName;
    activeSlotRef.current = activeSlot;
    carouselIndexRef.current = carouselIndex;
    isPausedRef.current = isPaused;
    failedVideoSrcRef.current = failedVideoSrc;

    // Play only the video element that currently owns the visible clip.
    tryPlayRef.current = (slot) => {
        const video = videoRefs.current[slot];
        const assignedName = assignedStreamsRef.current[slot];
        const activeName = currentStreamRef.current;

        if (!video) return;

        if (
            slot !== activeSlotRef.current ||
            assignedName !== activeName
        ) {
            video.pause();
            return;
        }

        if (
            isPausedRef.current ||
            failedStreamsRef.current.has(activeName)
        ) {
            video.pause();
            return;
        }

        if (video.readyState >= 2) {
            video.play().catch((error) => {
                // Autoplay can still be denied by browser policy.
                console.info(
                    'Carousel video autoplay was blocked:',
                    error,
                );
            });
        }
    };

    // Start the scout only after the active video has enough data to play.
    // This prevents both HLS instances competing for bandwidth during startup.
    tryStartScoutRef.current = () => {
        const currentSlot = activeSlotRef.current;
        const scoutSlot = 1 - currentSlot;

        const currentVideo = videoRefs.current[currentSlot];
        const scoutHls = hlsRefs.current[scoutSlot];

        if (!currentVideo || !scoutHls) return;

        if (currentVideo.readyState < 2) return;

        if (!manifestReadyRef.current[scoutSlot]) return;
        if (startedLoadingRef.current[scoutSlot]) return;

        startedLoadingRef.current[scoutSlot] = true;

        scoutHls.startLoad(-1);

        console.info(
            '[LeagueLanding] Scout started buffering',
            assignedStreamsRef.current[scoutSlot],
            `target=${HLS_BUFFER_TARGET_SECONDS}s`,
        );
    };

    const goTo = (index) => {
        const nextIndex =
            ((index % totalSlides) + totalSlides) % totalSlides;

        if (nextIndex === carouselIndexRef.current) return;

        // Update synchronously so rapid clicks never calculate from a stale index.
        carouselIndexRef.current = nextIndex;

        setCarouselIndex(nextIndex);

        // Toggle the slots for every actual navigation, including carousel wraparound
        // and direct jumps between slides.
        setActiveSlot((slot) => 1 - slot);
    };

    useEffect(() => {
        void warmPosters();
    }, []);

    // Create both HLS.js instances once.
    // They remain attached to their respective video elements as their roles alternate.
    useEffect(() => {
        const videos = videoRefs.current;

        if (!videos[0] || !videos[1]) return undefined;

        const videoListeners = [];
        const supportsHlsJs = Hls.isSupported();

        videos.forEach((video, slot) => {
            const onVideoReady = () => {
                tryPlayRef.current?.(slot);
                tryStartScoutRef.current?.();
            };

            const onVideoError = () => {
                const name = assignedStreamsRef.current[slot];

                if (!name) return;

                failedStreamsRef.current.add(name);

                if (name === currentStreamRef.current) {
                    setFailedVideoSrc(masterUrlFor(name));
                }

                console.error('[LeagueLanding] Media element error', {
                    slot,
                    stream: name,
                    error: video.error,
                });
            };

            video.addEventListener('loadeddata', onVideoReady);
            video.addEventListener('canplay', onVideoReady);
            video.addEventListener('error', onVideoError);

            videoListeners.push(() => {
                video.removeEventListener('loadeddata', onVideoReady);
                video.removeEventListener('canplay', onVideoReady);
                video.removeEventListener('error', onVideoError);
            });
        });

        if (supportsHlsJs) {
            videos.forEach((video, slot) => {
                const hls = new Hls({
                    // Source loading starts explicitly after the manifest is parsed.
                    // This lets us request the highest-bitrate initial level first.
                    autoStartLoad: false,
                    startLevel: -1,

                    // Each instance maintains its own ABR estimate.
                    testBandwidth: true,
                    abrEwmaDefaultEstimate: 10_000_000,

                    // Do not cap quality based on the card's physical dimensions.
                    capLevelToPlayerSize: false,

                    // Keep the active buffer and scout preload small.
                    maxBufferLength: HLS_BUFFER_TARGET_SECONDS,
                    maxMaxBufferLength: HLS_BUFFER_TARGET_SECONDS,
                    maxBufferSize: 20 * 1024 * 1024,
                    backBufferLength: 0,

                    lowLatencyMode: false,
                });

                hlsRefs.current[slot] = hls;
                hls.attachMedia(video);

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (hlsRefs.current[slot] !== hls) return;

                    manifestReadyRef.current[slot] = true;

                    const highestIndex =
                        highestBitrateLevelIndex(hls.levels);

                    if (highestIndex >= 0) {
                        // Prefer V0, determined by bitrate rather than level index.
                        // The normal automatic ABR controller remains enabled and can
                        // downgrade or upgrade after measuring actual fragment throughput.
                        hls.startLevel = highestIndex;
                    }

                    console.info('[LeagueLanding] Manifest ready', {
                        role:
                            slot === activeSlotRef.current
                                ? 'active'
                                : 'scout',
                        stream: assignedStreamsRef.current[slot],
                        levels: hls.levels.map((level, index) =>
                            describeLevel(level, index),
                        ),
                        initialLevel:
                            highestIndex >= 0
                                ? describeLevel(
                                      hls.levels[highestIndex],
                                      highestIndex,
                                  )
                                : 'automatic',
                    });

                    if (slot === activeSlotRef.current) {
                        startedLoadingRef.current[slot] = true;
                        hls.startLoad(-1);
                    } else {
                        tryStartScoutRef.current?.();
                    }

                    tryPlayRef.current?.(slot);
                });

                hls.on(Hls.Events.FRAG_BUFFERED, () => {
                    if (slot === activeSlotRef.current) {
                        tryStartScoutRef.current?.();
                    }

                    tryPlayRef.current?.(slot);
                });

                hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
                    const level = hls.levels[data.level];

                    if (!level) return;

                    console.info('[LeagueLanding] ABR level switched', {
                        role:
                            slot === activeSlotRef.current
                                ? 'active'
                                : 'scout',
                        stream: assignedStreamsRef.current[slot],
                        level: describeLevel(level, data.level),
                        bandwidthEstimate: Math.round(
                            hls.bandwidthEstimate || 0,
                        ),
                    });
                });

                hls.on(Hls.Events.ERROR, (_event, data) => {
                    if (
                        !data.fatal ||
                        hlsRefs.current[slot] !== hls
                    ) {
                        return;
                    }

                    const name = assignedStreamsRef.current[slot];

                    console.warn('[LeagueLanding] Fatal HLS error', {
                        role:
                            slot === activeSlotRef.current
                                ? 'active'
                                : 'scout',
                        stream: name,
                        type: data.type,
                        details: data.details,
                    });

                    // Attempt one standard recovery before declaring the stream failed.
                    if (
                        recoveryCountRef.current[slot] === 0 &&
                        data.type === Hls.ErrorTypes.NETWORK_ERROR
                    ) {
                        recoveryCountRef.current[slot] += 1;
                        hls.startLoad(-1);
                        return;
                    }

                    if (
                        recoveryCountRef.current[slot] === 0 &&
                        data.type === Hls.ErrorTypes.MEDIA_ERROR
                    ) {
                        recoveryCountRef.current[slot] += 1;
                        hls.recoverMediaError();
                        return;
                    }

                    if (name) {
                        failedStreamsRef.current.add(name);
                    }

                    if (name && name === currentStreamRef.current) {
                        setFailedVideoSrc(masterUrlFor(name));
                    }
                });
            });
        }

        return () => {
            videoListeners.forEach((remove) => remove());

            hlsRefs.current.forEach((hls) => hls?.destroy());

            hlsRefs.current = [null, null];
            assignedStreamsRef.current = [null, null];
            manifestReadyRef.current = [false, false];
            startedLoadingRef.current = [false, false];
            recoveryCountRef.current = [0, 0];

            videos.forEach((video) => {
                video.pause();
                video.removeAttribute('src');
                video.load();
            });
        };
    }, []);

    // Assign the current stream to the active slot and the next stream to the scout.
    // A matching source is deliberately left alone, preserving the scout's buffered data.
    useEffect(() => {
        const desiredNames = [null, null];

        desiredNames[activeSlot] = streamName;
        desiredNames[1 - activeSlot] = nextStreamName;

        for (let slot = 0; slot < 2; slot += 1) {
            const video = videoRefs.current[slot];
            const desiredName = desiredNames[slot];

            if (!video || !desiredName) continue;

            if (assignedStreamsRef.current[slot] !== desiredName) {
                video.pause();

                assignedStreamsRef.current[slot] = desiredName;
                manifestReadyRef.current[slot] = false;
                startedLoadingRef.current[slot] = false;
                recoveryCountRef.current[slot] = 0;

                const sourceUrl = masterUrlFor(desiredName);
                const hls = hlsRefs.current[slot];

                if (hls) {
                    hls.loadSource(sourceUrl);
                } else if (video.src !== sourceUrl) {
                    // Native-HLS fallback when HLS.js/MSE is unavailable.
                    video.preload = 'auto';
                    video.src = sourceUrl;
                    video.load();
                }
            }
        }

        if (failedStreamsRef.current.has(streamName)) {
            setFailedVideoSrc(videoSrc);
        } else {
            setFailedVideoSrc('');
        }

        // A scout manifest might have parsed before promotion but stayed idle while
        // the old active clip was loading. Start it now that it owns visible playback.
        const activeHls = hlsRefs.current[activeSlot];

        if (
            activeHls &&
            manifestReadyRef.current[activeSlot] &&
            !startedLoadingRef.current[activeSlot]
        ) {
            startedLoadingRef.current[activeSlot] = true;
            activeHls.startLoad(-1);
        }

        videoRefs.current[1 - activeSlot]?.pause();

        tryPlayRef.current?.(activeSlot);
        tryStartScoutRef.current?.();
    }, [
        activeSlot,
        carouselIndex,
        nextStreamName,
        streamName,
        videoSrc,
    ]);

    // Only the active video may play. The scout can download and buffer media while paused.
    useEffect(() => {
        videoRefs.current.forEach((video, slot) => {
            if (!video) return;

            if (slot !== activeSlot || isPaused || videoFailed) {
                video.pause();
            } else {
                tryPlayRef.current?.(slot);
            }
        });
    }, [activeSlot, carouselIndex, isPaused, videoFailed]);

    const openTournament = () => navigate(`/${activeTournament.id}`);

    const advanceWhenClipEnds = (slot) => {
        if (
            slot === activeSlotRef.current &&
            !isPausedRef.current
        ) {
            goTo(carouselIndexRef.current + 1);
        }
    };

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'ArrowLeft') {
                goTo(carouselIndexRef.current - 1);
            }

            if (event.key === 'ArrowRight') {
                goTo(carouselIndexRef.current + 1);
            }

            if (event.key === 'Enter') {
                navigate(
                    `/${tournaments[
                        carouselIndexRef.current % tournaments.length
                    ].id}`,
                );
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [navigate]);

    return (
        <main
            className="league-landing"
            style={{ '--active-accent': activeTournament.accent }}
            onTouchStart={(event) => {
                touchStart.current = event.touches[0].clientX;
            }}
            onTouchEnd={(event) => {
                if (touchStart.current === null) return;

                const distance =
                    event.changedTouches[0].clientX -
                    touchStart.current;

                if (Math.abs(distance) > 45) {
                    goTo(
                        carouselIndexRef.current +
                            (distance < 0 ? 1 : -1),
                    );
                }

                touchStart.current = null;
            }}
        >
            <div className="landing-noise" aria-hidden="true" />

            <header className="landing-header">
                <button
                    className="landing-wordmark"
                    onClick={() => goTo(0)}
                    aria-label="Go to Super League"
                >
                    <span>SUPER</span>
                    <span>LEAGUE</span>
                </button>

                <button
                    className="landing-menu"
                    onClick={() =>
                        setIsMenuOpen((isOpen) => !isOpen)
                    }
                    aria-label={
                        isMenuOpen ? 'Close menu' : 'Open menu'
                    }
                    aria-expanded={isMenuOpen}
                >
                    <Menu size={26} strokeWidth={1.5} />
                </button>
            </header>

            <div className="landing-stage">
                <div
                    className="landing-copy"
                    key={activeTournament.id}
                >
                    <p className="landing-kicker">
                        {activeTournament.eyebrow}
                    </p>

                    <button
                        className="landing-title"
                        onClick={openTournament}
                        aria-label={`Open ${activeTournament.title}`}
                    >
                        {activeTournament.title}
                    </button>

                    <p className="landing-detail">
                        {activeTournament.detail}
                    </p>
                </div>

                <div className="landing-card-wrap">
                    <div className="landing-card">
                        {[0, 1].map((slot) => {
                            const slotStreamName =
                                slot === activeSlot
                                    ? streamName
                                    : nextStreamName;

                            const slotPoster =
                                STREAM_POSTERS[slotStreamName];

                            const visible =
                                slot === activeSlot && !videoFailed;

                            return (
                                <video
                                    key={`video-slot-${slot}`}
                                    ref={(element) => {
                                        videoRefs.current[slot] = element;
                                    }}
                                    poster={slotPoster}
                                    className="landing-card-image"
                                    autoPlay={false}
                                    muted
                                    playsInline
                                    preload="auto"
                                    aria-hidden={slot !== activeSlot}
                                    style={{
                                        display: visible ? 'block' : 'none',
                                    }}
                                    onEnded={() =>
                                        advanceWhenClipEnds(slot)
                                    }
                                />
                            );
                        })}

                        {videoFailed && (
                            <img
                                src={posterSrc}
                                alt={`${activeTournament.title} video preview`}
                                className="landing-card-image"
                            />
                        )}

                        <span className="landing-card-shade" />
                        <span className="landing-card-mark">
                            SL / 26
                        </span>

                        <button
                            type="button"
                            className="landing-enter-button"
                            onClick={openTournament}
                        >
                            <span>
                                Enter{' '}
                                {activeTournament.title === 'Freshers'
                                    ? "Fresher's Tournament"
                                    : activeTournament.title}
                            </span>
                        </button>

                        <span className="landing-redirect-note">
                            Opens the {activeTournament.title} page
                        </span>
                    </div>

                    <button
                        type="button"
                        className="landing-arrow landing-arrow-left"
                        onPointerDown={(event) => event.stopPropagation()}
                        onTouchStart={(event) => event.stopPropagation()}
                        onTouchEnd={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            goTo(carouselIndexRef.current - 1);
                        }}
                        aria-label="Previous carousel video"
                    >
                        <ArrowLeft size={20} strokeWidth={1.5} />
                    </button>

                    <button
                        type="button"
                        className="landing-arrow landing-arrow-right"
                        onPointerDown={(event) => event.stopPropagation()}
                        onTouchStart={(event) => event.stopPropagation()}
                        onTouchEnd={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            goTo(carouselIndexRef.current + 1);
                        }}
                        aria-label="Next carousel video"
                    >
                        <ArrowRight size={20} strokeWidth={1.5} />
                    </button>
                </div>
            </div>

            <footer className="landing-footer">
                <div
                    className="landing-progress"
                    aria-label="Tournament selection"
                >
                    {tournaments.map((tournament, index) => (
                        <button
                            key={tournament.id}
                            className={`landing-progress-dot ${
                                index === activeTournamentIndex
                                    ? 'is-active'
                                    : ''
                            }`}
                            onClick={() =>
                                goTo(
                                    index +
                                        mediaIndex * tournaments.length,
                                )
                            }
                            aria-label={`Show ${tournament.title}`}
                        />
                    ))}
                </div>

                <button
                    type="button"
                    className="landing-play-pause"
                    onClick={() =>
                        setIsPaused((paused) => !paused)
                    }
                    aria-label={
                        isPaused
                            ? 'Play carousel video'
                            : 'Pause carousel video'
                    }
                    title={isPaused ? 'Play' : 'Pause'}
                >
                    {isPaused ? (
                        <Play size={15} fill="currentColor" />
                    ) : (
                        <Pause size={15} fill="currentColor" />
                    )}

                    <span>{isPaused ? 'Play' : 'Pause'}</span>
                </button>
            </footer>

            <div
                className={`landing-menu-panel ${
                    isMenuOpen ? 'is-open' : ''
                }`}
            >
                <button onClick={() => navigate('/login')}>
                    Sign in / Join
                </button>

                {tournaments.map((tournament) => (
                    <button
                        key={tournament.id}
                        onClick={() => navigate(`/${tournament.id}`)}
                    >
                        {tournament.title}
                    </button>
                ))}
            </div>
        </main>
    );
}
