/* eslint-disable react/prop-types -- this codebase does not use prop-types */
import { useEffect, useState } from 'react';
import { User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { API_BASE_URL } from '../lib/api';
import { fetchWorldCupTeams, saveWorldCupFlair } from '../lib/authApi';
import { Button, Field, Combobox, Notice, TextInput, toast } from '../components/ui';
// The Super League mark, drawn in the ink colour through a mask of the logo file.
const MARK_MASK = {
  maskImage: 'url(/slklogo3.png)', WebkitMaskImage: 'url(/slklogo3.png)', maskSize: 'contain', WebkitMaskSize: 'contain',
  maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center',
};
const PILL = 'inline-flex min-h-11 w-full items-center justify-center rounded-pill bg-ink px-6 text-sm font-black uppercase tracking-[0.2em] text-bg transition hover:opacity-85 disabled:pointer-events-none disabled:opacity-40';

// The centred glass card every sign-in screen shares: the mark, a big heading, then the form.
function AuthShell({ heading, children }) {
  return (
    <div className="flex min-h-[calc(100vh-12rem)] items-center justify-center text-ink">
      <section className="glass flex w-full max-w-md flex-col gap-8 rounded-card p-6 sm:p-10">
        <span role="img" aria-label="Super League, IIIT Kottayam" className="block size-12 bg-ink" style={MARK_MASK} />
        <h1 className="font-display text-4xl text-ink sm:text-5xl">{heading}</h1>
        {children}
      </section>
    </div>
  );
}


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
    toast({ title: 'Welcome in', tone: 'success' });
  };

  return (
    <AuthShell heading="Welcome to Super League">
      <p className="text-mut">Signed in as {user.email}. Choose a nickname to join the predictions and the prediction table.</p>

      {error && <Notice tone="error">{error}</Notice>}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <Field
          label="Nickname"
          hint="3 to 20 characters. Shown on the prediction table."
          error={name && name.length < 3 ? 'Use at least 3 characters.' : undefined}
        >
          {(p) => <TextInput {...p} icon={User} value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={20} autoComplete="nickname" />}
        </Field>

        <Field
          label={requireWorldCup ? 'World Cup champion' : 'World Cup champion (optional)'}
          hint={requireWorldCup
            ? 'Your World Cup predictor needs this pick.'
            : 'The World Cup pick belongs to the World Cup predictor, not the league. Skip it if you like.'}
        >
          {(p) => (
            <Combobox
              {...p}
              value={wcFlair}
              onChange={setWcFlair}
              disabled={!teams}
              placeholder={teams ? 'No pick for now' : 'Loading nations...'}
              searchPlaceholder="Search nations"
              options={[{ value: '', label: 'No pick for now' }, ...(teams || []).map((t) => ({ value: t.name, label: t.name }))]}
            />
          )}
        </Field>
        {teamsError && (
          <div className="flex flex-col items-start gap-2">
            <Notice tone="error">{teamsError} You can still save your nickname{requireWorldCup ? ' once it loads' : ''}.</Notice>
            <Button variant="secondary" size="sm" onClick={loadTeams}>Try again</Button>
          </div>
        )}

        <button type="submit" disabled={!canSubmit} className={PILL}>
          {saving ? 'Saving...' : 'Enter the league'}
        </button>
      </form>

      <Button variant="quiet" onClick={() => signOut()} className="self-center">Sign out</Button>
    </AuthShell>
  );
}
