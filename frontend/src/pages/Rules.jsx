import { useLeague } from '../context/LeagueContext';
import { useApi } from '../hooks/useApi';
import { Loader } from '../components/Loader';
import { RulesBlocks } from '../components/rules/RulesBlocks';

// The latest published rules of the selected season. A dictator builds and publishes them at /dictator.
export function Rules() {
  const { seasonScope } = useLeague();
  const { data, loading, refetch } = useApi('/rules');
  const rules = data?.success ? data.data.rules : null;

  let content;
  if (loading || !seasonScope.ready) content = <Loader />;
  else if (!data?.success) {
    content = <div role="alert" className="space-y-3 text-center text-zinc-400">
      <p>{data?.message || 'The rules could not be loaded.'}</p>
      <button type="button" onClick={refetch} className="rounded-lg border border-white/15 px-4 py-2 text-xs font-black uppercase tracking-wider text-white">Try again</button>
    </div>;
  } else if (!rules) content = <p className="text-center text-zinc-400">Rules have not been published for this season yet.</p>;
  else content = <RulesBlocks blocks={rules.blocks} />;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20 px-2 sm:px-4">
      <div className="text-center space-y-4 border-b border-white/10 pb-10">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tighter uppercase text-white">
          {seasonScope.divisionRecord?.name} Rules
        </h1>
        {seasonScope.season && <p className="text-xs font-black uppercase tracking-widest text-zinc-500">
          {seasonScope.season.name}{rules ? ` · updated ${new Date(rules.published_at).toLocaleDateString()}` : ''}
        </p>}
      </div>
      {content}
    </div>
  );
}
