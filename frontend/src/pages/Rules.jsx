import React from 'react';
import { useLeague } from '../context/LeagueContext';
import { ShieldAlert, Users, Clock, Trophy, ListOrdered, Phone, Activity } from 'lucide-react';

// Reusable UI block to make the rules look like nicely formatted markdown sections
const RuleSection = ({ title, icon: Icon, items, colorClass }) => (
  <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8 backdrop-blur-sm hover:bg-white/[0.07] transition-colors">
    <div className="flex items-center gap-3 mb-6 border-b border-white/10 pb-4">
      <div className={`p-2 rounded-lg bg-black/50 ${colorClass}`}>
        <Icon size={24} />
      </div>
      <h2 className="text-xl font-black uppercase tracking-widest text-white">{title}</h2>
    </div>
    <ul className="space-y-4">
      {items.map((item, index) => {
        // Automatically bold the first part of the rule before the colon (Markdown style)
        const [boldPart, ...rest] = item.split(':');
        return (
          <li key={index} className="flex gap-3 text-sm sm:text-base text-zinc-300 leading-relaxed">
            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${colorClass.replace('text-', 'bg-')}`} />
            <div>
              {rest.length > 0 ? (
                <>
                  <span className="font-bold text-white">{boldPart}:</span>
                  {rest.join(':')}
                </>
              ) : (
                item
              )}
            </div>
          </li>
        );
      })}
    </ul>
  </div>
);

export function Rules() {
  const { division, seasonScope } = useLeague();
  // A season's own rules (set by a dictator) replace the standing text below; the rules builder is SL-044.
  const seasonRules = seasonScope.season?.rules_md?.trim() || '';

  // --- WOMEN'S LEAGUE RULES DATA ---
  const womensRules = [
    {
      title: "Team & Match Format",
      icon: Users,
      items: [
        "Format: 5-a-side (4 outfield players + 1 goalkeeper on the pitch).",
        "Substitutions (No Return Subs): Rolling substitutions are not permitted. Once a player is substituted off the pitch, they may not re-enter the match under any circumstances.",
        "Match Duration: Matches will be played in two equal halves with a brief half-time interval.",
        "Tie-Breakers: If a knockout match ends in a draw at the end of regular time, the winner will be decided by a penalty shootout (3 penalties per team, followed by sudden death if necessary)."
      ]
    },
    {
      title: "Disciplinary Rules",
      icon: ShieldAlert,
      items: [
        "Yellow Cards: A standard warning for reckless fouls or unsporting behavior. Two yellow cards in a single match equate to a red card.",
        "Red Cards (Special Rule): If a player receives a red card, they are sent off for the remainder of the match and cannot return.",
        "Penalty Duration: The offending team must play one player short for a penalty duration of exactly 1 minute.",
        "Substitution After Red: Once the 1-minute penalty expires, the team may bring on a substitute to replace the red-carded player, bringing the team back to a full 5 players on the pitch.",
        "Condition: This is only permitted if the team has not exhausted their substitution limit for the match. If all subs have been used, the team must play the rest of the match a player down."
      ]
    },
    {
      title: "Standard In-Game Rules",
      icon: Activity,
      items: [
        "Kick-ins: When the ball goes out of play over the touchlines, play is restarted with a kick-in. Throw-ins are not permitted. The ball must be stationary on the touchline before being kicked.",
        "Goalkeeper Rules: Goalkeepers must distribute the ball by throwing or rolling it out from their hands. Punting or drop-kicking the ball is not allowed.",
        "Pass-backs: The goalkeeper cannot pick up the ball with their hands if it is intentionally passed back to them by a teammate's foot.",
        "Fouls & Free Kicks: All fouls will result in a direct or indirect free kick. Opposing players must stand a minimum of 3 meters away from the ball. Slide tackling is strictly prohibited to prevent injuries."
      ]
    }
  ];

  // --- MEN'S LEAGUE RULES DATA ---
  const mensRules = [
    {
      title: "League Format & Objective",
      icon: Trophy,
      items: [
        "The Teams: The league consists of exactly six clubs competing head-to-head. This includes the two pre-qualified inaugural clubs, MILF and HRZ, and the four clubs that advanced from the Qualifiers.",
        "The Champion: The League leader is the Super League champion."
      ]
    },
    {
      title: "Rosters & Player Eligibility",
      icon: Users,
      items: [
        "Squad Limits: A club can have no more than 13 players. Club formation is open for all students, regardless of house, year, or batch barriers.",
        "Roster Lock: The qualifiers are officially done. Any player who was eliminated during the qualifiers cannot be recruited or play for any of the final six league clubs.",
        "Registration: No spot registrations will be permitted. Playing unregistered players is strictly prohibited."
      ]
    },
    {
      title: "Match Regulations",
      icon: Clock,
      items: [
        "Match Duration: Matches will be played with 20-minute halves.",
        "Substitutions: Teams are strictly limited to 3 substitutions per match.",
        "Punctuality: Participants must arrive at the venue as per the scheduled timings."
      ]
    },
    {
      title: "Points System & Standings",
      icon: ListOrdered,
      items: [
        "Win: 3 Points",
        "Draw: 1 Point (each team)",
        "Loss: 0 Points",
        "Tie-Breakers: If tied on points at the end of the season, ranking order is determined by Total Points, then Goal Difference, then Goals Scored, then Head-to-Head Record."
      ]
    },
    {
      title: "Disciplinary & Future Editions",
      icon: ShieldAlert,
      items: [
        "Violations: Failure to follow rules and regulations will result in disqualification without any further opportunities.",
        "Qualification for Next Season: Top clubs directly qualify for the next edition of the Super League. To retain automatic qualification, clubs must retain a minimum of 7 players."
      ]
    },
    {
      title: "Contact Information",
      icon: Phone,
      items: [
        "Adwaith ES: 9526386860",
        "Kevin Mathew: 9072972350"
      ]
    }
  ];

  const isWomens = division === 'wsl';
  const activeRules = isWomens ? womensRules : mensRules;
  const themeColor = isWomens ? 'text-pink-400' : 'text-[#E8C881]';
  const gradientClass = isWomens ? 'from-pink-400 to-purple-500' : 'from-[#E8C881] to-yellow-600';

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20 px-2 sm:px-4">
      
      {/* Header Section */}
      <div className="text-center space-y-4 mb-12 border-b border-white/10 pb-10">
        <h1 className={`text-4xl sm:text-5xl md:text-6xl font-black tracking-tighter uppercase text-transparent bg-clip-text bg-gradient-to-r ${gradientClass}`}>
          {isWomens ? "WSL Official Rules" : "Super League Rules"}
        </h1>
        <p className="text-zinc-400 max-w-2xl mx-auto text-sm sm:text-base leading-relaxed">
          {isWomens 
            ? "Welcome to the WSL! To ensure a fair, competitive, and enjoyable tournament for all teams, please review the official match rules below."
            : "The Super League is designed to improve the quality and intensity of the existing 9v9 tournament by creating a format for top players to compete on a regular basis. With the qualifiers officially concluded, the following regulations govern the League phase."
          }
        </p>
        {seasonRules && (
          <p className="text-xs font-black uppercase tracking-widest text-zinc-500">{seasonScope.season.name} season rules</p>
        )}
      </div>

      {/* Rules Grid */}
      <div className="space-y-6">
        {seasonRules && (
          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-6 sm:p-8 text-sm leading-relaxed text-zinc-300 whitespace-pre-line">
            {seasonRules}
          </div>
        )}
        {!seasonRules && activeRules.map((section, idx) => (
          <RuleSection 
            key={idx} 
            title={section.title} 
            icon={section.icon} 
            items={section.items} 
            colorClass={themeColor}
          />
        ))}
      </div>

    </div>
  );
}