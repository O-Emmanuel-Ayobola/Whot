# Phase A — Gameplay Core

This pass wires the previously server-side gameplay systems into the table UI and hardens several edge cases.

## Included

- Two hidden bounties per player per round, randomly assigned server-side.
- Bounty completion now awards a random perk.
- Perk tray for Shield, Peek and Swap.
- Peek reveals the next three cards privately in the player's table UI.
- Swap lets the player choose an opponent before the server performs the swap.
- Real Last Card declaration and Catch mechanic.
- Missed Last Card declaration costs two cards when the player reaches their next turn.
- Last Card catches cost two cards immediately.
- Public table event log with private bounty identities filtered out.
- Secret bounty completion remains a generic global event.
- Correct Pick Two highlighting when stacking is disabled.
- Recycled discard cards are shuffled before returning to the draw pile.
- Large draw penalties resolve gracefully when the available market is exhausted.
- General Market no longer crashes when the deck is exhausted.
- Double Trouble progress is attributed to the player who initiated the penalty.

## Not included yet

- The visual-system redesign pass.
- Public/private room visibility.
- Transactional production storage migration.
- Recorded Nigerian voice pack.
