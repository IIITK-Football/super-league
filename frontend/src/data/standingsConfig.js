export const STANDINGS_CONFIG = {
    mens: {
        title: 'League Standings',
        buttonText: "Men's Standings",
        dataEndpoint: '/standings?division=mens',
        view: 'table'
    },
    womens: {
        title: 'Road to Final',
        buttonText: "Women's Bracket",
        dataEndpoint: '/standings?division=womens',
        view: 'bracket'
    },
    inter: {
        title: 'Inter-Department Standings',
        buttonText: 'Inter Standings',
        dataEndpoint: '/standings?division=inter',
        view: 'table'
    },
    freshers: {
        title: 'Freshers Standings',
        buttonText: 'Freshers Standings',
        dataEndpoint: '/standings?division=freshers',
        view: 'table'
    }
};