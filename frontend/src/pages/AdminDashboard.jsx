import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Users, Shield, Calendar, Newspaper, Activity, LogOut, Menu, X ,Calculator, Layers, History} from 'lucide-react';
import { GlassPanel } from '../components/GlassPanel';
import LiveController from '../components/admin/LiveController';
import ScheduleMatches from '../components/admin/ScheduleMatches';
import ManageNews from '../components/admin/ManageNews';
import GradePredictions from '../components/admin/GradePredictions';
import ManageCaptains from '../components/admin/ManageCaptains';
import ManageScorers from '../components/admin/ManageScorers';
import ManageRoles from '../components/admin/ManageRoles';
import ManageDivisions from '../components/admin/ManageDivisions';
import ManageRosters from '../components/admin/ManageRosters';
import AuditHistory from '../components/admin/AuditHistory';
export function AdminDashboard() {
  const { user, hasRole, roles, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState('live');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false); // NEW: Mobile menu state
  // The account picked in Access control, which opens the Scorers tab on it (the one scorer flow).
  const [scorerPerson, setScorerPerson] = useState(null);

  // The grants held now (my_roles), never a UI label. A dictator gets every tab; a scorer only Live Matches (the match
  // workspace); nobody else gets in. Row level security and the API enforce the same rules.
  const isDictator = hasRole('dictator');
  const isScorer = hasRole('scorer');
  if (!roles) return <div className="min-h-screen bg-black flex items-center justify-center text-zinc-500 font-bold uppercase tracking-widest">Verifying Clearance...</div>;

  // The Ultimate Kick-Out: No user OR neither a dictator nor a scorer!
  if (!user || (!isDictator && !isScorer)) return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white p-10 space-y-4">
      <h1 className="text-4xl font-black text-red-500 uppercase tracking-widest">403 Forbidden</h1>
      <p className="text-zinc-500 tracking-widest uppercase text-sm">You do not have command clearance.</p>
    </div>
  );

  const tabs = isDictator ? [
    { id: 'live', label: 'Live Matches', icon: Activity, color: 'text-red-500' },
    { id: 'schedule', label: 'Schedule', icon: Calendar },
    { id: 'captains', label: 'Captains', icon: Users },
    { id: 'scorers', label: 'Scorers', icon: Activity },
    { id: 'roles', label: 'Access Control', icon: Shield },
    { id: 'grading', label: 'Grade Fantasy', icon: Calculator, color: 'text-[#E8C881]' },
    { id: 'news', label: 'Newsletter', icon: Newspaper },
    { id: 'divisions', label: 'Divisions & Seasons', icon: Layers },
    { id: 'rosters', label: 'Teams & Rosters', icon: Users },
    { id: 'audit', label: 'Audit History', icon: History },
  ] : [
    { id: 'live', label: 'Live Matches', icon: Activity, color: 'text-red-500' },
  ];

  return (
    // FIX: Change to flex-col on mobile, flex-row on desktop
    <div className="min-h-screen bg-black text-white flex flex-col md:flex-row pt-20">
      
      {/* --- MOBILE TOP BAR --- */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-white/10 bg-black/80 backdrop-blur-md z-30">
        <h1 className="text-lg font-black uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-500">
          Admin Command
        </h1>
        <button 
          onClick={() => setIsMobileMenuOpen(true)} 
          className="p-2 text-zinc-400 hover:text-white transition-colors"
        >
          <Menu size={24} />
        </button>
      </div>

      {/* --- MOBILE OVERLAY --- */}
      {/* Clicks outside the sidebar on mobile will close the menu */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* --- SIDEBAR --- */}
      <div className={`
        fixed md:static inset-y-0 left-0 z-50 w-64 border-r border-white/10 bg-zinc-950 md:bg-black/50 p-6 flex flex-col transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="flex items-center justify-between mb-10">
          <h1 className="text-xl font-black uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-500 hidden md:block">
            Admin Command
          </h1>
          <h1 className="text-lg font-black uppercase tracking-widest text-zinc-400 md:hidden">
            Menu
          </h1>
          <button 
            onClick={() => setIsMobileMenuOpen(false)} 
            className="md:hidden p-2 text-zinc-400 hover:text-white rounded-lg transition-colors"
          >
            <X size={24} />
          </button>
        </div>
        
        <nav className="flex-1 space-y-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setIsMobileMenuOpen(false); // Auto-close menu on mobile when a tab is clicked
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold uppercase tracking-wider text-sm transition-all duration-300 ${
                  isActive 
                    ? 'bg-white text-black' 
                    : 'text-zinc-500 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon size={18} className={isActive ? 'text-black' : tab.color || 'text-zinc-500'} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <button 
          onClick={signOut}
          className="flex items-center gap-3 px-4 py-3 text-zinc-500 hover:text-red-500 font-bold uppercase tracking-wider text-sm transition-colors mt-auto"
        >
          <LogOut size={18} /> Sign Out
        </button>
      </div>

      {/* --- MAIN CONTENT AREA --- */}
      {/* FIX: Reduced padding on mobile (`p-4 md:p-8`), ensured it takes full width */}
      <div className="flex-1 p-4 md:p-8 overflow-y-auto w-full max-w-full">
        <GlassPanel className="min-h-full border border-white/10 bg-black/60">
          {activeTab === 'live' && <LiveController />}
          {isDictator && activeTab === 'schedule' && <ScheduleMatches />}
          {isDictator && activeTab === 'captains' && <ManageCaptains />}
          {isDictator && activeTab === 'scorers' && <ManageScorers person={scorerPerson} />}
          {isDictator && activeTab === 'roles' && <ManageRoles currentUserId={user.id} onAssignScorer={(account) => { setScorerPerson(account); setActiveTab('scorers'); }} />}
          {isDictator && activeTab === 'grading' && <GradePredictions />}
          {isDictator && activeTab === 'news' && <ManageNews />}
          {isDictator && activeTab === 'divisions' && <ManageDivisions />}
          {isDictator && activeTab === 'rosters' && <ManageRosters />}
          {isDictator && activeTab === 'audit' && <AuditHistory />}
        </GlassPanel>
      </div>

    </div>
  );
}
