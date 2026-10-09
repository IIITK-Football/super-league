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
const masterUrlFor = (name) => `${API_BASE_URL}/media/${name}/master.m3u8`;

// Carousel order: Super League 1, WSL 1, Freshers 1, then the second set, etc.
function streamNameAt(index) {
    const safeIndex = ((index % CLIP_COUNT) + CLIP_COUNT) % CLIP_COUNT;
    return STREAMS[tournaments[safeIndex % tournaments.length].id][
        Math.floor(safeIndex / tournaments.length)
    ];
}

function levelBitrate(level) {
    return Number(level?.maxBitrate)
        || Number(level?.bitrate)
        || Number(level?.averageBitrate)
        || Number(level?.realBitrate)
        || 0;
}

function levelUrls(level) {
    return Array.isArray(level?.url)
        ? level.url.join(' ')
        : String(level?.url || level?.uri || '');
}

function qualityPathIndex(levels, quality) {
    const pattern = new RegExp(`(?:^|[\\/_-])v${quality}(?:[\\/._-]|$)`, 'i');
    return levels.findIndex((level) => level?.supported !== false && pattern.test(levelUrls(level)));
}

function highestBitrateLevelIndex(levels) {
    if (!levels?.length) return -1;

    let bestIndex = -1;
    for (let index = 0; index < levels.length; index += 1) {
        const level = levels[index];
        if (!level || level.supported === false) continue;
        if (bestIndex === -1 || levelBitrate(level) > levelBitrate(levels[bestIndex])) {
            bestIndex = index;
        }
    }
    return bestIndex;
}

function preferredInitialLevelIndex(levels) {
    // This project's encodes use v0 as the highest quality. Verify the actual
    // level URL first; fall back to metadata instead of assuming HLS index 0 is v0.
    const v0Index = qualityPathIndex(levels, 0);
    return v0Index >= 0 ? v0Index : highestBitrateLevelIndex(levels);
}

function describeLevel(level, index) {
    const urls = levelUrls(level);
    const match = /(?:^|[\\/_-])v([012])(?:[\\/._-]|$)/i.exec(urls);
    const name = match ? `V${match[1]}` : `level ${index}`;
    const bitrate = levelBitrate(level);
    const resolution = level?.width && level?.height
        ? ` ${level.width}x${level.height}`
        : '';
    return `${name}${resolution}${bitrate ? ` ${(bitrate / 1_000_000).toFixed(2)} Mbps` : ''}`;
}

function getBufferedAhead(video) {
    if (!video?.buffered?.length) return 0;
    const time = Number.isFinite(video.currentTime) ? video.currentTime : 0;

    for (let range = 0; range < video.buffered.length; range += 1) {
        const start = video.buffered.start(range);
        const end = video.buffered.end(range);
        if (start <= time + 0.25 && end >= time) return Math.max(0, end - time);
    }
    return 0;
}

function replaceSlotValue(previous, slot, value) {
    if (previous[slot] === value) return previous;
    const next = [...previous];
    next[slot] = value;
    return next;
}

// Two segments at up to ~2 seconds each. Segment boundaries can make actual
// buffered duration slightly greater than four seconds.
const BUFFER_TARGET_SECONDS = 4;
const DEFAULT_BANDWIDTH_ESTIMATE = 10_000_000;

const warmedPosters = [];
let posterWarmup = null;
function warmPosters() {
    if (posterWarmup) return posterWarmup;

    posterWarmup = Promise.all(Object.values(STREAM_POSTERS).map((src) => new Promise((resolve) => {
        const image = new Image();
        image.decoding = 'async';
        warmedPosters.push(image);
        image.onload = resolve;
        image.onerror = resolve;
        image.src = src;
        if (image.decode) image.decode().then(resolve, resolve);
    })));

    return posterWarmup;
}

export function LeagueLanding() {
    const [carouselIndex, setCarouselIndex] = useState(0);
    const [activeSlot, setActiveSlot] = useState(0);
    const [slotStreamNames, setSlotStreamNames] = useState([null, null]);
    const [readyStreamNames, setReadyStreamNames] = useState([null, null]);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [failedVideoSrc, setFailedVideoSrc] = useState('');

    // Keep exactly two persistent video/HLS slots: visible playback and next-clip scout.
    const videoRefs = useRef([null, null]);
    const hlsRefs = useRef([null, null]);
    const assignedStreamsRef = useRef([null, null]);
    const expectedUrlsRef = useRef([null, null]);
    const manifestReadyRef = useRef([false, false]);
    const startedLoadingRef = useRef([false, false]);
    const firstFragmentBufferedRef = useRef([false, false]);
    const scoutBufferCompleteRef = useRef([false, false]);
    const recoveryCountRef = useRef([0, 0]);
    const failedStreamsRef = useRef(new Set());

    const activeSlotRef = useRef(0);
    const carouselIndexRef = useRef(0);
    const currentStreamRef = useRef(null);
    const isPausedRef = useRef(isPaused);
    const initialV0StartedRef = useRef(false);

    // Active HLS.js measures throughput. Its current estimate seeds the scout's
    // independent ABR estimator before the scout downloads the next clip's media.
    const networkEstimateRef = useRef(DEFAULT_BANDWIDTH_ESTIMATE);
    const tryPlayRef = useRef(null);
    const tryStartScoutRef = useRef(null);

    const touchStart = useRef(null);
    const navigate = useNavigate();

    const activeTournamentIndex = carouselIndex % tournaments.length;
    const mediaIndex = Math.floor(carouselIndex / tournaments.length);
    const activeTournament = tournaments[activeTournamentIndex];
    const streamName = STREAMS[activeTournament.id][mediaIndex];
    const videoSrc = masterUrlFor(streamName);
    const posterSrc = STREAM_POSTERS[streamName];
    const nextStreamName = streamNameAt(carouselIndex + 1);
    const videoFailed = failedVideoSrc === videoSrc;
    const totalSlides = CLIP_COUNT;

    // Synchronize refs during render so asynchronous HLS events never use stale slide state.
    activeSlotRef.current = activeSlot;
    carouselIndexRef.current = carouselIndex;
    currentStreamRef.current = streamName;
    isPausedRef.current = isPaused;

    // Mark a slot ready only after its currently assigned source has buffered media
    // and the browser has frame data for that same source. This prevents a stale
    // frame from the previous master from being shown under the new slide's text.
    const markSlotReady = (slot) => {
        const video = videoRefs.current[slot];
        const name = assignedStreamsRef.current[slot];
        const expectedUrl = expectedUrlsRef.current[slot];
        const hls = hlsRefs.current[slot];

        if (!video || !name || !expectedUrl) return;
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

        if (hls) {
            if (!manifestReadyRef.current[slot] || !firstFragmentBufferedRef.current[slot]) return;
            if (hls.url && hls.url !== expectedUrl) return;
        } else if (video.src !== expectedUrl && video.currentSrc !== expectedUrl) {
            return;
        }

        setReadyStreamNames((previous) => replaceSlotValue(previous, slot, name));
    };

    tryPlayRef.current = (slot) => {
        const video = videoRefs.current[slot];
        const name = assignedStreamsRef.current[slot];

        if (!video || slot !== activeSlotRef.current || name !== currentStreamRef.current) return;

        // Never play a slot merely because it still has a decodable frame from its
        // previous master. It must be ready for the stream currently named on screen.
        if (slotStreamNames[slot] !== name || readyStreamNames[slot] !== name) {
            video.pause();
            return;
        }

        if (isPausedRef.current || failedStreamsRef.current.has(name)) {
            video.pause();
            return;
        }

        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            video.play().catch((error) => {
                console.info('[LeagueLanding] Autoplay was blocked:', error);
            });
        }
    };

    const refreshEstimateFromActive = () => {
        const activeHls = hlsRefs.current[activeSlotRef.current];
        if (!activeHls) return;

        const estimate = Number(activeHls.bandwidthEstimate);
        if (Number.isFinite(estimate) && estimate > 0) {
            networkEstimateRef.current = estimate;
            console.debug('[LeagueLanding] Active bandwidth estimate', {
                stream: currentStreamRef.current,
                bitsPerSecond: Math.round(estimate),
                megabitsPerSecond: Number((estimate / 1_000_000).toFixed(2)),
            });
        }
    };

    tryStartScoutRef.current = () => {
        const active = activeSlotRef.current;
        const scout = 1 - active;
        const activeVideo = videoRefs.current[active];
        const activeHls = hlsRefs.current[active];
        const scoutHls = hlsRefs.current[scout];

        if (!activeVideo || !scoutHls) return;
        if (navigator.connection?.saveData) return;
        if (!manifestReadyRef.current[scout]) return;
        if (startedLoadingRef.current[scout]) return;

        // Do not let the background clip compete before the active clip has
        // buffered at least its first complete media fragment.
        if (!firstFragmentBufferedRef.current[active]) return;

        refreshEstimateFromActive();
        const estimate = networkEstimateRef.current;

        // hls.bandwidthEstimate is a supported getter/setter. Seed the scout's
        // ABR controller from the live player's latest estimate, then let HLS.js
        // choose the initial rendition and continue adapting as it downloads.
        if (Number.isFinite(estimate) && estimate > 0) {
            scoutHls.bandwidthEstimate = estimate;
        }
        scoutHls.startLevel = -1;
        startedLoadingRef.current[scout] = true;
        scoutHls.startLoad(-1);

        console.info('[LeagueLanding] Scout preload started', {
            stream: assignedStreamsRef.current[scout],
            seededBandwidthMbps: Number((estimate / 1_000_000).toFixed(2)),
            targetBufferedSeconds: BUFFER_TARGET_SECONDS,
        });
    };

    const goTo = (index) => {
        const nextIndex = ((index % totalSlides) + totalSlides) % totalSlides;
        if (nextIndex === carouselIndexRef.current) return;

        const targetStreamName = streamNameAt(nextIndex);
        const preloadedSlot = assignedStreamsRef.current.findIndex((name, slot) => (
            slot !== activeSlotRef.current
            && name === targetStreamName
            && expectedUrlsRef.current[slot] === masterUrlFor(targetStreamName)
        ));
        // Prefer the slot that already owns this exact master. Manual jumps that
        // are not preloaded load into the standby slot and keep its frames hidden.
        const nextActiveSlot = preloadedSlot >= 0
            ? preloadedSlot
            : 1 - activeSlotRef.current;

        // Update refs synchronously so a queued ended event cannot advance the old slot.
        carouselIndexRef.current = nextIndex;
        activeSlotRef.current = nextActiveSlot;
        setCarouselIndex(nextIndex);
        setActiveSlot(nextActiveSlot);
    };

    useEffect(() => {
        void warmPosters();
    }, []);

    // Create both HLS instances once and keep them alive through carousel changes.
    useEffect(() => {
        const videos = videoRefs.current;
        if (!videos[0] || !videos[1]) return undefined;

        const supportsHlsJs = Hls.isSupported();
        const removeVideoListeners = [];

        videos.forEach((video, slot) => {
            const handleReady = () => {
                markSlotReady(slot);
                tryPlayRef.current?.(slot);
                tryStartScoutRef.current?.();
            };

            const handleNativeError = () => {
                const name = assignedStreamsRef.current[slot];
                if (name && name === currentStreamRef.current) {
                    setFailedVideoSrc(masterUrlFor(name));
                }
                console.error('[LeagueLanding] Video element error', {
                    stream: name,
                    slot,
                    error: video.error,
                });
            };

            video.addEventListener('loadeddata', handleReady);
            video.addEventListener('canplay', handleReady);
            video.addEventListener('error', handleNativeError);
            removeVideoListeners.push(() => {
                video.removeEventListener('loadeddata', handleReady);
                video.removeEventListener('canplay', handleReady);
                video.removeEventListener('error', handleNativeError);
            });
        });

        if (supportsHlsJs) {
            videos.forEach((video, slot) => {
                const hls = new Hls({
                    autoStartLoad: false,
                    startLevel: -1,
                    testBandwidth: true,
                    capLevelToPlayerSize: false,
                    maxBufferLength: BUFFER_TARGET_SECONDS,
                    maxMaxBufferLength: BUFFER_TARGET_SECONDS,
                    maxBufferSize: 24 * 1024 * 1024,
                    backBufferLength: 0,
                    abrEwmaDefaultEstimate: DEFAULT_BANDWIDTH_ESTIMATE,
                    // Favor higher renditions when measured throughput is close,
                    // while retaining automatic emergency down-switching.
                    abrBandWidthFactor: 0.98,
                    abrBandWidthUpFactor: 0.9,
                    lowLatencyMode: false,
                });

                hlsRefs.current[slot] = hls;
                hls.attachMedia(video);

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (hlsRefs.current[slot] !== hls) return;
                    const expected = expectedUrlsRef.current[slot];
                    if (expected && hls.url && hls.url !== expected) return;

                    manifestReadyRef.current[slot] = true;
                    const assignedName = assignedStreamsRef.current[slot];
                    const isActive = slot === activeSlotRef.current;
                    const highestIndex = highestBitrateLevelIndex(hls.levels);

                    console.info('[LeagueLanding] Manifest parsed', {
                        role: isActive ? 'active' : 'scout',
                        stream: assignedName,
                        levels: hls.levels.map((level, index) => describeLevel(level, index)),
                        startAt: isActive && carouselIndexRef.current === 0 && !initialV0StartedRef.current
                            ? 'V0 preferred for first clip'
                            : 'ABR bandwidth estimate',
                    });

                    if (isActive) {
                        if (carouselIndexRef.current === 0 && !initialV0StartedRef.current) {
                            const v0Index = preferredInitialLevelIndex(hls.levels);
                            if (v0Index >= 0) {
                                hls.startLevel = v0Index;
                                initialV0StartedRef.current = true;
                                console.info('[LeagueLanding] First clip starts at highest quality', {
                                    stream: assignedName,
                                    level: describeLevel(hls.levels[v0Index], v0Index),
                                });
                            } else {
                                hls.startLevel = -1;
                            }
                        } else {
                            const estimate = networkEstimateRef.current;
                            if (Number.isFinite(estimate) && estimate > 0) {
                                hls.bandwidthEstimate = estimate;
                            }
                            hls.startLevel = -1;
                        }

                        if (!startedLoadingRef.current[slot]) {
                            startedLoadingRef.current[slot] = true;
                            hls.startLoad(-1);
                        }
                    } else {
                        // The scout manifest can load early, but media starts only
                        // once the current visible clip has supplied a bandwidth sample.
                        tryStartScoutRef.current?.();
                    }

                    tryPlayRef.current?.(slot);
                });

                hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
                    if (hlsRefs.current[slot] !== hls) return;
                    if (expectedUrlsRef.current[slot] && hls.url !== expectedUrlsRef.current[slot]) return;
                    if (!data?.frag || data.frag.sn === 'initSegment') return;

                    if (slot === activeSlotRef.current) {
                        refreshEstimateFromActive();
                    }
                });

                hls.on(Hls.Events.FRAG_BUFFERED, (_event, data) => {
                    if (hlsRefs.current[slot] !== hls) return;
                    if (expectedUrlsRef.current[slot] && hls.url !== expectedUrlsRef.current[slot]) return;
                    if (!data?.frag || data.frag.sn === 'initSegment') return;

                    firstFragmentBufferedRef.current[slot] = true;
                    markSlotReady(slot);

                    const ahead = getBufferedAhead(videos[slot]);
                    if (slot !== activeSlotRef.current && ahead >= BUFFER_TARGET_SECONDS - 0.15) {
                        if (!scoutBufferCompleteRef.current[slot]) {
                            scoutBufferCompleteRef.current[slot] = true;
                            console.info('[LeagueLanding] Next clip has two segments buffered', {
                                stream: assignedStreamsRef.current[slot],
                                secondsBuffered: Number(ahead.toFixed(2)),
                                bandwidthMbps: Number((hls.bandwidthEstimate / 1_000_000).toFixed(2)),
                                level: hls.currentLevel >= 0 && hls.levels[hls.currentLevel]
                                    ? describeLevel(hls.levels[hls.currentLevel], hls.currentLevel)
                                    : 'automatic',
                            });
                        }
                    }

                    if (slot === activeSlotRef.current) {
                        refreshEstimateFromActive();
                        tryStartScoutRef.current?.();
                    }
                    tryPlayRef.current?.(slot);
                });

                hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
                    if (hlsRefs.current[slot] !== hls) return;
                    if (expectedUrlsRef.current[slot] && hls.url !== expectedUrlsRef.current[slot]) return;
                    const level = hls.levels[data.level];
                    if (!level) return;

                    if (slot === activeSlotRef.current) refreshEstimateFromActive();

                    console.info('[LeagueLanding] ABR level switched', {
                        role: slot === activeSlotRef.current ? 'active' : 'scout',
                        stream: assignedStreamsRef.current[slot],
                        level: describeLevel(level, data.level),
                        bandwidthMbps: Number((hls.bandwidthEstimate / 1_000_000).toFixed(2)),
                    });
                });

                hls.on(Hls.Events.ERROR, (_event, data) => {
                    if (!data.fatal || hlsRefs.current[slot] !== hls) return;
                    if (expectedUrlsRef.current[slot] && hls.url && hls.url !== expectedUrlsRef.current[slot]) return;

                    const assignedName = assignedStreamsRef.current[slot];
                    const isCurrent = slot === activeSlotRef.current && assignedName === currentStreamRef.current;
                    console.warn('[LeagueLanding] Fatal HLS error', {
                        role: isCurrent ? 'active' : 'scout',
                        stream: assignedName,
                        type: data.type,
                        details: data.details,
                    });

                    if (recoveryCountRef.current[slot] === 0 && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        recoveryCountRef.current[slot] += 1;
                        hls.startLoad(-1);
                        return;
                    }
                    if (recoveryCountRef.current[slot] === 0 && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        recoveryCountRef.current[slot] += 1;
                        hls.recoverMediaError();
                        return;
                    }

                    if (isCurrent && assignedName) {
                        failedStreamsRef.current.add(assignedName);
                        setFailedVideoSrc(masterUrlFor(assignedName));
                    } else {
                        // A scout failure must not blank the currently visible video.
                        // Leave the failure in the console; retry the source if it is promoted.
                        startedLoadingRef.current[slot] = false;
                        manifestReadyRef.current[slot] = false;
                    }
                });
            });
        }

        return () => {
            removeVideoListeners.forEach((remove) => remove());
            hlsRefs.current.forEach((hls) => hls?.destroy());
            hlsRefs.current = [null, null];
            // Reset source bookkeeping too. React StrictMode re-runs mount effects
            // in development, and the new instances must be assigned their sources again.
            assignedStreamsRef.current = [null, null];
            expectedUrlsRef.current = [null, null];
            manifestReadyRef.current = [false, false];
            startedLoadingRef.current = [false, false];
            firstFragmentBufferedRef.current = [false, false];
            scoutBufferCompleteRef.current = [false, false];
            recoveryCountRef.current = [0, 0];
            initialV0StartedRef.current = false;
            networkEstimateRef.current = DEFAULT_BANDWIDTH_ESTIMATE;
            videos.forEach((video) => {
                video.pause();
                video.removeAttribute('src');
                video.load();
            });
        };
    }, []);

    // The visible slot owns the current clip. The other slot owns the next clip.
    // We reload only when a slot's assigned stream changes; promotion preserves buffered data.
    useEffect(() => {
        const desiredNames = [null, null];
        desiredNames[activeSlot] = streamName;
        desiredNames[1 - activeSlot] = nextStreamName;

        for (let slot = 0; slot < 2; slot += 1) {
            const video = videoRefs.current[slot];
            const desiredName = desiredNames[slot];
            if (!video || !desiredName) continue;

            const desiredUrl = masterUrlFor(desiredName);
            if (assignedStreamsRef.current[slot] === desiredName && expectedUrlsRef.current[slot] === desiredUrl) {
                continue;
            }

            video.pause();
            assignedStreamsRef.current[slot] = desiredName;
            expectedUrlsRef.current[slot] = desiredUrl;
            setSlotStreamNames((previous) => replaceSlotValue(previous, slot, desiredName));
            setReadyStreamNames((previous) => replaceSlotValue(previous, slot, null));
            manifestReadyRef.current[slot] = false;
            startedLoadingRef.current[slot] = false;
            firstFragmentBufferedRef.current[slot] = false;
            scoutBufferCompleteRef.current[slot] = false;
            recoveryCountRef.current[slot] = 0;

            const hls = hlsRefs.current[slot];
            if (hls) {
                // Cancel stale downloads before assigning this slot to a new next clip.
                hls.stopLoad();
                hls.loadSource(desiredUrl);
            } else {
                // Native HLS fallback. Native ABR/buffering is browser-controlled.
                video.preload = 'auto';
                if (video.src !== desiredUrl) {
                    video.src = desiredUrl;
                    video.load();
                }
            }
        }

        if (failedStreamsRef.current.has(streamName)) setFailedVideoSrc(videoSrc);
        else setFailedVideoSrc('');

        // If the promoted slot was already buffered, begin playback immediately.
        // If the active slot had to load a new source (e.g. user skipped quickly), its
        // MANIFEST_PARSED event will start it using the current shared estimate.
        tryPlayRef.current?.(activeSlot);
        tryStartScoutRef.current?.();
    }, [activeSlot, carouselIndex, nextStreamName, streamName, videoSrc]);

    // Only the active video plays. The other element remains hidden but keeps its HLS buffer.
    useEffect(() => {
        videoRefs.current.forEach((video, slot) => {
            if (!video) return;
            if (slot !== activeSlot || isPaused || videoFailed) {
                video.pause();
            } else {
                tryPlayRef.current?.(slot);
            }
        });
    }, [activeSlot, carouselIndex, isPaused, videoFailed, slotStreamNames, readyStreamNames]);

    const openTournament = () => navigate(`/${activeTournament.id}`);

    const advanceWhenClipEnds = (slot) => {
        const currentName = currentStreamRef.current;
        if (
            slot === activeSlotRef.current
            && assignedStreamsRef.current[slot] === currentName
            && readyStreamNames[slot] === currentName
            && !isPausedRef.current
        ) {
            goTo(carouselIndexRef.current + 1);
        }
    };

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'ArrowLeft') goTo(carouselIndexRef.current - 1);
            if (event.key === 'ArrowRight') goTo(carouselIndexRef.current + 1);
            if (event.key === 'Enter') {
                navigate(`/${tournaments[carouselIndexRef.current % tournaments.length].id}`);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [navigate]);

    return (
        <main
            className="league-landing"
            style={{ '--active-accent': activeTournament.accent }}
            onTouchStart={(event) => { touchStart.current = event.touches[0].clientX; }}
            onTouchEnd={(event) => {
                if (touchStart.current === null) return;
                const distance = event.changedTouches[0].clientX - touchStart.current;
                if (Math.abs(distance) > 45) {
                    goTo(carouselIndexRef.current + (distance < 0 ? 1 : -1));
                }
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
                        {[0, 1].map((slot) => {
                            // The video element has no native poster. The only poster drawn on
                            // the card is posterSrc for the slide currently named by the text.
                            const slotStreamName = slotStreamNames[slot];
                            const sourceMatchesText = slot === activeSlot
                                && slotStreamName === streamName
                                && assignedStreamsRef.current[slot] === streamName
                                && expectedUrlsRef.current[slot] === videoSrc;
                            const frameReadyForText = sourceMatchesText
                                && readyStreamNames[slot] === streamName
                                && !videoFailed;

                            return (
                                <video
                                    key={`video-slot-${slot}`}
                                    ref={(element) => { videoRefs.current[slot] = element; }}
                                    className="landing-card-image"
                                    autoPlay={false}
                                    muted
                                    playsInline
                                    preload="auto"
                                    aria-hidden={slot !== activeSlot || !frameReadyForText}
                                    style={{
                                        // display:none prevents the standby player's native poster/frame
                                        // from ever painting over the active stream. HLS.js can still
                                        // load and buffer media for this attached video element.
                                        display: slot === activeSlot ? 'block' : 'none',
                                        opacity: frameReadyForText ? 1 : 0,
                                        visibility: frameReadyForText ? 'visible' : 'hidden',
                                        pointerEvents: 'none',
                                        position: 'absolute',
                                        inset: 0,
                                    }}
                                    onEnded={() => advanceWhenClipEnds(slot)}
                                />
                            );
                        })}

                        {!(slotStreamNames[activeSlot] === streamName
                            && assignedStreamsRef.current[activeSlot] === streamName
                            && expectedUrlsRef.current[activeSlot] === videoSrc
                            && readyStreamNames[activeSlot] === streamName
                            && !videoFailed) && (
                            <img
                                src={posterSrc}
                                alt={`${activeTournament.title} video preview`}
                                className="landing-card-image"
                                style={{
                                    position: 'absolute',
                                    inset: 0,
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                    pointerEvents: 'none',
                                }}
                            />
                        )}

                        <span className="landing-card-shade" />
                        <span className="landing-card-mark">SL / 26</span>
                        <button type="button" className="landing-enter-button" onClick={openTournament}>
                            <span>Enter {activeTournament.title === 'Freshers' ? "Fresher's Tournament" : activeTournament.title}</span>
                        </button>
                        <span className="landing-redirect-note">Opens the {activeTournament.title} page</span>
                    </div>

                    <button
                        type="button"
                        className="landing-arrow landing-arrow-left"
                        onPointerDown={(event) => event.stopPropagation()}
                        onTouchStart={(event) => event.stopPropagation()}
                        onTouchEnd={(event) => event.stopPropagation()}
                        onClick={(event) => { event.stopPropagation(); goTo(carouselIndexRef.current - 1); }}
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
                        onClick={(event) => { event.stopPropagation(); goTo(carouselIndexRef.current + 1); }}
                        aria-label="Next carousel video"
                    >
                        <ArrowRight size={20} strokeWidth={1.5} />
                    </button>
                </div>
            </div>

            <footer className="landing-footer">
                <div className="landing-progress" aria-label="Tournament selection">
                    {tournaments.map((tournament, index) => (
                        <button
                            key={tournament.id}
                            className={`landing-progress-dot ${index === activeTournamentIndex ? 'is-active' : ''}`}
                            onClick={() => goTo(index + mediaIndex * tournaments.length)}
                            aria-label={`Show ${tournament.title}`}
                        />
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

