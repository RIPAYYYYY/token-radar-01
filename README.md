# LaunchScope — a token launch radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/RIPAYYYYY/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/RIPAYYYYY/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

LaunchScope finds protocols that record no token yet, ranks them by an implied value — what a token
could be worth if the protocol issued one and the market priced it the way it prices its peers — and
gives each one a concrete farm plan: the actions to take, what they cost and how long they take.

The value model is peer-anchored and calibrated from the snapshot itself, never from a list of
names. For every category, the live-token protocols in DefiLlama's index give a distribution of
market cap per dollar of TVL; a pre-token protocol is valued at its category's median multiple,
shrunk toward the global median when the category has few live peers, with every peer ratio
winsorized at the global 95th percentile so one token whose TVL collapsed after launch cannot price
a whole category. Three factors from the protocol's own record adjust the anchor: seven-day TVL
momentum (clamped), maturity (how long it has run with no token), and chain breadth. The board
covers the house watchlist in full and adds every other launch candidate the same product
exclusions leave standing — the watchlist is the floor, never the ceiling. Protocols whose token
already trades are set aside in their own view, shown at the market's own values; their ratios are
the calibration, not the ranking.

The dashboard is a static page with no network and no dependencies: the ranked board, sortable on
every column, filterable by search, category, chain and watchlist scope, with a detail view per
protocol that recomputes the row's implied value in the open, shows the peer band and the radar
score's parts, and lists the farm plan with its capital, fee estimate and duration.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node.js 22.18 or later, standard library only; nothing is installed. In the grader's container the
snapshot is mounted at `/input/snapshot.json` and the outputs land in `/output`, so plain
`node main.ts` is the whole run. Either way the program writes `board.json` (the ranked board),
`data.js` (the dashboard's data), `dashboard/` and `screenshots/` (copied from this repository) and
`dossier.json` (the judge's summary, written with the vendored make.fun library) into the output
directory, byte for byte the same on every run. Open `out/dashboard/index.html` to read the board.

## Layout

- `main.ts` — the entrypoint: snapshot in, board, data, dashboard, screenshots and dossier out.
- `lib/model.ts` — the model: eligibility, peer calibration, scoring, farm plans, gate self-check.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`, reading the `data.js` beside it.
- `screenshots/` — the board, a protocol's detail view, and a filtered view, taken from the page.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored as the bounty directs.

---

<sub>Entered on [make.fun](https://make.fun/?ref=s70vnsn3&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
