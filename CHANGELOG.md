# Changelog

## [26.7.0] — 2026-07-21

Initial release.

### Added
- Burger-menu item via `userNavRegistry`; lobby and match routes.
- 70/30 match view: `BdvBoardCanvas` (rendered from the spec snapshot) +
  `BdvOptionCards` (server-priced, unaffordable options shown with their price).
- `bdvMatch` Pinia store: single mutating path, `state_seq` guard, silent 409
  resync, and **no client-side pricing**.
