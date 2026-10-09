import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

const LeagueContext = createContext(undefined);

const DIVISION_STORAGE_KEY = 'league:division';
const VALID_DIVISIONS = ['mens', 'womens', 'freshers'];

function getInitialDivision() {
  if (typeof window === 'undefined') return 'mens';

  try {
    const savedDivision = window.sessionStorage.getItem(DIVISION_STORAGE_KEY);
    return VALID_DIVISIONS.includes(savedDivision) ? savedDivision : 'mens';
  } catch {
    // Storage can be unavailable in private/restricted browsing contexts.
    return 'mens';
  }
}

export function LeagueProvider({ children }) {
  const [division, setDivisionInternal] = useState(getInitialDivision);
  const divisionRef = useRef(division);

  // Persist immediately when the division changes, so a route-triggered full
  // page reload cannot reset the dashboard back to 'mens'. Supports both
  // setDivision('womens') and setDivision(current => ...).
  const setDivision = useCallback((nextDivision) => {
    const resolvedDivision = typeof nextDivision === 'function'
      ? nextDivision(divisionRef.current)
      : nextDivision;

    if (!VALID_DIVISIONS.includes(resolvedDivision)) return;

    divisionRef.current = resolvedDivision;

    try {
      window.sessionStorage.setItem(DIVISION_STORAGE_KEY, resolvedDivision);
    } catch {
      // Keep the in-memory selection working if storage is unavailable.
    }

    setDivisionInternal(resolvedDivision);
  }, []);

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
  const [globalPollState, setGlobalPollState] = useState({ mens: null, womens: null });
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [fantasySection, setFantasySection] = useState('fifa'); // 'season1' | 'fifa'

  return (
    <LeagueContext.Provider value={{
      division, setDivision,
      view, setView, goBack,
      fantasyPrediction, setFantasyPrediction,
      globalPollState, setGlobalPollState,
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

