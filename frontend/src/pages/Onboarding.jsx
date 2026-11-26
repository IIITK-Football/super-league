import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { API_BASE_URL } from '../lib/api';
import { fetchWorldCupTeams, saveWorldCupFlair } from '../lib/authApi';
import { Button, Card, Field, Notice } from '../components/ui';

// First sign-in: a nickname is all the league needs. The World Cup champion pick belongs to the World Cup predictor,
// so it is optional here unless that predictor asks for it (requireWorldCup).
export function Onboarding({ requireWorldCup = false }) {
  const { user, profile, setProfile, signOut } = useAuth();
  const [nickname, setNickname] = useState(profile?.nickname || '');
  const [wcFlair, setWcFlair] = useState(profile?.wc_team_flair || '');
  const [teams, setTeams] = useState(null);
  const [teamsError, setTeamsError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const loadTeams = () => {
    setTeams(null);
    setTeamsError(null);
    fetchWorldCupTeams(API_BASE_URL).then(setTeams).catch(() => setTeamsError('The nation list could not be loaded.'));
  };
  useEffect(() => { loadTeams(); }, []);

  const name = nickname.trim();
  const canSubmit = !saving && name.length >= 3 && (!requireWorldCup || wcFlair);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      if (wcFlair) await saveWorldCupFlair(supabase, API_BASE_URL, user.id, wcFlair);
      // The row is created at sign-up; create it here only if it is missing. The email is never written here.
      const { data: savedRows, error: updateError } = await supabase
        .from('user_profiles')
        .update({ nickname: name })
        .eq('id', user.id)
        .select('id');
      if (updateError) throw updateError;
      if (!savedRows?.length) {
        const { error: insertError } = await supabase.from('user_profiles').insert({ id: user.id, nickname: name });
        if (insertError) throw insertError;
      }
    } catch (err) {
      console.error('Onboarding save failed', err);
      setError('Your profile was not saved. Check your connection and try again.');
      setSaving(false);
      return;
    }
    setProfile({ ...profile, id: user.id, email: user.email, nickname: name, wc_team_flair: wcFlair || profile?.wc_team_flair || null });
    setSaving(false);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 bg-bg px-4 py-10 text-ink">
      <Card className="flex flex-col gap-6 p-6 sm:p-8">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-bold">Welcome to Super League</h1>
          <p className="text-mut">Signed in as {user.email}. Choose a nickname to join the predictions and the prediction table.</p>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          <Field
            label="Nickname"
            hint="3 to 20 characters. Shown on the prediction table."
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={20}
            autoComplete="nickname"
          />

          <Field
            as="select"
            label={requireWorldCup ? 'World Cup champion' : 'World Cup champion (optional)'}
            hint={requireWorldCup
              ? 'Your World Cup predictor needs this pick.'
              : 'The World Cup pick belongs to the World Cup predictor, not the league. Skip it if you like.'}
            value={wcFlair}
            onChange={(e) => setWcFlair(e.target.value)}
            disabled={!teams}
            required={requireWorldCup}
          >
            <option value="">{teams ? 'No pick for now' : 'Loading nations...'}</option>
            {(teams || []).map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
          </Field>
          {teamsError && (
            <div className="flex flex-col items-start gap-2">
              <Notice tone="error">{teamsError} You can still save your nickname{requireWorldCup ? ' once it loads' : ''}.</Notice>
              <Button variant="secondary" size="sm" onClick={loadTeams}>Try again</Button>
            </div>
          )}

          <Button type="submit" variant="primary" size="lg" disabled={!canSubmit} className="w-full">
            {saving ? 'Saving...' : 'Enter the league'}
          </Button>
        </form>

        <Button variant="quiet" onClick={() => signOut()} className="self-center">Sign out</Button>
      </Card>
    </main>
  );
}
