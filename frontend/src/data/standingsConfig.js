// How each division's standings page is presented, keyed by division slug. A division without an entry (for
// example one a dictator creates) gets the league table.
export const DEFAULT_STANDINGS_CONFIG = {
    title: 'League Standings',
    buttonText: 'Standings',
    view: 'table'
};

export const STANDINGS_CONFIG = {
    'super-league': {
        title: 'League Standings',
        buttonText: "Men's Standings",
        view: 'table'
    },
    wsl: {
        title: 'Road to Final',
        buttonText: 'Road to Final',
        view: 'bracket'
    },
    freshers: {
        title: 'Road to Final',
        buttonText: 'Road to Final',
        view: 'freshers-bracket'
    }
};
