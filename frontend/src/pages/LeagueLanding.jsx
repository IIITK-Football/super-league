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
        images: [
            'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?auto=format&fit=crop&w=1400&q=85',
            'https://images.unsplash.com/photo-1553778263-73a83bab9b0c?auto=format&fit=crop&w=1400&q=85',
            'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?auto=format&fit=crop&w=1400&q=85',
        ],
        video: import.meta.env.VITE_SUPER_LEAGUE_VIDEO_URL || '',
        accent: '#d9ff4a',
    },
    {
        id: 'wsl',
        eyebrow: 'IIIT Kottayam',
        title: 'WSL',
        detail: 'Women\'s division',
        images: [
            'https://images.unsplash.com/photo-1553778263-73a83bab9b0c?auto=format&fit=crop&w=1400&q=85',
            'https://images.unsplash.com/photo-1517466787929-bc90951d0974?auto=format&fit=crop&w=1400&q=85',
            'https://images.unsplash.com/photo-1575361204480-aadea25e6e68?auto=format&fit=crop&w=1400&q=85',
        ],
        video: import.meta.env.VITE_WSL_VIDEO_URL || '',
        accent: '#ff8a65',
    },
    {
        id: 'freshers',
        eyebrow: 'New season',
        title: 'Freshers',
        detail: 'Tournament 2026',
        images: [
            'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?auto=format&fit=crop&w=1400&q=85',
            'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=1400&q=85',
            'https://images.unsplash.com/photo-1551958219-acbc608c6377?auto=format&fit=crop&w=1400&q=85',
        ],
        video: import.meta.env.VITE_FRESHERS_VIDEO_URL || '',
        accent: '#7dd3fc',
    },
];

export function LeagueLanding() {
    const [carouselIndex, setCarouselIndex] = useState(0);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [timeRemaining, setTimeRemaining] = useState(4.2);
    const touchStart = useRef(null);
    const navigate = useNavigate();
    const activeTournamentIndex = carouselIndex % tournaments.length;
    const mediaIndex = Math.floor(carouselIndex / tournaments.length);
    const activeTournament = tournaments[activeTournamentIndex];
    const totalSlides = tournaments.length * 3;

    const goTo = (index) => {
        setCarouselIndex((index + totalSlides) % totalSlides);
        setTimeRemaining(4.2);
    };

    useEffect(() => {
        if (isPaused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

        const timer = window.setInterval(() => {
            setTimeRemaining((remaining) => {
                if (remaining <= 0.1) {
                    setCarouselIndex((index) => (index + 1) % totalSlides);
                    return 4.2;
                }
                return Math.max(0, remaining - 0.1);
            });
        }, 100);

        return () => window.clearInterval(timer);
    }, [isPaused, totalSlides]);

    const openTournament = () => navigate(`/${activeTournament.id}`);

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
            onFocus={() => setIsPaused(true)}
            onBlur={() => setIsPaused(false)}
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
                        <img key={`${activeTournament.id}-${mediaIndex}`} src={activeTournament.images[mediaIndex]} alt="" className="landing-card-image" />
                        <span className="landing-card-shade" />
                        <span className="landing-card-mark">SL / 26</span>
                        <span className="landing-card-action"><MoveUpRight size={18} /></span>
                    </button>
                    <button className="landing-arrow landing-arrow-left" onClick={() => goTo(carouselIndex - 1)} aria-label="Previous carousel image">
                        <ArrowLeft size={20} strokeWidth={1.5} />
                    </button>
                    <button className="landing-arrow landing-arrow-right" onClick={() => goTo(carouselIndex + 1)} aria-label="Next carousel image">
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
                <span className="landing-countdown">{isPaused ? 'Paused' : `Next in ${timeRemaining.toFixed(1)}s`}</span>
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