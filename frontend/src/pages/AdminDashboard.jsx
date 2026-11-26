import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui';
import { cn } from '../utils/cn';
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

// The dictator workspace. Sections are buttons in one row (it scrolls sideways on phones). A scorer sees Live matches
// only. Row level security and the API enforce the same rules; the hidden sections are not the authorization.
const DICTATOR_SECTIONS = [
  { id: 'live', label: 'Live matches' },
  { id: 'schedule', label: 'Fixtures' },
  { id: 'captains', label: 'Captains' },
  { id: 'scorers', label: 'Scorers' },
  { id: 'roles', label: 'Access control' },
  { id: 'grading', label: 'Grade fantasy' },
  { id: 'news', label: 'News' },
  { id: 'divisions', label: 'Divisions and seasons' },
  { id: 'rosters', label: 'Teams and rosters' },
  { id: 'audit', label: 'Audit history' },
];

export function AdminDashboard() {
  const { user, hasRole, roles, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState('live');
  // The account picked in Access control, which opens the Scorers section on it (the one scorer flow).
  const [scorerPerson, setScorerPerson] = useState(null);

  const isDictator = hasRole('dictator');
  const isScorer = hasRole('scorer');
  if (!roles) return <p className="p-6 text-sm text-mut">Verifying clearance...</p>;

  if (!user || (!isDictator && !isScorer)) return (
    <div className="mx-auto max-w-md space-y-3 p-6 pt-24">
      <h1 className="font-display text-3xl font-bold text-ink">403 forbidden</h1>
      <p className="text-mut">This workspace needs dictator or scorer access. Ask a dictator to grant it.</p>
    </div>
  );

  const sections = isDictator ? DICTATOR_SECTIONS : [{ id: 'live', label: 'Live matches' }];

  return (
    <div className="workspace min-h-screen bg-bg pt-20 text-ink">
      <div className="mx-auto max-w-6xl space-y-8 px-4 pb-16 pt-6 md:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-3">
            <p className="eyebrow">{isDictator ? 'All divisions' : 'Assigned matches'}</p>
            <h1 className="font-display text-5xl font-black uppercase leading-[0.9] tracking-tight sm:text-6xl">{isDictator ? 'Dictator' : 'Scorer'}</h1>
            <p className="text-sm text-mut">{isDictator ? 'Matches, fixtures, teams, access and news.' : 'Live matches you are assigned to score.'}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={signOut}>Sign out</Button>
        </header>

        <nav aria-label="Workspace sections" className="glass no-scrollbar -mx-4 flex gap-1 overflow-x-auto rounded-pill p-1 px-4 md:mx-0 md:flex-wrap md:px-1">
          {sections.map((section) => {
            const selected = activeTab === section.id;
            return (
              <button
                key={section.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setActiveTab(section.id)}
                className={cn(
                  'min-h-11 shrink-0 rounded-pill px-4 text-xs font-bold uppercase tracking-wider transition-colors duration-200',
                  selected ? 'bg-ink text-bg' : 'text-mut hover:text-ink',
                )}
              >
                {section.label}
              </button>
            );
          })}
        </nav>

        <section aria-label={sections.find((s) => s.id === activeTab)?.label} className="glass min-h-96 rounded-card p-4 sm:p-6">
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
        </section>
      </div>
    </div>
  );
}
