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
  Tap to keep playing. Without a key the chest just blinks red. You carry one
  of each trinket, so a second Rusty Sword is melted down and the chest pays
  coins instead — which is what gold is for.
- Monsters are solid: you can't walk through one. Drag into a monster to attack
  it. Stop next to a monster (or within reach of your weapon) and the hero
  fights it too. Once engaged, the hero keeps swinging on their own until the
  monster dies, you drag the hero away, or the hero is knocked down.
- Health is hearts. A weak monster takes a quarter heart per hit, and you gain a
  heart every level. Monsters hit back and shove you away. If you run out of
  hearts you don't die: you're carried back to a nearby spot you already walked
  through, away from monsters, and fall asleep ("zzz"). Monsters ignore a
  sleeping hero. You get control back once every heart has refilled. Out of
  combat, hearts also refill slowly on their own. Monsters heal too, so finish
  a fight or walk away and expect them at full strength. Getting knocked down
  heals every monster on the floor back to full at once.
- Every monster wears a level tag. Red means it's above your level, green below,
  and the tag is also the price: a red monster pays over the odds — up to three
  times its xp when you are badly behind — and a green one pays a fraction. So
  falling behind the dungeon is something you can fight your way out of, and
  running ahead of it stops paying. Gold is not scaled either way.
- Monster types, from weakest to deadliest:
  - **Patrols** walk a fixed route. They're trash: a speed bump you cut down in
    a few swings, or time your run past.
  - **Guards** never move. They block a tile until you beat them, and beating
    one at your level costs a third of your hearts or more. Untouched, they doze.
    A guard standing on the only way down is a **gate**: it fights at the
    floor's own level and swings no harder, so keeping pace with the depth is
    always enough to force your way past. Guards with something to protect — a
    chest, a door, the stairs themselves — hit far harder, and those you can
    walk around.
  - **Warrens** are rings of corridor dug out of the rock *outside* the maze.
    Each one is knocked through the maze's outer wall at a single tile and
    loops back to that same tile, so walking one never carries you toward the
    stairs — it only costs you the detour, and you can always reach the stairs
    without setting foot in one. They are extra ground rather than floor taken
    out of the maze: the maze itself is the same size and shape it would have
    been without them. They hold guards and patrols of their own. That is where you go when the guard on the critical path is
    beating you: clear a warren, come back a level or two up, and take the
    corridor. The loop is the point. It means you can break off a fight, let
    your hearts come back on the far side, and come at it again, which you
    cannot do in a dead end. A lurker turns up in one now and again, so they
    are never free money. Nothing in the game labels them; look at the walls
    where a passage opens.
  - **Lurkers** sit off the main path and chase you when you get close. They hit
    for whole hearts and outlast you at your level: fight one head-on and you'll
    be knocked down. How close is "close" depends on you: a lurker that is over
    your level notices you a tile later for each level of the gap, up to two
    tiles, so on the early floors you can walk into its corridor and back out
    again. Catch up to it and it reaches for you the full distance. Lure it away from the corridor it watches, then loop around
    it through another passage. Kill one when you're well over its level and the
    reward is the biggest in the dungeon. The first floor has none — it is
    patrols and guards while you learn the controls.
- After every third floor you face a **boss** before you reach the shop. An intro card
  explains the fight, then the game is on: **The Necromancer** channels a spell in a
  central chamber while raising skeletons — smash all five crystals down his corridors
  before the spell finishes, and you can't hurt him directly. **The Minotaur** is a slow
  but unkillable hunter in a braided maze — just find the stairs. **The Weeping Angels**
  haunt a grid of rooms and march in step with you — every step you take, each awake
  angel takes one too, and if you stop to think they still creep closer, slowly and
  without end. Plan a route to the stairs before they close in. Win and one of your magic items gains a level (or
  you gain a heart if you're wearing nothing), and your hearts refill. Lose in a boss
  chamber and the run ends there — no waking up nearby this time — and a stats screen
  shows how far you got, your level, kills, bosses beaten, gold, and time played before
  you start a new run.
- After every third floor you visit a **shop**: a room with three podiums, one magic
  item per slot. Each podium wears its slot emblem — a sword for offense, a shield for
  defense, a star for spirit — so you can see what kind of item it holds from across
  the room. Walk into a podium and a card tells you the item's name, what it does and
  what it costs; buy it with the green button or walk away with the red one. You can
  buy one item per shop, and a new item replaces whatever was in that slot. Items
  scale with the floor you bought them on.
- Magic items are all passive, so the controls never change. Some fire on a timer
  (a fireball staff, a shield bubble that recharges), some on a hit (poison, frost,
  chain lightning, thorns), some on a condition (berserker rage at low hearts, a
  phoenix feather when you'd be knocked down), and some all the time (speed boots,
  a compass that points at the nearest key, gold and XP charms).
- Every three floors the dungeon changes theme: crypt, sewer, magma cavern, glacier,
  overgrown ruins, haunted library, hive, abyss, then around again. Each theme has
  its own colours and its own monsters, but they always fill the same three roles.
- Step on the 🪜 stairs to descend. Levels get bigger and monsters get stronger
  the deeper you go, but never far over your head: a floor is rolled against your
  level as you walk in, and it may only put monsters a level or so above you at
  first. That headroom widens as you climb — being two levels down matters far
  less at level ten than at level two — until the cap stops biting and the floor
  rolls its full spread. It never works the other way: a floor is never weaker
  than its own depth, so falling behind does not make the dungeon easier. Your hero levels up from XP and keeps every stat and item.
  Clearing a floor's patrols, guards and chests is worth about one level, so the
  hero tracks the depth rather than outrunning it: skip fights and the dungeon
  pulls ahead of you, kill the lurkers too and you buy yourself a cushion. It is
  a cushion and not a runaway, because a monster below your level barely pays.
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
