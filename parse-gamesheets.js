#!/usr/bin/env node
/**
 * Parses Eagles gamesheet HTML files into structured JSON.
 * Usage: node parse-gamesheets.js <input-dir> <output-file>
 */

const fs = require('fs');
const path = require('path');

const inputDir = process.argv[2] || '/Users/mfiume/Downloads/Eagles Gamesheets';
const outputFile = process.argv[3] || path.join(__dirname, 'data', 'games.json');

function extractText(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/<!--.*?-->/g, '').trim();
}

function parseRoster(tableHtml) {
  const players = [];
  const inactiveLabel = tableHtml.includes('Inactive Players') || tableHtml.includes('Suspended Players');

  // Split into active and inactive sections
  let activeSection = tableHtml;
  let inactiveSection = '';

  const inactiveIdx = tableHtml.search(/(Inactive|Suspended) Players/i);
  if (inactiveIdx !== -1) {
    activeSection = tableHtml.substring(0, inactiveIdx);
    inactiveSection = tableHtml.substring(inactiveIdx);
  }

  // Parse active players from tbody rows
  const rowRegex = /<tr\b[^>]*>.*?<td class="col1"[^>]*>(.*?)<\/td>.*?<td class="col2"[^>]*>(.*?)<\/td>.*?<td class="col3[^"]*"[^>]*>(.*?)<\/td>.*?<\/tr>/gs;
  let match;
  while ((match = rowRegex.exec(activeSection)) !== null) {
    const number = extractText(match[1]);
    const pos = extractText(match[2]);
    const name = extractText(match[3]);
    if (number && name) {
      players.push({
        number: parseInt(number) || number,
        position: pos === 'G' ? 'G' : '',
        name: name,
        status: 'active'
      });
    }
  }

  // Parse inactive/suspended players
  if (inactiveSection) {
    const inactiveType = inactiveSection.includes('Suspended') ? 'suspended' : 'inactive';
    const inactiveRowRegex = /<tr\b[^>]*>.*?<td\b[^>]*>(\d+)<\/td>.*?<td[^>]*class="dot"[^>]*>(.*?)<\/td>.*?<\/tr>/gs;
    while ((match = inactiveRowRegex.exec(inactiveSection)) !== null) {
      const number = extractText(match[1]);
      const name = extractText(match[2]);
      if (number && name) {
        players.push({
          number: parseInt(number) || number,
          position: '',
          name: name,
          status: inactiveType
        });
      }
    }
  }

  return players;
}

function parseOfficials(tableHtml) {
  const officials = [];
  const rowRegex = /<tr\b[^>]*>.*?<td class="col1"[^>]*>(.*?)<\/td>.*?<td class="col2[^"]*"[^>]*>(.*?)<\/td>.*?<\/tr>/gs;
  let match;
  while ((match = rowRegex.exec(tableHtml)) !== null) {
    const role = extractText(match[1]);
    const name = extractText(match[2]);
    if (role && name) {
      officials.push({ role, name });
    }
  }
  return officials;
}

function parsePenalties(tableHtml) {
  const penalties = [];
  const tbodyMatch = tableHtml.match(/<tbody\b[^>]*>(.*?)<\/tbody>/s);
  if (!tbodyMatch) return penalties;

  const tbody = tbodyMatch[1];
  const rowRegex = /<tr\b[^>]*>(.*?)<\/tr>/gs;
  let match;
  while ((match = rowRegex.exec(tbody)) !== null) {
    const cells = [];
    const cellRegex = /<td[^>]*>(.*?)<\/td>/gs;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(match[1])) !== null) {
      cells.push(extractText(cellMatch[1]));
    }
    if (cells.length >= 10) {
      penalties.push({
        period: parseInt(cells[0]) || cells[0],
        number: parseInt(cells[1]) || cells[1],
        servedBy: parseInt(cells[2]) || cells[2],
        player: cells[3],
        minutes: isNaN(parseInt(cells[4])) ? 0 : parseInt(cells[4]),
        code: cells[5],
        offTime: cells[6],
        startTime: cells[7],
        endTime: cells[8],
        onTime: cells[9]
      });
    }
  }
  return penalties;
}

function parseScoring(tableHtml) {
  const goals = [];
  const tbodyMatch = tableHtml.match(/<tbody\b[^>]*>(.*?)<\/tbody>/s);
  if (!tbodyMatch) return goals;

  const tbody = tbodyMatch[1];
  const rowRegex = /<tr\b[^>]*>(.*?)<\/tr>/gs;
  let match;
  while ((match = rowRegex.exec(tbody)) !== null) {
    const cells = [];
    const cellRegex = /<td[^>]*>(.*?)<\/td>/gs;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(match[1])) !== null) {
      cells.push(extractText(cellMatch[1]));
    }
    if (cells.length >= 9) {
      const goal = {
        period: parseInt(cells[0]) || cells[0],
        time: cells[1],
        goalScorerNumber: parseInt(cells[2]) || cells[2],
        goalScorer: cells[3],
        assist1Number: cells[4] ? (parseInt(cells[4]) || cells[4]) : null,
        assist1: cells[5] || null,
        assist2Number: cells[6] ? (parseInt(cells[6]) || cells[6]) : null,
        assist2: cells[7] || null,
        type: cells[8] || null  // PP, SH, EN, PS, AG, SO
      };
      goals.push(goal);
    }
  }
  return goals;
}

function parseGoalieEvents(tableHtml) {
  const events = [];
  const tbodyMatch = tableHtml.match(/<tbody\b[^>]*>(.*?)<\/tbody>/s);
  if (!tbodyMatch) return events;

  const tbody = tbodyMatch[1];
  const rowRegex = /<tr\b[^>]*>(.*?)<\/tr>/gs;
  let match;
  while ((match = rowRegex.exec(tbody)) !== null) {
    const cells = [];
    const cellRegex = /<td[^>]*>(.*?)<\/td>/gs;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(match[1])) !== null) {
      cells.push(extractText(cellMatch[1]));
    }
    if (cells.length >= 5 && cells[0]) {
      events.push({
        period: parseInt(cells[0]) || cells[0],
        time: cells[1],
        number: parseInt(cells[2]) || cells[2],
        goalie: cells[3],
        type: cells[4]
      });
    }
  }
  return events;
}

function parseGamesheet(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');

  // Extract final score line
  const scoreMatch = html.match(/FINAL SCORE[&nbsp;\s]+(.*?)<\/span>/s);
  let homeTeam = '', visitorTeam = '', homeScore = 0, visitorScore = 0;
  if (scoreMatch) {
    const scoreText = extractText(scoreMatch[1]).replace(/\s+/g, ' ').trim();
    const scoreParseMatch = scoreText.match(/^(.+?)\s+(\d+)\s*:\s*(\d+)\s+(.+)$/);
    if (scoreParseMatch) {
      homeTeam = scoreParseMatch[1].trim();
      homeScore = parseInt(scoreParseMatch[2]);
      visitorScore = parseInt(scoreParseMatch[3]);
      visitorTeam = scoreParseMatch[4].trim();
    }
  }

  // Extract game info from tblInfo
  const infoMatch = html.match(/<table class="tblInfo"[^>]*>(.*?)<\/table>/s);
  let date = '', arena = '', divCat = '', gameType = '';
  let floodBetween = '', lengthOfGame = '', startTime = '', endTime = '';
  let homePlayersP3 = '', visitorPlayersP3 = '', referee = '', linesman = '';

  if (infoMatch) {
    const infoHtml = infoMatch[1];

    const extractField = (label) => {
      const regex = new RegExp(label + ':<\\/span>\\s*<span[^>]*>(.*?)<\\/span>', 's');
      const m = infoHtml.match(regex);
      return m ? extractText(m[1]) : '';
    };

    date = extractField('Date');
    arena = extractField('Arena');
    divCat = extractField('Div/Cat');
    gameType = extractField('Type');
    floodBetween = extractField('Flood between');
    lengthOfGame = extractField('Length of Game');
    startTime = extractField('Started');
    endTime = extractField('Ended');
    referee = extractField('Referee');
    linesman = extractField('Linesman');

    const homeP3Match = infoHtml.match(/#Players of HOME\(Period 3\):<\/span>\s*<span[^>]*>(.*?)<\/span>/s);
    if (homeP3Match) homePlayersP3 = extractText(homeP3Match[1]);
    const visP3Match = infoHtml.match(/#Players of VISITOR\(Period 3\):<\/span>\s*<span[^>]*>(.*?)<\/span>/s);
    if (visP3Match) visitorPlayersP3 = extractText(visP3Match[1]);
  }

  // Find all roster tables (HOME and VISITOR)
  const rosterTables = [];
  const rosterRegex = /<table class="tblRoster[^"]*"[^>]*>(.*?)<\/table>/gs;
  let rosterMatch;
  while ((rosterMatch = rosterRegex.exec(html)) !== null) {
    rosterTables.push(rosterMatch[1]);
  }

  const homeRoster = rosterTables.length > 0 ? parseRoster(rosterTables[0]) : [];
  const visitorRoster = rosterTables.length > 1 ? parseRoster(rosterTables[1]) : [];

  // Find all official tables
  const officialTables = [];
  const officialRegex = /<table class="tblOfficial[^"]*"[^>]*>(.*?)<\/table>/gs;
  let officialMatch;
  while ((officialMatch = officialRegex.exec(html)) !== null) {
    officialTables.push(officialMatch[1]);
  }

  const homeOfficials = officialTables.length > 0 ? parseOfficials(officialTables[0]) : [];
  const visitorOfficials = officialTables.length > 1 ? parseOfficials(officialTables[1]) : [];

  // Penalty tables - HOME first, then VISITOR
  const penaltyTables = [];
  const penaltyRegex = /<table class="tblPenalty[^"]*"[^>]*>(.*?)<\/table>/gs;
  let penaltyMatch;
  while ((penaltyMatch = penaltyRegex.exec(html)) !== null) {
    penaltyTables.push(penaltyMatch[1]);
  }

  const homePenalties = penaltyTables.length > 0 ? parsePenalties(penaltyTables[0]) : [];
  const visitorPenalties = penaltyTables.length > 1 ? parsePenalties(penaltyTables[1]) : [];

  // Scoring tables - HOME first, then VISITOR
  const scoringTables = [];
  const scoringRegex = /<table class="tblScore[^"]*"[^>]*>(.*?)<\/table>/gs;
  let scoringMatch;
  while ((scoringMatch = scoringRegex.exec(html)) !== null) {
    scoringTables.push(scoringMatch[1]);
  }

  const homeScoring = scoringTables.length > 0 ? parseScoring(scoringTables[0]) : [];
  const visitorScoring = scoringTables.length > 1 ? parseScoring(scoringTables[1]) : [];

  // Goalie tables
  const goalieTables = [];
  const goalieRegex = /<table class="tblGoalie[^"]*"[^>]*>(.*?)<\/table>/gs;
  let goalieMatch;
  while ((goalieMatch = goalieRegex.exec(html)) !== null) {
    goalieTables.push(goalieMatch[1]);
  }

  const homeGoalieEvents = goalieTables.length > 0 ? parseGoalieEvents(goalieTables[0]) : [];
  const visitorGoalieEvents = goalieTables.length > 1 ? parseGoalieEvents(goalieTables[1]) : [];

  // Parse the date string into ISO format
  let isoDate = '';
  if (date) {
    const dateMatch = date.match(/(\d{2})-(\w{3})-(\d{4})\s+([\d:]+\s*[APM]*)/i);
    if (dateMatch) {
      const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                        Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
      isoDate = `${dateMatch[3]}-${months[dateMatch[2]] || '01'}-${dateMatch[1]}`;
    }
  }

  return {
    id: path.basename(filePath, '.html'),
    date: date,
    isoDate: isoDate,
    arena: arena,
    division: divCat,
    gameType: gameType,
    floodBetween: floodBetween,
    periodLengths: lengthOfGame,
    startTime: startTime,
    endTime: endTime,
    homePlayersP3: homePlayersP3,
    visitorPlayersP3: visitorPlayersP3,
    referee: referee,
    linesman: linesman,
    homeTeam: homeTeam,
    visitorTeam: visitorTeam,
    homeScore: homeScore,
    visitorScore: visitorScore,
    home: {
      roster: homeRoster,
      officials: homeOfficials,
      penalties: homePenalties,
      scoring: homeScoring,
      goalieEvents: homeGoalieEvents
    },
    visitor: {
      roster: visitorRoster,
      officials: visitorOfficials,
      penalties: visitorPenalties,
      scoring: visitorScoring,
      goalieEvents: visitorGoalieEvents
    }
  };
}

// Main
const files = fs.readdirSync(inputDir)
  .filter(f => f.endsWith('.html'))
  .sort();

console.log(`Parsing ${files.length} gamesheet files...`);

const games = files.map(f => {
  const game = parseGamesheet(path.join(inputDir, f));
  const totalGoals = game.home.scoring.length + game.visitor.scoring.length;
  const totalPens = game.home.penalties.length + game.visitor.penalties.length;
  console.log(`  ${f}: ${game.homeTeam} ${game.homeScore} - ${game.visitorScore} ${game.visitorTeam} (${totalGoals} goals, ${totalPens} penalties)`);
  return game;
});

// Sort by date
games.sort((a, b) => a.isoDate.localeCompare(b.isoDate));

const output = {
  metadata: {
    league: 'GTHL / OHF',
    division: games[0]?.division || 'Under 10 AA',
    season: '2025-2026',
    totalGames: games.length,
    generatedAt: new Date().toISOString()
  },
  games: games
};

fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
console.log(`\nWritten ${games.length} games to ${outputFile}`);

// Print summary stats
const teams = new Set();
games.forEach(g => { teams.add(g.homeTeam); teams.add(g.visitorTeam); });
console.log(`Teams found: ${[...teams].sort().join(', ')}`);
