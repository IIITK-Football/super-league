import { useState } from 'react';
import { Menu, X, User, ArrowLeft } from 'lucide-react';
import { useLeague } from '../context/LeagueContext';
import { useAuth } from '../context/AuthContext';
import { cn } from '../utils/cn';

export function TopNavbar() {
    const { division, setDivision, view, setView, goBack, fantasySection, setFantasySection } = useLeague();
    const { user, signInWithGoogle, signOut } = useAuth();
    const [menuOpen, setMenuOpen] = useState(false);

    const views = [
        { id: 'home', label: 'Home' },
        { id: 'matches', label: 'Matches' },
        { id: 'standings', label: 'Standings' },
        { id: 'teams', label: 'Clubs' },
        { id: 'fantasy', label: 'Fantasy' },
        { id: 'leaderboard', label: 'Statistics' },
        { id: 'vault', label: 'Newsletter' },
        { id: 'legends', label: 'Legends' },
        { id: 'rules', label: 'Rules' }
    ];

    const handleNav = (v) => {
        setView(v);
        setMenuOpen(false);
    };

    return (
        <>
            <nav className="fixed top-0 left-0 right-0 z-50 h-[72px] bg-black/40 backdrop-blur-xl border-b border-white/10 flex items-center justify-between px-4 sm:px-6">
                {/* Left: Logo & Back Button */}
                <div className="flex items-center gap-1 sm:gap-4">
                    {view !== 'home' && (
                        <button
                            onClick={goBack}
                            className="p-1 sm:p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-full transition-colors flex-shrink-0"
                        >
                            <ArrowLeft size={20} className="sm:w-6 sm:h-6" />
                        </button>
                    )}
                    {!(view === 'fantasy' && fantasySection === 'fifa') && (
                        <div
                            className="flex items-center gap-2 sm:gap-3 cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => setView('home')}
                        >
                            {division === 'womens' ? (
                                <>
                                    <img src="/slk-womens.png" alt="WSL" className="w-14 h-14 sm:w-20 sm:h-20 object-contain relative -ml-2" />
                                    <span className="text-lg sm:text-2xl font-black italic tracking-tighter text-white">
                                        WSL
                                    </span>
                                </>
                            ) : (
                                <span className="text-lg sm:text-xl font-black italic tracking-tighter text-white leading-none flex flex-col justify-center">
                                    <span>SUPER</span>
                                    <span>LEAGUE</span>
                                </span>
                            )}
                        </div>
                    )}
                    <div id="navbar-portal-target" className="flex items-center"></div>
                </div>

                {/* Center: Division Toggle */}
                {view !== 'fantasy' || fantasySection !== 'fifa' ? (
                <div className="absolute left-1/2 -translate-x-1/2 flex items-center bg-white/5 p-1 rounded-full border border-white/10">
                    <button
                        onClick={() => setDivision('mens')}
                        className={cn(
                            "px-2 py-1 sm:px-4 sm:py-1.5 rounded-full text-[10px] sm:text-sm font-medium transition-colors duration-300 w-12 sm:w-24",
                            division === 'mens' ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                        )}
                    >
                        <span className="sm:hidden">Men</span>
                        <span className="hidden sm:inline">Men's</span>
                    </button>
                    <button
                        onClick={() => setDivision('womens')}
                        className={cn(
                            "px-2 py-1 sm:px-4 sm:py-1.5 rounded-full text-[10px] sm:text-sm font-medium transition-colors duration-300 w-12 sm:w-24",
                            division === 'womens' ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                        )}
                    >
                        <span className="sm:hidden">Women</span>
                        <span className="hidden sm:inline">Women's</span>
                    </button>
                </div>
                ) : (
                <div className="absolute left-1/2 -translate-x-1/2 flex items-center bg-white/5 p-1 rounded-full border border-white/10">
                    <button
                        onClick={() => setFantasySection('season1')}
                        className={cn(
                            "px-2 py-1 sm:px-4 sm:py-1.5 rounded-full text-[10px] sm:text-sm font-medium transition-colors duration-300 w-16 sm:w-24",
                            fantasySection === 'season1' ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                        )}
                    >
                        <span className="sm:hidden">S1</span>
                        <span className="hidden sm:inline">Season 1</span>
                    </button>
                    <button
                        onClick={() => setFantasySection('fifa')}
                        className={cn(
                            "px-2 py-1 sm:px-4 sm:py-1.5 rounded-full text-[10px] sm:text-sm font-medium transition-colors duration-300 w-16 sm:w-24",
                            fantasySection === 'fifa' ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                        )}
                    >
                        <span className="sm:hidden">FIFA</span>
                        <span className="hidden sm:inline">FIFA</span>
                    </button>
                </div>
                )}

                {/* Right: Login & Hamburger */}
                <div className="flex items-center gap-2 sm:gap-4">
                    {user ? (
                        <button
                            onClick={() => setView('profile')}
                            className="flex items-center gap-2 px-3 py-1.5 sm:px-4 border border-white/20 rounded-full text-sm font-medium hover:bg-white/5 transition-colors"
                        >
                            <User size={16} />
                            <span className="hidden sm:inline">Profile</span>
                        </button>
                    ) : (
                        <button
                            onClick={signInWithGoogle}
                            className="flex items-center gap-2 px-3 py-1.5 sm:px-4 border border-white/20 rounded-full text-sm font-medium hover:bg-white/10 bg-white/5 transition-colors"
                        >
                            <User size={16} />
                            <span className="hidden sm:inline">Sign In</span>
                        </button>
                    )}
                    <button
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
            )}>
                {/* Mobile top division toggle removed since it is now in navbar */}

                <div className="flex flex-col items-center justify-center flex-1 gap-6 sm:gap-8">
                    {views.map(v => (
                        <button
                            key={v.id}
                            onClick={() => handleNav(v.id)}
                            className={cn(
                                "text-2xl sm:text-4xl font-bold tracking-widest transition-all duration-300 hover:scale-110",
                                view === v.id ? "text-white" : "text-zinc-600 hover:text-white"
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
