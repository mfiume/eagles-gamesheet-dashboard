#!/usr/bin/env node
/**
 * Redacts the player names in the committed data files, in place.
 *
 * A one-off for the season already parsed; parse-gamesheets.js redacts as it
 * goes, so a future season never needs this. Idempotent — running it twice does
 * nothing the second time.
 *
 *   node redact-data.js
 */
const fs = require('fs')
const path = require('path')
const { redactName, redactGame } = require('./redact')

const dir = path.join(__dirname, 'data')

const gamesFile = path.join(dir, 'games.json')
const data = JSON.parse(fs.readFileSync(gamesFile, 'utf8'))
data.games.forEach(redactGame)
fs.writeFileSync(gamesFile, JSON.stringify(data, null, 2))
console.log(`Redacted ${data.games.length} games in data/games.json`)

const goaliesFile = path.join(dir, 'goalie_assignments.json')
if (fs.existsSync(goaliesFile)) {
  const goalies = JSON.parse(fs.readFileSync(goaliesFile, 'utf8'))
  for (const [id, name] of Object.entries(goalies.assignments ?? {})) {
    goalies.assignments[id] = redactName(name)
  }
  if (goalies._rules) goalies._rules = redactName_inProse(goalies._rules)
  fs.writeFileSync(goaliesFile, JSON.stringify(goalies, null, 2))
  console.log('Redacted data/goalie_assignments.json')
}

/** The rules note mentions goalies by first name in prose. */
function redactName_inProse(text) {
  return text.replace(/\bBonner\b/g, 'Bonner').replace(/\bHicks\b/g, 'Hicks')
}
