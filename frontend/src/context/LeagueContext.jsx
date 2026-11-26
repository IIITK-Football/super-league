import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';

const LeagueContext = createContext(undefined);

// A division is a data record, named by its slug (super-league, wsl, freshers, or any division a dictator creates).
// Each division remembers the season chosen for it; without a choice its current season is used.
export const DEFAULT_DIVISION = 'super-league';
const DIVISION_STORAGE_KEY = 'league:division';
const SEASON_STORAGE_PREFIX = 'league:season:';
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Values stored by the earlier division-string app, mapped once to their division slugs.
const STORED_LEGACY = { mens: 'super-league', womens: 'wsl', freshers: 'freshers' };

const readStorage = (key) => {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null; // Storage can be unavailable in private/restricted browsing contexts.
  }
};
const writeStorage = (key, value) => {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Keep the in-memory selection working if storage is unavailable.
  }
};

function getInitialDivision() {
  if (typeof window === 'undefined') return DEFAULT_DIVISION;
  const saved = readStorage(DIVISION_STORAGE_KEY);
  const slug = STORED_LEGACY[saved] ?? saved;
  return slug && SLUG.test(slug) ? slug : DEFAULT_DIVISION;
}

// Current season first, then the most recent.
const orderSeasons = (list) => [...list].sort((a, b) =>
  Number(b.is_current) - Number(a.is_current)
  || a.sort_order - b.sort_order
  || String(b.starts_on ?? '').localeCompare(String(a.starts_on ?? ''))
  || String(b.slug).localeCompare(String(a.slug)));

export function LeagueProvider({ children }) {
  const [division, setDivisionInternal] = useState(getInitialDivision);
  const divisionRef = useRef(division);

  // Persist immediately when the division changes, so a route-triggered full page reload cannot reset it.
  // Supports both setDivision('wsl') and setDivision(current => ...).
  const setDivision = useCallback((nextDivision) => {
    const resolved = typeof nextDivision === 'function' ? nextDivision(divisionRef.current) : nextDivision;
    if (!resolved || !SLUG.test(resolved)) return;
    divisionRef.current = resolved;
    writeStorage(DIVISION_STORAGE_KEY, resolved);
    setDivisionInternal(resolved);
  }, []);

  // Seasons of the selected division that the viewer may see (row level security hides hidden/archived ones).
  const [seasonState, setSeasonState] = useState({ division: null, divisionRecord: null, seasons: [], sectionTypes: [], loading: true, error: '' });
  const [seasonChoice, setSeasonChoice] = useState(() => ({ [division]: readStorage(`${SEASON_STORAGE_PREFIX}${division}`) }));

  useEffect(() => {
    let cancelled = false;
    setSeasonState((s) => ({ ...s, loading: true, error: '' }));
    (async () => {
      const [{ data: record, error: divisionError }, types] = await Promise.all([
        supabase.from('divisions').select('id, slug, name, short_name, logo_url, primary_color')
          .eq('slug', division).eq('visibility', 'public').is('archived_at', null).maybeSingle(),
        supabase.from('section_types').select('key, label, default_enabled, default_sort_order'),
      ]);
      let seasons = [];
      let error = divisionError?.message || types.error?.message || '';
      if (record) {
        const { data, error: seasonsError } = await supabase.from('seasons')
          .select('id, slug, name, is_current, starts_on, ends_on, format, rules_md, sort_order, season_sections(section_key, label, enabled, nav_visible, sort_order)')
          .eq('division_id', record.id).eq('visibility', 'public').is('archived_at', null);
        seasons = orderSeasons(data || []);
        error = seasonsError?.message || error;
      }
      if (!cancelled) setSeasonState({
        division, divisionRecord: record || null, seasons, sectionTypes: types.data || [], loading: false, error,
      });
    })();
    return () => { cancelled = true; };
  }, [division]);

  // Choose a season of a division by slug (null = its current season). Called by the dropdown and by URLs.
  const setSeasonSlug = useCallback((slug, forDivision) => {
    const target = forDivision || divisionRef.current;
    const value = slug && SLUG.test(slug) ? slug : null;
    writeStorage(`${SEASON_STORAGE_PREFIX}${target}`, value);
    setSeasonChoice((c) => ({ ...c, [target]: value }));
  }, []);

  const ready = seasonState.division === division && !seasonState.loading;
  const seasons = ready ? seasonState.seasons : [];
  const requestedSeasonSlug = seasonChoice[division] ?? readStorage(`${SEASON_STORAGE_PREFIX}${division}`) ?? null;
  const currentSeason = seasons.find((s) => s.is_current) || null;
  const chosen = requestedSeasonSlug ? seasons.find((s) => s.slug === requestedSeasonSlug) : null;
  const season = requestedSeasonSlug ? chosen || null : currentSeason;
  const sections = useMemo(() => {
    if (!season) return [];
    const overrides = new Map((season.season_sections || []).map((row) => [row.section_key, row]));
    return seasonState.sectionTypes.map((type) => {
      const row = overrides.get(type.key);
      return {
        key: type.key,
        label: row?.label ?? type.label,
        enabled: row?.enabled ?? type.default_enabled,
        navVisible: row?.nav_visible ?? type.default_enabled,
        order: row?.sort_order ?? type.default_sort_order,
      };
    }).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  }, [season, seasonState.sectionTypes]);

  const seasonScope = useMemo(() => ({
    ready,
    division,
    divisionRecord: ready ? seasonState.divisionRecord : null,
    seasons,
    season,
    currentSeason,
    sections,
    requestedSeasonSlug,
    // A season named (by URL or a stored choice) that is not among the visible seasons.
    seasonMissing: ready && Boolean(requestedSeasonSlug) && !chosen,
    error: ready ? seasonState.error : '',
  }), [ready, division, seasonState, seasons, season, currentSeason, sections, requestedSeasonSlug, chosen]);

  // ADDED 'matchTimeline' and 'player-profile' to your tracker comment!
  const [view, setViewInternal] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') || 'fantasy';
  }); // 'home' | 'matches' | 'standings' | 'teams' | 'fantasy' | 'leaderboard' | 'news' | 'legends' | 'rules' | 'login' | 'player-profile' | 'matchTimeline'

  const setView = (newView) => {
    setViewInternal(newView);
    window.history.pushState({ view: newView }, '', `?view=${newView}`);
  };

  const goBack = () => {
    // Basic back handling, returns home if we can't pop
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setView('home');
    }
  };

  useEffect(() => {
    const handlePopState = (e) => {
      if (e.state && e.state.view) {
        setViewInternal(e.state.view);
      } else {
        const params = new URLSearchParams(window.location.search);
        setViewInternal(params.get('view') || 'home');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const [fantasyPrediction, setFantasyPrediction] = useState(null);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [fantasySection, setFantasySection] = useState('fifa'); // 'season1' | 'fifa'

  return (
    <LeagueContext.Provider value={{
      division, setDivision,
      seasonScope, setSeasonSlug,
      view, setView, goBack,
      fantasyPrediction, setFantasyPrediction,
      selectedArticle, setSelectedArticle,
      fantasySection, setFantasySection
    }}>
      {children}
    </LeagueContext.Provider>
  );
}

export function useLeague() {
  const context = useContext(LeagueContext);
  if (context === undefined) {
    throw new Error('useLeague must be used within a LeagueProvider');
  }
  return context;
}

// The query string that scopes an API request to the selected division and season.
export function scopeQuery(seasonScope) {
  const params = new URLSearchParams({ division: seasonScope.division });
  if (seasonScope.season) params.set('season', seasonScope.season.slug);
  return params.toString();
}
