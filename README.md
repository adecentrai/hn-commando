# HN Commando

A retro run-and-gun browser game for hobbyistnirvana.com, meant to live at `/pages/play`
and send players to the HN-R36S-WiFi product page. Inspired by the *style* of Space Huggers;
no Space Huggers code or art is used (its author does not allow redistribution).

Built on the [LittleJS](https://github.com/KilledByAPixel/LittleJS) platformer example
(MIT, Frank Force, see `LICENSE-LittleJS.txt`). Engine: `src/littlejs.esm.min.js` v1.19.4.

## Run

```
python -m http.server 8765 --bind 127.0.0.1
```

Open http://127.0.0.1:8765/. Add `?debug` to expose `window.hnDebug` for tests.

## Test

With the server running, from this folder (needs the `playwright` npm package):

```
node tools/playtest.cjs http://127.0.0.1:8765/ <outDir>
```

Runs headless Chromium: generates 36 levels, plays a desktop mission (run, shoot, grenade,
clear, game over, replay), and drives the touch controls in phone portrait and landscape.
Prints a JSON report and saves screenshots to `<outDir>`.

## Game rules

- Every mission is a new random planet (`src/gameLevel.js`); clear all hostiles to warp on.
- 8 lives, +2 per cleared mission, 3 grenades per life (crates may drop more, max 6).
- Hostiles: hoppers (touch damage), alien soldiers (patrol, burst fire), turrets (aim, mission 2+).
- Terrain is destructible except metal (bedrock, walls, outpost roof corners, some girders).

## Controls

| Action  | Keyboard            | Mouse  | Gamepad | Touch            |
|---------|---------------------|--------|---------|------------------|
| Move    | Arrows / WASD       |        | Stick   | Left d-pad       |
| Jump    | Up / W / Space      |        | A       | JUMP             |
| Shoot   | Z / J               | Left   | X       | FIRE             |
| Roll    | X / K / Left Shift  | Right  | Y       | ROLL             |
| Grenade | C / L               | Middle | B       | GRENADE          |

Touch controls are DOM buttons (`src/ui.js`); the engine's own touch input is switched off
on touch devices so taps on the title and game-over buttons and the store link keep working.

## R36S skin (phones)

On touch devices the game runs inside a CSS-drawn HN-R36S: slab body, 4:3 screen in a black
bezel, black cross d-pad, ABXY diamond (X blue, Y green, A red, B yellow), FN, SELECT, START
and two sticks. The engine renders at a fixed 480×360 into `#screen`. Rotating the phone lays
the device out sideways.

| R36S button        | Action                  |
|--------------------|-------------------------|
| D-pad / left stick | Move and climb          |
| B / right stick    | Fire                    |
| A                  | Jump                    |
| Y                  | Grenade                 |
| X                  | Roll                    |
| START              | Start, pause and resume |
| SELECT             | Sound on/off            |
| FN                 | Show the controls       |

URL options: `?shell=white` or `?shell=purple` (default transparent black), `?skin=r36s` to
show the skin on desktop, `?skin=off` for plain overlay buttons on phones.

## Store hooks

- Game over shows the score and a "GET THE R36S" link (`target="_top"`) with
  `?ref=hn_commando` (no utm tags on links inside our own store: they would take the credit
  for a sale away from the ad that brought the buyer).
- `track()` in `src/game.js` sends `start`, `mission_clear`, `game_over` and `cta_click`
  events to `gtag` when the game runs on the store's own domain, and `postMessage`s
  `{source:'hn-commando', event, ...}` to the parent page when it runs in an iframe.
