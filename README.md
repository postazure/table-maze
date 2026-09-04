# Table Maze

A retro pixel-art, top-down maze dungeon crawler for your phone. Drag your finger to guide the
hero through a procedurally generated maze, grab keys, open doors and chests,
fight (or bait) monsters, and take the stairs down to a deeper, harder level.

Play it at **https://postazure.github.io/table-maze/**

## How to play

- **Drag** your finger on the maze. The hero follows the trail your finger draws.
  Lift your finger and the hero keeps walking the queued path.
- The light highlight shows every tile you've stepped on this level.
- **Door keys** (gold) open doors. **Chest keys** (blue) open any chest and are used
  up when you do. The two kinds are not interchangeable, and keys don't carry over
  to the next level.
- Chests are solid. Walk into one with a chest key and the game pauses while the
  chest opens and your prize floats out: a sword, a shield, a heart, or coins.
  Tap to keep playing. Without a key the chest just blinks red.
- Drag into a monster to attack it. Hold your finger on it to keep swinging.
- Health is hearts. A weak monster takes a quarter heart per hit, and you gain a
  heart every level. Monsters hit back and shove you away. If you run out of
  hearts you don't die: you're knocked down, pushed back along your trail, and
  get up with some hearts back. Hearts slowly refill when you're out of combat. Monsters heal too, so finish
  a fight or walk away and expect them at full strength.
- Every monster wears a level tag. Red means it's above your level, green below.
- Monster types:
  - **Guards** never move. They block a tile until you beat them.
  - **Patrols** walk a fixed route. Time your run, or fight.
  - **Lurkers** sit off the main path and chase you when you get close. Lure one
    away from the corridor it watches, then loop around it through another passage.
- Step on the 🪜 stairs to descend. Levels get bigger and monsters get stronger
  the deeper you go. Your hero levels up from XP and keeps every stat and item.
- Progress is saved in your browser's local storage automatically.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # unit tests (maze generation, pathfinding, game rules)
npm run build      # typecheck + production build into dist/
```

Plain TypeScript and the Canvas API with hand-drawn pixel sprites. No runtime dependencies.

## Deploying

Pushes to `main` run `.github/workflows/deploy.yml`, which builds the site and
publishes it to GitHub Pages. One-time setup in the repository settings:
**Settings → Pages → Build and deployment → Source: GitHub Actions**.
