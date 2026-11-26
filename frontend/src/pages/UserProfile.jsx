import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { PasswordSettings } from '../components/PasswordSettings';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { useDivisions } from '../hooks/useDivisions';
import { supabase } from '../lib/supabase';
import { API_BASE_URL } from '../lib/api';
import { fetchWorldCupTeams, saveWorldCupFlair } from '../lib/authApi';
import MyPlayerCard from '../components/players/MyPlayerCard';
import { Button, Field, Notice, Pill, Skeleton } from '../components/ui';

const PILL = 'inline-flex min-h-11 w-full items-center justify-center rounded-pill bg-ink px-6 text-sm font-black uppercase tracking-[0.2em] text-bg transition hover:opacity-85 disabled:pointer-events-none disabled:opacity-40';

// Clubs of each division's current season, and the clubs this person supports.
async function loadClubs() {
  const { data, error } = await supabase.from('seasons')
    .select('division_id, team_entries(team:teams(id, name))').eq('is_current', true);
  if (error) throw error;
  const byDivision = {};
  for (const season of data || []) {
    byDivision[season.division_id] = (season.team_entries || []).map((e) => e.team).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return byDivision;
}

export function UserProfile() {
  const { user, profile, setProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const { data: lbResp, loading: lbLoading } = useApi('/predictions/leaderboard');
  const { divisions } = useDivisions();

  const leaderboard = lbResp?.data?.overall || [];
  const myEntry = leaderboard.find((entry) => entry.user_id === user?.id);
  const myRank = myEntry ? leaderboard.indexOf(myEntry) + 1 : null;

  const [nickname, setNickname] = useState(profile?.nickname || '');
  const [wcFlair, setWcFlair] = useState(profile?.wc_team_flair || '');
  const [flairs, setFlairs] = useState({});
  const [savedFlairs, setSavedFlairs] = useState({});
  const [clubs, setClubs] = useState({ status: 'loading', byDivision: {} });
  const [wcTeams, setWcTeams] = useState({ status: 'loading', list: [] });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  const loadLists = () => {
    setClubs({ status: 'loading', byDivision: {} });
    loadClubs()
      .then((byDivision) => setClubs({ status: 'ready', byDivision }))
      .catch(() => setClubs({ status: 'error', byDivision: {} }));
    setWcTeams({ status: 'loading', list: [] });
    fetchWorldCupTeams(API_BASE_URL)
      .then((list) => setWcTeams({ status: 'ready', list }))
      .catch(() => setWcTeams({ status: 'error', list: [] }));
  };

  useEffect(() => {
    loadLists();
    if (!user) return;
    supabase.from('division_flairs').select('division_id, team_name').eq('user_id', user.id).then(({ data }) => {
      const map = Object.fromEntries((data || []).map((f) => [f.division_id, f.team_name]));
      setFlairs(map);
      setSavedFlairs(map);
    });
  }, [user]);

  const name = nickname.trim();
  const hasChanges = name !== (profile?.nickname || '')
    || divisions.some((d) => (flairs[d.id] || '') !== (savedFlairs[d.id] || ''))
    || wcFlair !== (profile?.wc_team_flair || '');
  const canSave = !saving && name.length >= 3 && hasChanges;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const { error: updateError } = await supabase.from('user_profiles').update({ nickname: name }).eq('id', user.id);
      if (updateError) throw new Error('Your nickname was not saved. Try again.');
      if (wcFlair && wcFlair !== (profile?.wc_team_flair || '')) await saveWorldCupFlair(supabase, API_BASE_URL, user.id, wcFlair);
    } catch (err) {
      setError(err.message || 'Your profile was not saved. Try again.');
      setSaving(false);
      return;
    }

    // Division clubs: save the chosen ones, remove the cleared ones.
    const chosen = Object.entries(flairs).filter(([, team]) => team);
    const cleared = Object.keys(savedFlairs).filter((id) => !flairs[id]);
    const { error: flairError } = chosen.length
      ? await supabase.from('division_flairs').upsert(chosen.map(([division_id, team_name]) => ({ user_id: user.id, division_id, team_name })), { onConflict: 'user_id,division_id' })
      : { error: null };
    const { error: clearError } = cleared.length
      ? await supabase.from('division_flairs').delete().eq('user_id', user.id).in('division_id', cleared)
      : { error: null };
    if (flairError || clearError) {
      setError('Your profile was saved, but your clubs were not. Try again.');
      setSaving(false);
      return;
    }
    setSavedFlairs(Object.fromEntries(chosen));
    setProfile({ ...profile, id: user.id, email: user.email, nickname: name, wc_team_flair: wcFlair || profile?.wc_team_flair || null });
    setSaving(false);
    setSuccess(true);
  };

  if (!user) return null;

  const clubSelect = (d) => (
    <Field
      key={d.id}
      as="select"
      label={`${d.name} club`}
      value={flairs[d.id] || ''}
      onChange={(e) => setFlairs((current) => ({ ...current, [d.id]: e.target.value }))}
      disabled={clubs.status !== 'ready'}
    >
      <option value="">No club</option>
      {(clubs.byDivision[d.id] || []).map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
    </Field>
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-8 pb-12 text-ink">
      <header className="space-y-4">
        <p className="eyebrow">Your profile</p>
        <h1 className="font-display text-4xl break-words text-ink sm:text-6xl">{profile?.nickname || 'Choose a nickname'}</h1>
      </header>

      <section aria-label="Your standing" className="grid grid-cols-2 gap-4">
        <div className="rounded-card bg-blk p-5 text-blkink sm:p-6">
          <p className="eyebrow text-blkink/70">Rank</p>
          {lbLoading ? <Skeleton className="mt-3 h-14 w-24" /> : <p className="mt-2 font-display text-6xl leading-none tabular-nums">{myRank ? `#${myRank}` : '-'}</p>}
        </div>
        <div className="glass rounded-card p-5 sm:p-6">
          <p className="eyebrow">Prediction points</p>
          {lbLoading ? <Skeleton className="mt-3 h-14 w-24" /> : <p className="mt-2 font-display text-6xl leading-none tabular-nums text-ink">{(myEntry?.total_points ?? 0).toLocaleString()}</p>}
        </div>
      </section>

      <div className="glass flex flex-col gap-6 rounded-card p-5 sm:p-8">
        {error && <Notice tone="error" role="alert">{error}</Notice>}
        {success && <Notice tone="success">Profile saved.</Notice>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
          <Field
            label="Nickname"
            hint="3 to 20 characters. Shown on the prediction table."
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={20}
          />

          {clubs.status === 'error' && (
            <div className="flex flex-col items-start gap-2">
              <Notice tone="error">The clubs could not be loaded.</Notice>
              <Button variant="secondary" size="sm" onClick={loadLists}>Try again</Button>
            </div>
          )}
          {clubs.status === 'loading' && <Skeleton className="h-11 w-full" />}
          {clubs.status === 'ready' && divisions.length > 0 && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">{divisions.map(clubSelect)}</div>
          )}

          {wcTeams.status === 'error' ? (
            <Notice tone="error">The nation list could not be loaded, so the World Cup pick cannot change right now.</Notice>
          ) : (
            <Field
              as="select"
              label="World Cup nation (optional)"
              hint="This pick belongs to the World Cup predictor, not the league."
              value={wcFlair}
              onChange={(e) => setWcFlair(e.target.value)}
              disabled={wcTeams.status !== 'ready'}
            >
              <option value="">{wcTeams.status === 'ready' ? 'No pick' : 'Loading nations...'}</option>
              {wcTeams.list.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </Field>
          )}

          <button type="submit" disabled={!canSave} className={PILL}>
            {saving ? 'Saving...' : hasChanges ? 'Save changes' : 'No changes'}
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {divisions.filter((d) => savedFlairs[d.id]).map((d) => <Pill key={d.id}>{savedFlairs[d.id]}</Pill>)}
          {profile?.wc_team_flair && <Pill>{profile.wc_team_flair}</Pill>}
        </div>
      </div>

      <div className="glass flex flex-col gap-6 rounded-card p-5 sm:p-8">
        <PasswordSettings />
        <div className="flex justify-start border-t border-line/70 pt-6">
          <Button variant="secondary" onClick={() => { signOut(); navigate('/'); }}>
            <LogOut size={16} aria-hidden="true" /> Sign out
          </Button>
        </div>
      </div>

      <MyPlayerCard />
    </main>
  );
}
