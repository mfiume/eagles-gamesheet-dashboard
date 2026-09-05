# Eagles Gamesheet Dashboard

Toronto Eagles U10 AA, 2025-26. Parses the season's official GTHL gamesheets
into one analytics page, published behind a password.

Part of a three-repo team hub:

| Repo | Role |
| --- | --- |
| [`toronto-eagles-aa`](https://github.com/mfiume/toronto-eagles-aa) | Scrapes the GTHL for standings and schedule |
| **`eagles-gamesheet-dashboard`** | Parses official gamesheets into analytics |
| [`eagles-stats-tracker`](https://github.com/mfiume/eagles-stats-tracker) | Captures, in the stands, what the gamesheet leaves out |

## Player names: surnames only

**No first names are stored in this repository.** These are ten-year-olds and
this repo is public. A jersey number and a surname is everything the dashboard
needs — it is how a coach refers to a kid anyway — and it is meaningfully less
identifying than a full name.

`redact.js` holds the rule and is applied in two places:

- `parse-gamesheets.js` redacts each game the moment it is parsed, so a future
  season cannot quietly re-introduce full names.
- `redact-data.js` did the same to the season already committed. It is
  idempotent, so running it again is harmless.

The rule drops the first token, and then any second given name whose successor
is clearly the surname. A short list of surname particles keeps compound names
intact:

The examples below are invented, for the same reason the data is redacted:

| Full name | Stored as |
| --- | --- |
| `RILEY OKONKWO` | `OKONKWO` |
| `SAM DE VRIES` | `DE VRIES` |
| `JAMIE LEE TREMBLAY` | `TREMBLAY` |

One case in the 25-26 data is genuinely ambiguous — a three-token name whose
middle token could be a middle name or half a compound surname, with no way to
tell from here. It drops the middle token, erring towards dropping a given name
rather than keeping one.

**Team officials and referees are left alone.** They are adults in a named
volunteer role, and the coach-family badge works by matching a player's surname
against theirs. Changing that is a separate decision from protecting the kids.

**Two caveats worth knowing.** Git history still holds the original full names,
and the redaction only changes the current files; purging the history is a
separate job (feasible here, since the repo has no forks). And the seven PDFs
under `pdfs/` were removed and gitignored — they carried full names that the
JSON no longer does, they are regenerated from the data by `export-pdfs.js`, and
nothing linked to them.

## Player identity is a number, not a name

Worth knowing before touching the aggregation: players are keyed by
`team | number | surname`, not by name. Robertson **#8** and **#75** dressed
together in all 37 games — two brothers — and keying by surname alone merged
them into one row with 68 games played in a 37-game season.

The cost is that a player who changed sweater mid-season splits into two rows.
That is the much smaller error, and two other teams' players may be affected by
it in the 25-26 data.

## Running it

```bash
node parse-gamesheets.js <dir-of-gamesheet-html> data/games.json
node serve.js                # http://localhost:8888
```

`dashboard.html` is the real page; it fetches `data/games.json` at runtime.
`serve.js` is a dev server with SPA fallback so the tab URLs work.

## Publishing

`index.html` is `dashboard.html` encrypted with
[StatiCrypt](https://github.com/robinmoisson/staticrypt), using
`password-template.html` as the unlock screen, and GitHub Pages serves it.

**A change to `dashboard.html` does not reach the published site until
`index.html` is rebuilt.** Data changes do — the page fetches `data/games.json`
itself — so it is entirely possible to publish new data against old page code.
That is exactly what happened here: the redacted names take effect immediately,
but the number-keying fix above does not, so the live page will show Robertson
with 68 games played until the encryption is re-run.

Roughly:

```bash
npx staticrypt dashboard.html --template password-template.html -o .
mv dashboard.html.enc index.html   # check what your staticrypt version emits
```

The exact flags differ between StatiCrypt versions and the version used
originally is not recorded here, so check `npx staticrypt --help` and confirm
the output still unlocks before pushing.

## Files

```
redact.js              The name-redaction rule, shared
redact-data.js         One-off: redact the already-committed season
parse-gamesheets.js    Gamesheet HTML -> data/games.json, redacting as it goes
export-pdfs.js         Regenerates the PDF exports (gitignored)
dashboard.html         The page itself
index.html             dashboard.html, StatiCrypt-encrypted — the published one
password-template.html The unlock screen
serve.js               Dev server
data/games.json        37 parsed games
data/goalie_assignments.json  Manual goalie starts
```
