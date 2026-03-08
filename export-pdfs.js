#!/usr/bin/env node
/**
 * Exports Eagles gamesheet dashboard data to PDF reports.
 * Usage: node export-pdfs.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'games.json'), 'utf8'));
const games = data.games;
const outDir = path.join(__dirname, 'pdfs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const EAGLES = 'Toronto Eagles';

// ── Helpers ──

function eaglesResult(g) {
  const isHome = g.homeTeam === EAGLES;
  const ef = isHome ? g.homeScore : g.visitorScore;
  const ea = isHome ? g.visitorScore : g.homeScore;
  return { goalsFor: ef, goalsAgainst: ea, result: ef > ea ? 'W' : ef < ea ? 'L' : 'T', location: isHome ? 'Home' : 'Away', opponent: isHome ? g.visitorTeam : g.homeTeam };
}

function computePlayerStats(games) {
  const stats = {};
  games.forEach(g => {
    [{ side: g.home, team: g.homeTeam }, { side: g.visitor, team: g.visitorTeam }].forEach(({ side, team }) => {
      side.roster.forEach(p => {
        if (p.status !== 'active') return;
        const key = `${p.name}__${team}`;
        if (!stats[key]) stats[key] = { name: p.name, team, number: p.number, position: p.position || 'S', gp: 0, g: 0, a: 0, pts: 0, pim: 0 };
        stats[key].gp++;
        if (!stats[key].position || stats[key].position === '') stats[key].position = p.position || 'S';
      });
      side.scoring.forEach(goal => {
        const gKey = `${goal.goalScorer}__${team}`;
        if (stats[gKey]) { stats[gKey].g++; stats[gKey].pts++; }
        if (goal.assist1) { const aKey = `${goal.assist1}__${team}`; if (stats[aKey]) { stats[aKey].a++; stats[aKey].pts++; } }
        if (goal.assist2) { const aKey = `${goal.assist2}__${team}`; if (stats[aKey]) { stats[aKey].a++; stats[aKey].pts++; } }
      });
      side.penalties.forEach(pen => {
        const pKey = `${pen.player}__${team}`;
        if (stats[pKey]) stats[pKey].pim += (typeof pen.minutes === 'number' ? pen.minutes : parseInt(pen.minutes) || 0);
      });
    });
  });
  return Object.values(stats).map(p => ({ ...p, ppg: p.gp > 0 ? +(p.pts / p.gp).toFixed(2) : 0 }));
}

function computeStandings(games) {
  const teams = {};
  games.forEach(g => {
    [g.homeTeam, g.visitorTeam].forEach(t => {
      if (!teams[t]) teams[t] = { team: t, gp: 0, w: 0, l: 0, t: 0, pts: 0, gf: 0, ga: 0 };
    });
    const h = teams[g.homeTeam], v = teams[g.visitorTeam];
    h.gp++; v.gp++;
    h.gf += g.homeScore; h.ga += g.visitorScore;
    v.gf += g.visitorScore; v.ga += g.homeScore;
    if (g.homeScore > g.visitorScore) { h.w++; h.pts += 2; v.l++; }
    else if (g.visitorScore > g.homeScore) { v.w++; v.pts += 2; h.l++; }
    else { h.t++; v.t++; h.pts++; v.pts++; }
  });
  return Object.values(teams).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga));
}

const penaltyCodes = {
  'TR': 'Tripping', 'RO': 'Roughing', 'HKG': 'Hooking', 'SL': 'Slashing',
  'CC': 'Cross-Checking', 'BC': 'Body Checking', 'INT': 'Interference',
  'HC': 'Head Contact', 'HE': 'Holding', 'TO': 'Too Many Men',
  'CH': 'Charging', 'HI': 'High Sticking', 'KN': 'Kneeing',
  'EL': 'Elbowing', 'DG': 'Delay of Game', 'UN': 'Unsportsmanlike',
  'BU': 'Butt-Ending', 'CL': 'Clipping'
};

// ── Shared Styles ──

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; background: #fff; padding: 40px; font-size: 11px; }
  h1 { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
  h2 { font-size: 16px; font-weight: 600; color: #1e293b; margin: 24px 0 10px; border-bottom: 2px solid #2563eb; padding-bottom: 4px; }
  h3 { font-size: 13px; font-weight: 600; color: #334155; margin: 16px 0 6px; }
  .subtitle { font-size: 12px; color: #64748b; margin-bottom: 20px; }
  .logo-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
  .logo-header .eagle-icon { font-size: 28px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 10.5px; }
  th, td { padding: 5px 8px; text-align: left; border-bottom: 1px solid #e2e8f0; }
  th { background: #f1f5f9; font-weight: 600; color: #334155; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  tr:nth-child(even) { background: #f8fafc; }
  .eagles-row { background: #eff6ff !important; }
  .eagles-row td:first-child { border-left: 3px solid #2563eb; }
  .stat-cards { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
  .stat-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 20px; min-width: 120px; text-align: center; }
  .stat-card .value { font-size: 24px; font-weight: 700; color: #0f172a; }
  .stat-card .label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
  .win { color: #16a34a; font-weight: 600; }
  .loss { color: #dc2626; font-weight: 600; }
  .tie { color: #d97706; font-weight: 600; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: 600; }
  .badge-blue { background: #dbeafe; color: #1d4ed8; }
  .badge-green { background: #dcfce7; color: #15803d; }
  .badge-red { background: #fee2e2; color: #b91c1c; }
  .badge-gray { background: #f1f5f9; color: #475569; }
  .page-break { page-break-before: always; }
  .two-col { display: flex; gap: 24px; }
  .two-col > div { flex: 1; }
  .right { text-align: right; }
  .center { text-align: center; }
  .small { font-size: 9px; color: #94a3b8; }
  .gamesheet-header { background: #1e293b; color: white; padding: 12px 16px; border-radius: 6px; margin-bottom: 12px; }
  .gamesheet-header .score { font-size: 20px; font-weight: 700; }
  .gamesheet-header .meta { font-size: 10px; color: #94a3b8; }
  .section-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media print { body { padding: 20px; } .page-break { page-break-before: always; } }
`;

// ── Report Generators ──

function generateSeasonOverview() {
  let w = 0, l = 0, t = 0, gf = 0, ga = 0;
  const gameRows = games.map(g => {
    const r = eaglesResult(g);
    gf += r.goalsFor; ga += r.goalsAgainst;
    if (r.result === 'W') w++; else if (r.result === 'L') l++; else t++;
    const resultClass = r.result === 'W' ? 'win' : r.result === 'L' ? 'loss' : 'tie';
    return `<tr><td>${g.date.split(' ')[0]}</td><td>${r.opponent}</td><td class="center">${r.goalsFor} - ${r.goalsAgainst}</td><td class="center ${resultClass}">${r.result}</td><td class="center">${r.location}</td><td class="center"><span class="badge badge-${g.gameType === 'PO' ? 'blue' : 'gray'}">${g.gameType}</span></td></tr>`;
  }).join('');

  return `
    <div class="logo-header"><span class="eagle-icon">🦅</span><div><h1>Toronto Eagles — Season Overview</h1><div class="subtitle">GTHL Under 10 AA &bull; 2025–2026 Season</div></div></div>
    <div class="stat-cards">
      <div class="stat-card"><div class="value">${w}-${l}-${t}</div><div class="label">Record</div></div>
      <div class="stat-card"><div class="value">${gf}</div><div class="label">Goals For</div></div>
      <div class="stat-card"><div class="value">${ga}</div><div class="label">Goals Against</div></div>
      <div class="stat-card"><div class="value">${gf - ga > 0 ? '+' : ''}${gf - ga}</div><div class="label">Goal Diff</div></div>
      <div class="stat-card"><div class="value">${(gf / games.length).toFixed(1)}</div><div class="label">GF/Game</div></div>
      <div class="stat-card"><div class="value">${(ga / games.length).toFixed(1)}</div><div class="label">GA/Game</div></div>
    </div>
    <h2>Game Log</h2>
    <table><thead><tr><th>Date</th><th>Opponent</th><th class="center">Score</th><th class="center">Result</th><th class="center">Loc</th><th class="center">Type</th></tr></thead><tbody>${gameRows}</tbody></table>
  `;
}

function generateGamesheets() {
  return games.map((g, i) => {
    const r = eaglesResult(g);
    const resultClass = r.result === 'W' ? 'win' : r.result === 'L' ? 'loss' : 'tie';

    const rosterTable = (roster, officials, label) => {
      const players = roster.filter(p => p.status === 'active').map(p =>
        `<tr><td class="center">${p.number}</td><td class="center">${p.position || '-'}</td><td>${p.name}</td></tr>`
      ).join('');
      const inactive = roster.filter(p => p.status !== 'active').map(p =>
        `<tr><td class="center small">${p.number}</td><td class="center small">-</td><td class="small">${p.name} (${p.status})</td></tr>`
      ).join('');
      const staff = officials.map(o => `<tr><td class="center">${o.role}</td><td colspan="2">${o.name}</td></tr>`).join('');
      return `<div><h3>${label} Roster</h3><table><thead><tr><th class="center">#</th><th class="center">Pos</th><th>Name</th></tr></thead><tbody>${players}${inactive}</tbody></table>${staff ? `<table><thead><tr><th>Role</th><th colspan="2">Name</th></tr></thead><tbody>${staff}</tbody></table>` : ''}</div>`;
    };

    const scoringTable = (scoring, label) => {
      if (!scoring.length) return `<div><h3>${label} Scoring</h3><p class="small">No goals</p></div>`;
      const rows = scoring.map(s =>
        `<tr><td class="center">${s.period}</td><td class="center">${s.time}</td><td>${s.goalScorer} (#${s.goalScorerNumber})</td><td>${s.assist1 || '-'}</td><td>${s.assist2 || '-'}</td><td class="center">${s.type || ''}</td></tr>`
      ).join('');
      return `<div><h3>${label} Scoring</h3><table><thead><tr><th class="center">Per</th><th class="center">Time</th><th>Goal</th><th>A1</th><th>A2</th><th class="center">Type</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    };

    const penaltyTable = (penalties, label) => {
      if (!penalties.length) return `<div><h3>${label} Penalties</h3><p class="small">No penalties</p></div>`;
      const rows = penalties.map(p =>
        `<tr><td class="center">${p.period}</td><td>${p.player} (#${p.number})</td><td class="center">${p.minutes}</td><td class="center">${p.code}</td><td class="center">${p.offTime}</td></tr>`
      ).join('');
      return `<div><h3>${label} Penalties</h3><table><thead><tr><th class="center">Per</th><th>Player</th><th class="center">Min</th><th class="center">Code</th><th class="center">Time</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    };

    return `
      ${i > 0 ? '<div class="page-break"></div>' : ''}
      <div class="gamesheet-header">
        <div class="score">${g.homeTeam} ${g.homeScore} — ${g.visitorScore} ${g.visitorTeam}</div>
        <div class="meta">${g.date} &bull; ${g.arena} &bull; ${g.division} &bull; ${g.gameType === 'PO' ? 'Playoff' : 'League'} &bull; Ref: ${g.referee || 'N/A'}</div>
      </div>
      <div class="section-grid">
        ${rosterTable(g.home.roster, g.home.officials, g.homeTeam)}
        ${rosterTable(g.visitor.roster, g.visitor.officials, g.visitorTeam)}
      </div>
      <div class="section-grid">
        ${scoringTable(g.home.scoring, g.homeTeam)}
        ${scoringTable(g.visitor.scoring, g.visitorTeam)}
      </div>
      <div class="section-grid">
        ${penaltyTable(g.home.penalties, g.homeTeam)}
        ${penaltyTable(g.visitor.penalties, g.visitorTeam)}
      </div>
    `;
  }).join('');
}

function generateRosters() {
  const teamData = {};
  games.forEach(g => {
    [{ side: g.home, team: g.homeTeam }, { side: g.visitor, team: g.visitorTeam }].forEach(({ side, team }) => {
      if (!teamData[team]) teamData[team] = { players: {}, officials: {} };
      side.roster.forEach(p => {
        if (p.status !== 'active') return;
        const key = p.name;
        if (!teamData[team].players[key]) teamData[team].players[key] = { ...p, gp: 0 };
        teamData[team].players[key].gp++;
      });
      side.officials.forEach(o => {
        teamData[team].officials[`${o.role}_${o.name}`] = o;
      });
    });
  });

  const sortedTeams = Object.keys(teamData).sort();
  // Put Eagles first
  const eaglesIdx = sortedTeams.indexOf(EAGLES);
  if (eaglesIdx > -1) { sortedTeams.splice(eaglesIdx, 1); sortedTeams.unshift(EAGLES); }

  return sortedTeams.map((team, i) => {
    const td = teamData[team];
    const players = Object.values(td.players).sort((a, b) => a.number - b.number);
    const officials = Object.values(td.officials);
    const isEagles = team === EAGLES;

    const playerRows = players.map(p =>
      `<tr${isEagles ? ' class="eagles-row"' : ''}><td class="center">${p.number}</td><td class="center">${p.position || 'S'}</td><td>${p.name}</td><td class="center">${p.gp}</td></tr>`
    ).join('');
    const officialRows = officials.map(o =>
      `<tr><td>${o.role === 'CO' ? 'Head Coach' : o.role === 'AC' ? 'Asst. Coach' : o.role === 'TR' ? 'Trainer' : o.role === 'MG' ? 'Manager' : o.role}</td><td>${o.name}</td></tr>`
    ).join('');

    return `
      ${i > 0 && i % 3 === 0 ? '<div class="page-break"></div>' : ''}
      <h2>${team}</h2>
      <div class="two-col">
        <div><table><thead><tr><th class="center">#</th><th class="center">Pos</th><th>Name</th><th class="center">GP</th></tr></thead><tbody>${playerRows}</tbody></table></div>
        <div><h3>Coaching Staff</h3><table><thead><tr><th>Role</th><th>Name</th></tr></thead><tbody>${officialRows}</tbody></table></div>
      </div>
    `;
  }).join('');
}

function generatePlayerStatsHTML(filterFn, title, subtitle) {
  const allStats = computePlayerStats(games);
  const filtered = allStats.filter(filterFn).sort((a, b) => b.pts - a.pts || b.g - a.g || b.a - a.a);

  const rows = filtered.map(p => {
    const isEagles = p.team === EAGLES;
    return `<tr${isEagles ? ' class="eagles-row"' : ''}><td>${p.name}</td><td>${p.team}</td><td class="center">${p.number}</td><td class="center">${p.position}</td><td class="center">${p.gp}</td><td class="center">${p.g}</td><td class="center">${p.a}</td><td class="center"><strong>${p.pts}</strong></td><td class="center">${p.ppg.toFixed(2)}</td><td class="center">${p.pim}</td></tr>`;
  }).join('');

  return `
    <div class="logo-header"><span class="eagle-icon">🦅</span><div><h1>${title}</h1><div class="subtitle">${subtitle}</div></div></div>
    <table><thead><tr><th>Player</th><th>Team</th><th class="center">#</th><th class="center">Pos</th><th class="center">GP</th><th class="center">G</th><th class="center">A</th><th class="center">PTS</th><th class="center">PPG</th><th class="center">PIM</th></tr></thead><tbody>${rows}</tbody></table>
  `;
}

function generateScoutingReport() {
  const allStats = computePlayerStats(games);
  const teams = [...new Set(games.flatMap(g => [g.homeTeam, g.visitorTeam]))].filter(t => t !== EAGLES).sort();

  // Head-to-head records
  const h2h = {};
  games.forEach(g => {
    const r = eaglesResult(g);
    if (!h2h[r.opponent]) h2h[r.opponent] = { w: 0, l: 0, t: 0 };
    if (r.result === 'W') h2h[r.opponent].w++;
    else if (r.result === 'L') h2h[r.opponent].l++;
    else h2h[r.opponent].t++;
  });

  return teams.map((team, i) => {
    const teamPlayers = allStats.filter(p => p.team === team);
    const goalies = teamPlayers.filter(p => p.position === 'G');
    const skaters = teamPlayers.filter(p => p.position !== 'G').sort((a, b) => b.pts - a.pts);
    const top5 = skaters.slice(0, 5);
    const rec = h2h[team] || { w: 0, l: 0, t: 0 };

    const goalieRows = goalies.map(g => `<tr><td>${g.name}</td><td class="center">${g.number}</td><td class="center">${g.gp}</td></tr>`).join('') || '<tr><td colspan="3" class="small">No goalie data</td></tr>';
    const skaterRows = top5.map(p =>
      `<tr><td>${p.name}</td><td class="center">${p.number}</td><td class="center">${p.gp}</td><td class="center">${p.g}</td><td class="center">${p.a}</td><td class="center"><strong>${p.pts}</strong></td><td class="center">${p.ppg.toFixed(2)}</td><td class="center">${p.pim}</td></tr>`
    ).join('');

    return `
      ${i > 0 && i % 3 === 0 ? '<div class="page-break"></div>' : ''}
      <h2>${team}</h2>
      <p class="small" style="margin-bottom:8px">Record vs Eagles: <span class="win">${rec.w}W</span> - <span class="loss">${rec.l}L</span> - <span class="tie">${rec.t}T</span></p>
      <div class="two-col">
        <div><h3>Goalies</h3><table><thead><tr><th>Name</th><th class="center">#</th><th class="center">GP</th></tr></thead><tbody>${goalieRows}</tbody></table></div>
        <div><h3>Top Skaters</h3><table><thead><tr><th>Name</th><th class="center">#</th><th class="center">GP</th><th class="center">G</th><th class="center">A</th><th class="center">PTS</th><th class="center">PPG</th><th class="center">PIM</th></tr></thead><tbody>${skaterRows}</tbody></table></div>
      </div>
    `;
  }).join('');
}

function generateAdvancedAnalytics() {
  const standings = computeStandings(games);
  const standingsRows = standings.map(t => {
    const isEagles = t.team === EAGLES;
    return `<tr${isEagles ? ' class="eagles-row"' : ''}><td>${t.team}</td><td class="center">${t.gp}</td><td class="center">${t.w}</td><td class="center">${t.l}</td><td class="center">${t.t}</td><td class="center"><strong>${t.pts}</strong></td><td class="center">${t.gf}</td><td class="center">${t.ga}</td><td class="center">${t.gf - t.ga > 0 ? '+' : ''}${t.gf - t.ga}</td></tr>`;
  }).join('');

  // Penalty code breakdown (Eagles)
  const penCodes = {};
  games.forEach(g => {
    const isHome = g.homeTeam === EAGLES;
    const pens = isHome ? g.home.penalties : g.visitor.penalties;
    pens.forEach(p => {
      penCodes[p.code] = (penCodes[p.code] || 0) + 1;
    });
  });
  const penCodeRows = Object.entries(penCodes).sort((a, b) => b[1] - a[1]).map(([code, count]) =>
    `<tr><td>${code}</td><td>${penaltyCodes[code] || code}</td><td class="center">${count}</td></tr>`
  ).join('');

  // Scoring by period (Eagles)
  const byPeriod = { 1: { f: 0, a: 0 }, 2: { f: 0, a: 0 }, 3: { f: 0, a: 0 } };
  games.forEach(g => {
    const isHome = g.homeTeam === EAGLES;
    const eaglesScoring = isHome ? g.home.scoring : g.visitor.scoring;
    const oppScoring = isHome ? g.visitor.scoring : g.home.scoring;
    eaglesScoring.forEach(s => { if (byPeriod[s.period]) byPeriod[s.period].f++; });
    oppScoring.forEach(s => { if (byPeriod[s.period]) byPeriod[s.period].a++; });
  });

  // Special teams goals
  let ppGoals = 0, shGoals = 0, ppGoalsAgainst = 0, shGoalsAgainst = 0;
  games.forEach(g => {
    const isHome = g.homeTeam === EAGLES;
    const es = isHome ? g.home.scoring : g.visitor.scoring;
    const os = isHome ? g.visitor.scoring : g.home.scoring;
    es.forEach(s => { if (s.type === 'PP') ppGoals++; if (s.type === 'SH') shGoals++; });
    os.forEach(s => { if (s.type === 'PP') ppGoalsAgainst++; if (s.type === 'SH') shGoalsAgainst++; });
  });

  // Head-to-head
  const h2h = {};
  games.forEach(g => {
    const r = eaglesResult(g);
    if (!h2h[r.opponent]) h2h[r.opponent] = { w: 0, l: 0, t: 0, gf: 0, ga: 0 };
    h2h[r.opponent].w += r.result === 'W' ? 1 : 0;
    h2h[r.opponent].l += r.result === 'L' ? 1 : 0;
    h2h[r.opponent].t += r.result === 'T' ? 1 : 0;
    h2h[r.opponent].gf += r.goalsFor;
    h2h[r.opponent].ga += r.goalsAgainst;
  });
  const h2hRows = Object.entries(h2h).sort((a, b) => a[0].localeCompare(b[0])).map(([team, rec]) =>
    `<tr><td>${team}</td><td class="center">${rec.w + rec.l + rec.t}</td><td class="center win">${rec.w}</td><td class="center loss">${rec.l}</td><td class="center tie">${rec.t}</td><td class="center">${rec.gf}</td><td class="center">${rec.ga}</td><td class="center">${rec.gf - rec.ga > 0 ? '+' : ''}${rec.gf - rec.ga}</td></tr>`
  ).join('');

  // Most penalized players league-wide
  const allStats = computePlayerStats(games);
  const topPIM = allStats.filter(p => p.pim > 0).sort((a, b) => b.pim - a.pim).slice(0, 15);
  const pimRows = topPIM.map(p => {
    const isEagles = p.team === EAGLES;
    return `<tr${isEagles ? ' class="eagles-row"' : ''}><td>${p.name}</td><td>${p.team}</td><td class="center">${p.gp}</td><td class="center"><strong>${p.pim}</strong></td><td class="center">${(p.pim / p.gp).toFixed(1)}</td></tr>`;
  }).join('');

  return `
    <div class="logo-header"><span class="eagle-icon">🦅</span><div><h1>Advanced Analytics</h1><div class="subtitle">GTHL Under 10 AA &bull; 2025–2026 Season</div></div></div>

    <h2>League Standings</h2>
    <table><thead><tr><th>Team</th><th class="center">GP</th><th class="center">W</th><th class="center">L</th><th class="center">T</th><th class="center">PTS</th><th class="center">GF</th><th class="center">GA</th><th class="center">DIFF</th></tr></thead><tbody>${standingsRows}</tbody></table>

    <h2>Eagles Scoring by Period</h2>
    <table><thead><tr><th>Period</th><th class="center">Goals For</th><th class="center">Goals Against</th><th class="center">Differential</th></tr></thead><tbody>
      <tr><td>1st Period</td><td class="center">${byPeriod[1].f}</td><td class="center">${byPeriod[1].a}</td><td class="center">${byPeriod[1].f - byPeriod[1].a > 0 ? '+' : ''}${byPeriod[1].f - byPeriod[1].a}</td></tr>
      <tr><td>2nd Period</td><td class="center">${byPeriod[2].f}</td><td class="center">${byPeriod[2].a}</td><td class="center">${byPeriod[2].f - byPeriod[2].a > 0 ? '+' : ''}${byPeriod[2].f - byPeriod[2].a}</td></tr>
      <tr><td>3rd Period</td><td class="center">${byPeriod[3].f}</td><td class="center">${byPeriod[3].a}</td><td class="center">${byPeriod[3].f - byPeriod[3].a > 0 ? '+' : ''}${byPeriod[3].f - byPeriod[3].a}</td></tr>
    </tbody></table>

    <h2>Special Teams</h2>
    <div class="stat-cards">
      <div class="stat-card"><div class="value">${ppGoals}</div><div class="label">PP Goals For</div></div>
      <div class="stat-card"><div class="value">${shGoals}</div><div class="label">SH Goals For</div></div>
      <div class="stat-card"><div class="value">${ppGoalsAgainst}</div><div class="label">PP Goals Against</div></div>
      <div class="stat-card"><div class="value">${shGoalsAgainst}</div><div class="label">SH Goals Against</div></div>
    </div>

    <div class="page-break"></div>
    <h2>Eagles Penalty Breakdown</h2>
    <table><thead><tr><th>Code</th><th>Infraction</th><th class="center">Count</th></tr></thead><tbody>${penCodeRows}</tbody></table>

    <h2>League Penalty Leaders (Top 15)</h2>
    <table><thead><tr><th>Player</th><th>Team</th><th class="center">GP</th><th class="center">PIM</th><th class="center">PIM/GP</th></tr></thead><tbody>${pimRows}</tbody></table>

    <div class="page-break"></div>
    <h2>Head-to-Head Records</h2>
    <table><thead><tr><th>Opponent</th><th class="center">GP</th><th class="center">W</th><th class="center">L</th><th class="center">T</th><th class="center">GF</th><th class="center">GA</th><th class="center">DIFF</th></tr></thead><tbody>${h2hRows}</tbody></table>
  `;
}

// ── PDF Generation ──

async function generatePDF(htmlContent, filename, landscape = false) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${CSS}</style></head><body>${htmlContent}</body></html>`;
  await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
  const outPath = path.join(outDir, filename);
  await page.pdf({
    path: outPath,
    format: 'Letter',
    landscape,
    margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
    printBackground: true,
  });
  await browser.close();
  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log(`  ✓ ${filename} (${sizeMB} MB)`);
}

async function main() {
  console.log('Generating PDFs...\n');

  await generatePDF(generateSeasonOverview(), '1-season-overview.pdf');
  await generatePDF(generateGamesheets(), '2-gamesheets.pdf');
  await generatePDF(generateRosters(), '3-rosters.pdf');
  await generatePDF(
    generatePlayerStatsHTML(() => true, 'Player Statistics — All Players', 'GTHL Under 10 AA • 2025–2026 Season • All Teams'),
    '4-player-stats-all.pdf', true
  );
  await generatePDF(
    generatePlayerStatsHTML(p => p.team !== EAGLES, 'Player Statistics — Non Eagles', 'GTHL Under 10 AA • 2025–2026 Season • Opposing Players Only'),
    '5-player-stats-non-eagles.pdf', true
  );
  await generatePDF(generateScoutingReport(), '6-scouting-report.pdf');
  await generatePDF(generateAdvancedAnalytics(), '7-advanced-analytics.pdf');

  console.log(`\nAll PDFs saved to: ${outDir}/`);
}

main().catch(err => { console.error(err); process.exit(1); });
