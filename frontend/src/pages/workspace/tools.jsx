import { CalendarDays, Crown, History, KeyRound, LayoutDashboard, Layers, Newspaper, Radio, Shield, Shirt, Target, Timer } from 'lucide-react';
import LiveController from '../../components/admin/LiveController';
import ScheduleMatches from '../../components/admin/ScheduleMatches';
import ManageNews from '../../components/admin/ManageNews';
import GradePredictions from '../../components/admin/GradePredictions';
import ManageCaptains from '../../components/admin/ManageCaptains';
import ManageScorers from '../../components/admin/ManageScorers';
import ManageRoles from '../../components/admin/ManageRoles';
import ManageDivisions from '../../components/admin/ManageDivisions';
import ManageRosters from '../../components/admin/ManageRosters';
import AuditHistory from '../../components/admin/AuditHistory';
import { TeamBuilder } from '../TeamBuilder';

// Every staff tool, in sidebar order. `roles` are the grants that open it (none implies another; the server and row
// level security check the same rules, so this list only decides what is offered). `nav` narrows who sees it in the
// sidebar when that differs. `action` is the header's primary action: a link, often to a form on the page (#id).
export const GROUPS = ['Matchday', 'League', 'People', 'Content', 'System'];

export const OVERVIEW = { id: 'overview', path: '/dictator', label: 'Overview', icon: LayoutDashboard, roles: ['dictator'], purpose: 'Today across every division, and the next thing to do.' };

export const TOOLS = [
  { id: 'live', group: 'Matchday', label: 'Live matches', icon: Radio, roles: ['dictator', 'scorer'], purpose: 'Start, score and finish the matches you run.',
    render: () => <LiveController /> },
  { id: 'fixtures', group: 'Matchday', label: 'Fixtures', icon: CalendarDays, roles: ['dictator'], purpose: 'Plan kickoffs and keep the schedule right.',
    action: { label: 'Add fixture', to: '#add-fixture' }, render: () => <ScheduleMatches /> },
  { id: 'divisions', group: 'League', label: 'Divisions and seasons', icon: Layers, roles: ['dictator'], purpose: 'Create divisions, run seasons and choose their sections.',
    action: { label: 'New division', to: '#new-division' }, render: () => <ManageDivisions /> },
  { id: 'teams', group: 'League', label: 'Teams and rosters', icon: Shield, roles: ['dictator'], purpose: 'Teams in each season, their players and account links.',
    render: () => <ManageRosters /> },
  { id: 'team', path: '/team-builder', group: 'League', label: 'My team', icon: Shirt, roles: ['captain', 'dictator'], nav: ['captain'], purpose: 'Your team details, branding and player cards.',
    render: () => <TeamBuilder /> },
  { id: 'grading', group: 'League', label: 'Grade predictions', icon: Target, roles: ['dictator'], purpose: 'Score fantasy predictions once a match is final.',
    render: () => <GradePredictions /> },
  { id: 'captains', group: 'People', label: 'Captains', icon: Crown, roles: ['dictator'], purpose: 'Give each team in a season its captain.',
    render: () => <ManageCaptains /> },
  { id: 'scorers', group: 'People', label: 'Scorers', icon: Timer, roles: ['dictator'], purpose: 'Let someone score a season or a single match.',
    action: { label: 'Assign scorer', to: '#assign-scorer' }, render: ({ location }) => <ManageScorers person={location.state?.scorerPerson ?? null} /> },
  { id: 'access', group: 'People', label: 'Access control', icon: KeyRound, roles: ['dictator'], purpose: 'Grant and remove staff roles.',
    render: ({ user, navigate }) => <ManageRoles currentUserId={user.id} onAssignScorer={(account) => navigate('/dictator/scorers', { state: { scorerPerson: account } })} /> },
  { id: 'news', group: 'Content', label: 'News', icon: Newspaper, roles: ['editor', 'dictator'], purpose: 'Write and publish the newsletter.',
    action: { label: 'Write news', to: '#write-news' }, render: () => <ManageNews /> },
  { id: 'audit', group: 'System', label: 'Audit history', icon: History, roles: ['dictator'], purpose: 'Who changed what, and when. Read only.',
    render: () => <AuditHistory /> },
].map((tool) => ({ path: `/dictator/${tool.id}`, ...tool }));

export const toolById = (id) => TOOLS.find((tool) => tool.id === id);
export const allows = (item, roles) => (item?.roles ?? []).some((role) => roles?.includes(role));
// The sidebar: the overview for a dictator, then every tool the grants open.
export const navFor = (roles) => [OVERVIEW, ...TOOLS].filter((item) => (item.nav ?? item.roles).some((role) => roles?.includes(role)));
