import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Menu, MoveUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './LeagueLanding.css';

const tournaments = [
    {
        id: 'super-league',
        eyebrow: 'IIIT Kottayam',
        title: 'Super League',
        detail: 'Men\'s division',
        image: 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?auto=format&fit=crop&w=1400&q=85',
        video: import.meta.env.VITE_SUPER_LEAGUE_VIDEO_URL || '',
        accent: '#d9ff4a',
    },
    {
        id: 'wsl',
        eyebrow: 'IIIT Kottayam',
        title: 'WSL',
        detail: 'Women\'s division',
        image: 'https://images.unsplash.com/photo-1553778263-73a83bab9b0c?auto=format&fit=crop&w=1400&q=85',
        video: import.meta.env.VITE_WSL_VIDEO_URL || '',
        accent: '#ff8a65',
    },
    {
        id: 'freshers',
        eyebrow: 'New season',
        title: 'Freshers',
        detail: 'Tournament 2026',
        image: 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?auto=format&fit=crop&w=1400&q=85',
        video: import.meta.env.VITE_FRESHERS_VIDEO_URL || '',
        accent: '#7dd3fc',
    },
];

export function LeagueLanding() {
    const [activeIndex, setActiveIndex] = useState(0);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const touchStart = useRef(null);
    const navigate = useNavigate();
    const activeTournament = tournaments[activeIndex];

    const goTo = (index) => {
        setActiveIndex((index + tournaments.length) % tournaments.length);
    };

    function CardMedia({ tournament }) {
        const videoRef = useRef(null);
        const [videoFailed, setVideoFailed] = useState(false);

        useEffect(() => {
            setVideoFailed(false);
            const video = videoRef.current;
            if (!video || !tournament.video) return undefined;
            const playVideo = () => video.play().catch(() => {});
            video.load();
            playVideo();
            return () => video.pause();
        }, [tournament.id, tournament.video]);

        if (!tournament.video || videoFailed) {
            return <img src={tournament.image} alt="" className="landing-card-image" />;
        }

        return (
            <video
                ref={videoRef}
                className="landing-card-image"
                src={tournament.video}
                poster={tournament.image}
                muted
                playsInline
                loop
                autoPlay
                preload="metadata"
                onError={() => setVideoFailed(true)}
                aria-hidden="true"
            />
        );
    }

    const openTournament = () => navigate(`/${activeTournament.id}`);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'ArrowLeft') goTo(activeIndex - 1);
            if (event.key === 'ArrowRight') goTo(activeIndex + 1);
            if (event.key === 'Enter') navigate(`/${tournaments[activeIndex].id}`);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeIndex, navigate]);

    return (
        <main
            className="league-landing"
            style={{ '--active-accent': activeTournament.accent }}
            onTouchStart={(event) => { touchStart.current = event.touches[0].clientX; }}
            onTouchEnd={(event) => {
                if (touchStart.current === null) return;
                const distance = event.changedTouches[0].clientX - touchStart.current;
                if (Math.abs(distance) > 45) goTo(activeIndex + (distance < 0 ? 1 : -1));
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
                        <CardMedia tournament={activeTournament} />
                        <span className="landing-card-shade" />
                        <span className="landing-card-mark">SL / 26</span>
                        <span className="landing-card-action"><MoveUpRight size={18} /></span>
                    </button>
                    <button className="landing-arrow landing-arrow-left" onClick={() => goTo(activeIndex - 1)} aria-label="Previous tournament">
                        <ArrowLeft size={20} strokeWidth={1.5} />
                    </button>
                    <button className="landing-arrow landing-arrow-right" onClick={() => goTo(activeIndex + 1)} aria-label="Next tournament">
                        <ArrowRight size={20} strokeWidth={1.5} />
                    </button>
                </div>

                <div className="landing-rail" aria-label="Tournament selection">
                    {tournaments.map((tournament, index) => (
                        <button
                            key={tournament.id}
                            className={`landing-rail-item ${index === activeIndex ? 'is-active' : ''}`}
                            onClick={() => goTo(index)}
                            aria-label={`Show ${tournament.title}`}
                            aria-current={index === activeIndex ? 'true' : undefined}
                        >
                            <span>{tournament.title}</span>
                            <i />
                        </button>
                    ))}
                </div>
            </div>

            <footer className="landing-footer">
                <span>01 / 03</span>
                <span>Scroll to explore</span>
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