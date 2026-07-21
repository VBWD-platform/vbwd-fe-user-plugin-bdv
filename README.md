# vbwd-fe-user-plugin-bdv

The **player-facing** surface of [BizDevVibes](https://github.com/VBWD-platform/vbwd-plugin-bdv) —
a dice-market board game where the sum of two dice is always free, buying a
single die is priced from the game state, and the fee goes to your opponents.

## What it adds

- One **burger-menu item** (`userNavRegistry`) → `/dashboard/bdv`
- A **lobby**: pick a published board and a seat count, start a match
- A **match page split 70 % board / 30 % game chat**

## Playing by clicking

Every decision is made by clicking. The priced option set is overlaid on the
board *and* rendered as cards, and **both dispatch the same store action** — so
the two surfaces cannot drift.

Unaffordable options stay **visible with their price** and the reason they are
locked. Seeing what you cannot afford is the mechanic, not an error state.

## Two client-side rules

1. **Prices are never computed here.** They come from the server quote
   (`GET /bdv/matches/:id/options`) and are recomputed server-side on accept.
2. **Every mutating call carries `state_seq`.** A `409` means somebody moved
   first, so the store resyncs silently instead of showing an error.

## Reads

Board state polls `GET /bdv/matches/:id` while it is *not* your turn, and pauses
when the tab is hidden. Deliberately **not** SSE: a turn-based game does not need
a long-lived stream, and SSE behind the proxy has caused two prod incidents on
this platform (buffering, and worker starvation).

## Structure

```
index.ts                       plugin entry (NAMED export `bdvPlugin`)
src/views/BdvLobby.vue         my matches + new match
src/views/BdvMatch.vue         the 70/30 split
src/components/
  BdvBoardCanvas.vue           board rendered FROM the spec snapshot
  BdvOptionCards.vue           priced option cards
src/stores/bdvMatch.ts         the single mutating path
```

`BdvBoardCanvas` renders whatever the match's spec snapshot contains — a board
with different squares needs no code change here.

## Tests

```bash
npx vitest run plugins/bdv/
```

## Licence

BSL 1.1 — see [`LICENSE`](LICENSE).
