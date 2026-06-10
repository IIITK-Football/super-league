/**
 * FIFA World Cup 2026 Bracket Logic
 * This module handles the mapping of the 32 advancing teams into the correct Round of 32 slots.
 */

// The 2026 format has 12 groups (A through L).
// Top 2 advance from each (24 teams) + 8 best 3rd placed teams.

/**
 * Assigns the 8 selected third-place teams to the 8 designated matches.
 * The official FIFA rules use a 495-combination lookup table.
 * For this prototype, we use a deterministic allocation that maps the selected 
 * groups (e.g. ['A', 'C', 'E', 'F', 'H', 'I', 'J', 'K']) to the available 3rd place slots.
 * 
 * The 8 available slots for 3rd placed teams typically match up against Group Winners.
 * We define 8 matches that expect a 3rd place team.
 */
export function assignThirdPlaceTeams(selectedThirdPlaceGroups) {
  // Sort the selected groups alphabetically to maintain consistency (e.g., ['A', 'B', 'D', ...])
  const sorted = [...selectedThirdPlaceGroups].sort();
  
  // The 8 match identifiers where a 3rd place team plays a 1st place team.
  // In the real tournament these are specific matches (e.g., Match 74, Match 76, etc.)
  // We'll call them '3rd_slot_1' through '3rd_slot_8' for now.
  const assignments = {};
  
  // Deterministic fallback: simply map the sorted 3rd place groups into the 8 slots.
  // In a full implementation, this would be `const assignments = lookupTable[sorted.join('')];`
  assignments['3rd_slot_1'] = sorted[0];
  assignments['3rd_slot_2'] = sorted[1];
  assignments['3rd_slot_3'] = sorted[2];
  assignments['3rd_slot_4'] = sorted[3];
  assignments['3rd_slot_5'] = sorted[4];
  assignments['3rd_slot_6'] = sorted[5];
  assignments['3rd_slot_7'] = sorted[6];
  assignments['3rd_slot_8'] = sorted[7];

  return assignments;
}

/**
 * Generates the initial Round of 32 match structure based on the user's group standings
 * and their 8 selected 3rd-place teams.
 * 
 * @param {Object} groupStandings - { "A": [team1, team2, team3, team4], "B": [...] }
 * @param {Array<string>} selectedThirdGroups - ['A', 'C', 'D', 'E', 'F', 'I', 'J', 'L']
 * @returns {Array} - Array of 16 match objects for the Round of 32
 */
export function generateRoundOf32(groupStandings, selectedThirdGroups) {
  const thirdPlaceAssignments = assignThirdPlaceTeams(selectedThirdGroups);

  // Helper to safely get a team
  const getTeam = (group, position) => {
    if (groupStandings[group] && groupStandings[group][position - 1]) {
      return groupStandings[group][position - 1];
    }
    return { name: `TBD (${position}${group})`, logo_url: '' };
  };

  const getThirdTeam = (slotKey) => {
    const group = thirdPlaceAssignments[slotKey];
    if (group && groupStandings[group] && groupStandings[group][2]) {
      return groupStandings[group][2]; // index 2 is 3rd place
    }
    return { name: `TBD (3rd Place)`, logo_url: '' };
  };

  // Define the 16 Round of 32 Matches based on a standard 32-team draw format
  // The official FIFA format maps specific 1st vs 2nd, 2nd vs 2nd, and 1st vs 3rd.
  // We construct a tree that funnels Left and Right.
  
  const matches = [
    // --- LEFT SIDE OF BRACKET ---
    { id: 'm1', nextMatchId: 'm17', team1: getTeam('A', 1), team2: getThirdTeam('3rd_slot_1') },
    { id: 'm2', nextMatchId: 'm17', team1: getTeam('B', 2), team2: getTeam('C', 2) },
    
    { id: 'm3', nextMatchId: 'm18', team1: getTeam('D', 1), team2: getThirdTeam('3rd_slot_2') },
    { id: 'm4', nextMatchId: 'm18', team1: getTeam('E', 2), team2: getTeam('F', 2) },
    
    { id: 'm5', nextMatchId: 'm19', team1: getTeam('G', 1), team2: getThirdTeam('3rd_slot_3') },
    { id: 'm6', nextMatchId: 'm19', team1: getTeam('H', 2), team2: getTeam('I', 2) },
    
    { id: 'm7', nextMatchId: 'm20', team1: getTeam('J', 1), team2: getThirdTeam('3rd_slot_4') },
    { id: 'm8', nextMatchId: 'm20', team1: getTeam('K', 2), team2: getTeam('L', 2) },
    
    // --- RIGHT SIDE OF BRACKET ---
    { id: 'm9', nextMatchId: 'm21', team1: getTeam('B', 1), team2: getThirdTeam('3rd_slot_5') },
    { id: 'm10', nextMatchId: 'm21', team1: getTeam('A', 2), team2: getTeam('D', 2) },
    
    { id: 'm11', nextMatchId: 'm22', team1: getTeam('C', 1), team2: getThirdTeam('3rd_slot_6') },
    { id: 'm12', nextMatchId: 'm22', team1: getTeam('E', 1), team2: getThirdTeam('3rd_slot_7') },
    
    { id: 'm13', nextMatchId: 'm23', team1: getTeam('F', 1), team2: getThirdTeam('3rd_slot_8') },
    { id: 'm14', nextMatchId: 'm23', team1: getTeam('G', 2), team2: getTeam('J', 2) },
    
    { id: 'm15', nextMatchId: 'm24', team1: getTeam('H', 1), team2: getTeam('K', 1) },
    { id: 'm16', nextMatchId: 'm24', team1: getTeam('I', 1), team2: getTeam('L', 1) }
  ];

  return matches;
}

/**
 * Empty match slots for the rest of the bracket
 */
export function generateEmptyKnockouts() {
  const rounds = {
    roundOf16: [
      { id: 'm17', nextMatchId: 'm25', team1: null, team2: null },
      { id: 'm18', nextMatchId: 'm25', team1: null, team2: null },
      { id: 'm19', nextMatchId: 'm26', team1: null, team2: null },
      { id: 'm20', nextMatchId: 'm26', team1: null, team2: null },
      { id: 'm21', nextMatchId: 'm27', team1: null, team2: null },
      { id: 'm22', nextMatchId: 'm27', team1: null, team2: null },
      { id: 'm23', nextMatchId: 'm28', team1: null, team2: null },
      { id: 'm24', nextMatchId: 'm28', team1: null, team2: null },
    ],
    quarterFinals: [
      { id: 'm25', nextMatchId: 'm29', team1: null, team2: null },
      { id: 'm26', nextMatchId: 'm29', team1: null, team2: null },
      { id: 'm27', nextMatchId: 'm30', team1: null, team2: null },
      { id: 'm28', nextMatchId: 'm30', team1: null, team2: null },
    ],
    semiFinals: [
      { id: 'm29', nextMatchId: 'm31', team1: null, team2: null },
      { id: 'm30', nextMatchId: 'm31', team1: null, team2: null },
    ],
    final: [
      { id: 'm31', nextMatchId: null, team1: null, team2: null },
    ]
  };
  return rounds;
}
