import { useState } from 'react';
import { Menu, X, User } from 'lucide-react'; 
import { useLeague } from '../context/LeagueContext';
import { useAuth } from '../context/AuthContext';
import { cn } from '../utils/cn';
import { Link, useLocation, useNavigate } from 'react-router-dom';

export function TopNavbar() {
    const { division, seasonScope, fantasySection, setFantasySection } = useLeague();
    const { user } = useAuth();
    const [menuOpen, setMenuOpen] = useState(false);
    
    const location = useLocation();
    const navigate = useNavigate();
    
    const currentPath = location.pathname;
    const isFantasyRoute = currentPath === '/fantasy' || currentPath === '/wc';

    const sectionPaths = {
        overview: seasonScope.season ? `/${division}/${seasonScope.season.slug}` : `/${division}`,
        fixtures: '/matches',
        standings: `/standings/${division}`,
        teams: '/teams',
        stats: '/leaderboard',
        fantasy: '/fantasy',
        news: '/vault',
        rules: '/rules',
    };
    const views = [
        { path: '/', label: 'Home' },
        ...seasonScope.sections.filter(({ key, enabled, navVisible }) => enabled && navVisible && sectionPaths[key])
            .map(({ key, label }) => ({ path: sectionPaths[key], label, section: key })),
        { path: '/wc', id: 'fifa', label: 'World Cup' },
    ];

    const handleNav = (v) => {
        if (v.id === 'fifa') {
            setFantasySection('fifa');
            navigate('/wc');
        } else {
            const query = new URLSearchParams({ division });
            if (seasonScope.season) query.set('season', seasonScope.season.slug);
            navigate(v.section && v.section !== 'overview' ? `${v.path}?${query}` : v.path);
        }
        setMenuOpen(false);
    };

    return (
        <>
            <nav className="fixed top-0 left-0 right-0 z-50 h-[72px] bg-black/40 backdrop-blur-xl border-b border-white/10 flex items-center justify-between px-4 sm:px-6">
                {/* Left: Logo */}
                <div className="flex items-center gap-1 sm:gap-4">
                    {!(isFantasyRoute && fantasySection === 'fifa') && (
                        <Link
                            to="/"
                            className="flex items-center gap-2 sm:gap-3 cursor-pointer hover:opacity-80 transition-opacity"
                        >
                            {seasonScope.divisionRecord?.logo_url && (
                                <img src={seasonScope.divisionRecord.logo_url} alt="" className="h-12 w-12 object-contain" />
                            )}
                            <span className="text-lg font-black italic tracking-tighter text-white sm:text-2xl">
                                {seasonScope.divisionRecord?.short_name || seasonScope.divisionRecord?.name || 'Super League'}
                            </span>
                        </Link>
                    )}
                    <div id="navbar-portal-target" className="flex items-center"></div>
                </div>

                {/* Fantasy section switcher remains available only inside fantasy routes. */}
                {isFantasyRoute && fantasySection === 'fifa' ? (
                <div className="absolute left-1/2 -translate-x-1/2 flex items-center bg-white/5 p-1 rounded-full border border-white/10">
                    <button
                        onClick={() => {
                            setFantasySection('season1');
                            navigate('/fantasy');
                        }}
                        className={cn(
                            "px-2 py-1 sm:px-4 sm:py-1.5 rounded-full text-[10px] sm:text-sm font-medium transition-colors duration-300 w-16 sm:w-24",
                            fantasySection === 'season1' ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                        )}
                    >
                        <span className="sm:hidden">S1</span>
                        <span className="hidden sm:inline">Season 1</span>
                    </button>
                    <button
                        onClick={() => {
                            setFantasySection('fifa');
                            navigate('/wc');
                        }}
                        className={cn(
                            "px-2 py-1 sm:px-4 sm:py-1.5 rounded-full text-[10px] sm:text-sm font-medium transition-colors duration-300 w-16 sm:w-24",
                            fantasySection === 'fifa' ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                        )}
                    >
                        <span className="sm:hidden">FIFA</span>
                        <span className="hidden sm:inline">FIFA</span>
                    </button>
                </div>
                ) : null}

                {/* Right: Login & Hamburger */}
                <div className="flex items-center gap-2 sm:gap-4">
                    {user ? (
                        <button
                            onClick={() => navigate('/profile')}
                            className="flex items-center gap-2 px-3 py-1.5 sm:px-4 border border-white/20 rounded-full text-sm font-medium hover:bg-white/5 transition-colors"
                        >
                            <User size={16} />
                            <span className="hidden sm:inline">Profile</span>
                        </button>
                    ) : (
                        <button
                            onClick={() => navigate('/login')}
                            className="flex items-center gap-2 px-3 py-1.5 sm:px-4 border border-white/20 rounded-full text-sm font-medium hover:bg-white/10 bg-white/5 transition-colors"
                        >
                            <User size={16} />
                            <span className="hidden sm:inline">Sign In</span>
                        </button>
                    )}
                    <button
                        aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
                        aria-expanded={menuOpen}
                        onClick={() => setMenuOpen(!menuOpen)}
                        className="p-2 text-white hover:bg-white/10 rounded-full transition-colors relative z-50"
                    >
                        {menuOpen ? <X size={24} /> : <Menu size={24} />}
                    </button>
                </div>
            </nav>

            {/* Dropdown Menu Overlay */}
            <div className={cn(
                "fixed inset-0 z-40 bg-black/90 backdrop-blur-xl transition-opacity duration-300 flex flex-col pt-24 pb-8 px-6",
                menuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            )} aria-hidden={!menuOpen}>
                <div className="flex flex-col items-center gap-6 overflow-y-auto py-4 sm:gap-8">
                    {views.map((v) => (
                        <button
                            key={v.path}
                            tabIndex={menuOpen ? 0 : -1}
                            onClick={() => handleNav(v)}
                            className={cn(
                                "text-2xl sm:text-4xl font-bold tracking-widest transition-all duration-300 hover:scale-110",
                                currentPath === v.path && (v.id !== 'fifa' || fantasySection === 'fifa') ? "text-white" : "text-zinc-600 hover:text-white",
                                ""
                            )}
                        >
                            {v.label.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
}
