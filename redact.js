/**
 * Turning a player's full name into a number and a surname.
 *
 * These are ten-year-olds, and this repository is public. A jersey number and a
 * surname is everything the dashboard actually needs — it is how a coach refers
 * to a kid anyway — and it is meaningfully less identifying than a full name.
 *
 * Applied at parse time as well as to the data already committed, so re-running
 * the parser cannot quietly un-redact the whole season.
 */

/**
 * Particles that belong to the surname, not to the given names.
 *
 * Without this list "SAM DE VRIES" would become "VRIES", which is simply the
 * wrong name. With it, the twelve three-token names in the 25-26 data come out
 * right in eleven cases; in the twelfth the middle token could be a middle name
 * or half a compound surname, and there is no way to tell from here, so it is
 * dropped — erring towards dropping a given name rather than keeping one.
 *
 * The examples in this file are invented. Illustrating the rule with the names
 * it exists to remove would put them back in a public repository.
 */
const SURNAME_PARTICLES = new Set([
  'da', 'das', 'de', 'del', 'della', 'di', 'do', 'dos', 'du',
  'la', 'le', 'les', 'mac', 'mc', 'san', 'st', 'ste', 'van', 'von', 'ter',
])

/**
 * 'RILEY OKONKWO'       -> 'OKONKWO'
 * 'SAM DE VRIES'        -> 'DE VRIES'
 * 'JAMIE LEE TREMBLAY'  -> 'TREMBLAY'
 *
 * A single-token name is returned untouched: there is no way to know whether it
 * is a given name or a surname, and mangling it would help nobody.
 */
function redactName(name) {
  if (!name || typeof name !== 'string') return name
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name

  // Already a surname. A name whose first token is a particle is a compound
  // surname, not a given name followed by one, so dropping that token would
  // turn DE VRIES into VRIES — the wrong name, and the exact failure the
  // particle list exists to prevent. Without this guard redact-data.js is not
  // idempotent, which it is documented to be: a second run mangled every
  // compound surname in the season.
  if (isParticle(parts[0])) return name

  let rest = parts.slice(1)
  // A second given name, where what follows is clearly the surname.
  while (rest.length > 1 && !isParticle(rest[0])) {
    rest = rest.slice(1)
  }
  return rest.join(' ')
}

function isParticle(token) {
  return SURNAME_PARTICLES.has(token.toLowerCase().replace(/\.$/, ''))
}

/** Every place a player's name appears in a parsed game. */
function redactGame(game) {
  for (const side of ['home', 'visitor']) {
    const team = game[side]
    if (!team) continue
    for (const p of team.roster ?? []) p.name = redactName(p.name)
    for (const g of team.scoring ?? []) {
      g.goalScorer = redactName(g.goalScorer)
      g.assist1 = redactName(g.assist1)
      g.assist2 = redactName(g.assist2)
    }
    for (const p of team.penalties ?? []) p.player = redactName(p.player)
    for (const e of team.goalieEvents ?? []) e.goalie = redactName(e.goalie)
    // Team officials are adults in a named volunteer role, and the coach-family
    // badge matches a player's surname against theirs, so they are left alone.
    // Changing that is a separate decision from protecting the kids.
  }
  if (game.eaglesStarter) game.eaglesStarter = redactName(game.eaglesStarter)
  return game
}

module.exports = { redactName, redactGame, SURNAME_PARTICLES }
