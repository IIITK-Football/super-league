import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { ArrowLeft, ArrowRight, Menu, MoveUpRight, Pause, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './LeagueLanding.css';

const STREAM_BASE_URL = 'https://pub-b7d837d92cb644838cb24feef9b3329e.r2.dev';
const LOADING_THUMBNAIL = `${STREAM_BASE_URL}/loading.avif`;
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

export function LeagueLanding() {
    const [carouselIndex, setCarouselIndex] = useState(0);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [videoFailed, setVideoFailed] = useState(false);
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const isPausedRef = useRef(isPaused);
    const touchStart = useRef(null);
    const navigate = useNavigate();
    const activeTournamentIndex = carouselIndex % tournaments.length;
    const mediaIndex = Math.floor(carouselIndex / tournaments.length);
    const activeTournament = tournaments[activeTournamentIndex];
    const videoSrc = `${STREAM_BASE_URL}/${STREAMS[activeTournament.id][mediaIndex]}/master.m3u8`;
    const totalSlides = tournaments.length * 3;

    const goTo = (index) => {
        setCarouselIndex((index + totalSlides) % totalSlides);
    };

    useEffect(() => {
        isPausedRef.current = isPaused;
    }, [isPaused]);

    useEffect(() => {
        setVideoFailed(false);
    }, [videoSrc]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return undefined;

        let hls;
        const startPlayback = () => {
            if (!isPausedRef.current) video.play().catch((error) => {
                // Autoplay can still be denied by browser policy.
                console.info('Carousel video autoplay was blocked:', error);
            });
        };
        // Prefer hls.js where MSE is supported; native HLS remains the Safari fallback.
        if (Hls.isSupported()) {
            hls = new Hls({
                startLevel: 1,
                capLevelToPlayerSize: false,
                maxBufferLength: 12,
                maxMaxBufferLength: 16,
            });
            hlsRef.current = hls;
            hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data.fatal) {
                    console.error('Carousel HLS playback failed:', data.type, data.details, videoSrc);
                    setVideoFailed(true);
                }
            });
            hls.loadSource(videoSrc);
            hls.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = videoSrc;
            video.addEventListener('loadedmetadata', startPlayback, { once: true });
        } else {
            console.error('This browser does not support HLS playback.');
            setVideoFailed(true);
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
                    <button className="landing-card" onClick={openTournament} aria-label={`Open ${activeTournament.title}`}>
                        {videoFailed ? (
                            <img src={LOADING_THUMBNAIL} alt="Video loading" className="landing-card-image" />
                        ) : (
                            <video
                                ref={videoRef}
                                key={`${activeTournament.id}-${mediaIndex}`}
                                src={Hls.isSupported() ? undefined : videoSrc}
                                poster={LOADING_THUMBNAIL}
                                className="landing-card-image"
                                muted
                                playsInline
                                preload="metadata"
                                onEnded={advanceWhenClipEnds}
                                onError={() => setVideoFailed(true)}
                            />
                        )}
                        <span className="landing-card-shade" />
                        <span className="landing-card-mark">SL / 26</span>
                        <span className="landing-card-action"><MoveUpRight size={18} /></span>
                    </button>
                    <button type="button" className="landing-arrow landing-arrow-left" onClick={(event) => { event.stopPropagation(); goTo(carouselIndex - 1); }} aria-label="Previous carousel video">
                        <ArrowLeft size={20} strokeWidth={1.5} />
                    </button>
                    <button type="button" className="landing-arrow landing-arrow-right" onClick={(event) => { event.stopPropagation(); goTo(carouselIndex + 1); }} aria-label="Next carousel video">
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
