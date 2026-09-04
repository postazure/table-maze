# Table Maze

A retro pixel-art, top-down maze dungeon crawler for your phone. Drag your finger to guide the
hero through a procedurally generated maze, grab keys, open doors and chests,
fight (or bait) monsters, and take the stairs down to a deeper, harder level.

Play it at **https://postazure.github.io/table-maze/**

## How to play

- **Drag** your finger on the maze. The hero follows the trail your finger draws.
  Lift your finger and the hero keeps walking the queued path.
- The light highlight shows every tile you've stepped on this level.
- **Door keys** (purple, with devil horns) open doors, which carry the same horned
  emblem so you can match them at a glance. **Chest keys** (gold) open any chest and
  are used up when you do. The two kinds are not interchangeable, and keys don't
  carry over to the next level.
- Chests are solid. Walk into one with a chest key and the game pauses while the
  chest opens and your prize floats out: a sword, a shield, a heart, or coins.
  Tap to keep playing. Without a key the chest just blinks red.
- Drag into a monster to attack it. Once engaged, the hero keeps swinging on their
  own while the monster stays in reach. Walk away to break off.
- Health is hearts. A weak monster takes a quarter heart per hit, and you gain a
  heart every level. Monsters hit back and shove you away. If you run out of
  hearts you don't die: you're carried back to a nearby spot you already walked
  through, away from monsters, and fall asleep ("zzz"). Monsters ignore a
  sleeping hero. You get control back once every heart has refilled. Out of
  combat, hearts also refill slowly on their own. Monsters heal too, so finish
  a fight or walk away and expect them at full strength.
- Every monster wears a level tag. Red means it's above your level, green below.
- Monster types:
  - **Guards** never move. They block a tile until you beat them.
  - **Patrols** walk a fixed route. Time your run, or fight.
  - **Lurkers** sit off the main path and chase you when you get close. Lure one
    away from the corridor it watches, then loop around it through another passage.
- After every third floor you visit a **shop**: a small room with three pedestals,
  one magic item per slot (offense, defense, spirit). Walk into a pedestal to buy it
  with your gold. You can buy one item per shop, and a new item replaces whatever
  was in that slot. Items scale with the floor you bought them on.
- Magic items are all passive, so the controls never change. Some fire on a timer
  (a fireball staff, a shield bubble that recharges), some on a hit (poison, frost,
  chain lightning, thorns), some on a condition (berserker rage at low hearts, a
  phoenix feather when you'd be knocked down), and some all the time (speed boots,
  a compass that points at the nearest key, gold and XP charms).
- Every three floors the dungeon changes theme: crypt, sewer, magma cavern, glacier,
  overgrown ruins, haunted library, hive, abyss, then around again. Each theme has
  its own colours and its own monsters, but they always fill the same three roles.
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
