import './MatchNode.css';

export function MatchNode({ match, onSelectWinner, disabled, isFinal, officialAdvances, roundCapacity }) {
  const { team1, team2, winnerId, id } = match;

  const handleSelect = (team) => {
    if (disabled || !team1 || !team2) return;
    if (!team.name || team.name.startsWith('TBD')) return;
    onSelectWinner(id, team);
  };

  const getAbbreviation = (name) => {
    if (!name || name.startsWith('TBD')) return '';
    return name.substring(0, 3).toUpperCase();
  };

  const renderTeam = (team) => {
    if (!team || !team.name || team.name.startsWith('TBD')) {
      return (
        <div className="mn-team tbd">
          <div className="mn-flag-placeholder" />
          <div className="mn-name-placeholder" />
          <div className="mn-circle empty" />
        </div>
      );
    }

    const isWinner = winnerId && team.id && winnerId === team.id;
    const isLoser = winnerId && team.id && winnerId !== team.id;

    // --- GRADING LOGIC ---
    let gradeClass = '';
    if (isWinner && officialAdvances && roundCapacity && officialAdvances.length === roundCapacity) {
        // Check if the team the user picked is actually in the official array
        const isCorrect = officialAdvances.includes(team.name);
        gradeClass = isCorrect ? 'correct-prediction' : 'incorrect-prediction';
    }

    return (
      <div 
        className={`mn-team selectable ${isWinner ? 'winner' : ''} ${isLoser ? 'loser' : ''} ${gradeClass}`}
        onClick={() => handleSelect(team)}
      >
        {team.logo_url ? (
          <img src={team.logo_url} alt={team.name} className="mn-flag" />
        ) : (
          <div className="mn-flag-placeholder" />
        )}
        <div className="mn-name" title={team.name}>{getAbbreviation(team.name)}</div>
        
        <div className={`mn-circle ${isWinner ? 'filled' : 'empty'}`} />
      </div>
    );
  };

  return (
    <div className={`match-node ${isFinal ? 'final-match' : ''}`} id={id}>
      <div className="mn-content">
        {renderTeam(team1)}
        {renderTeam(team2)}
      </div>
    </div>
  );
}