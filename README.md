# Table Maze

A retro pixel-art, top-down maze dungeon crawler for your phone. Drag your finger to guide the
hero through a procedurally generated maze, grab keys, open doors and chests,
fight (or bait) monsters, and take the stairs down to a deeper, harder level.

Play it at **https://postazure.github.io/table-maze/**

## How to play

- **Drag** your finger on the maze. The hero follows the trail your finger draws.
  Lift your finger and the hero keeps walking the queued path.
- The light highlight shows every tile you've stepped on this level.
- **Door keys** (purple, with a watching eye on the ring) open doors, which carry the
  same eye emblem so you can match them at a glance. **Chest keys** (gold) open any chest and
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
- Behind the walls of every maze floor is a **hidden wing**: a small dungeon of
  its own, dug into the rock outside the maze. Four to eight rooms joined by
  short corridors, entered through a single mouth knocked through the outer
  wall (now and then a second, a back door further along), and drawn as
  unbroken brick. You cannot see one, and you cannot walk into one, without a
  **Cracked Lens**. That turns up in a chest on the first or second floor of
  each three-floor theme — no chest is marked, so finding it means opening
  them. It comes out with a fracture already running across the glass, which
  is your notice that it is not going to last. Carry it and the wall opens as
  you walk past the mouth: the brick goes clear at your feet and back to solid
  a few paces off. That is the only sign you ever get. Nothing marks a wing
  from across the room, so the way to find one is to walk the floor, and a
  player who took the direct route down will simply have missed it. Even
  inside, only the tiles around you come clear, so a wing is something you
  feel your way through room by room rather than a map handed to you. Walk
  out of that theme's shop and the lens shatters on the stairs.
  A wing is the hard end of its floor. Its rooms hold **lurkers** and elite
  guards a level over anything the maze outside would roll — a lurker in a
  wing has the room loops to be baited round, the same as in a warren — and
  none of it is ever on the way to the stairs, so none of it has to be
  beatable. A side chest in a wing is sometimes a **mimic**: a chest that is a
  monster, sprung the moment you touch it, no key needed, and it pays like
  the treasure it was pretending to be. Watch a chest for a moment before you
  walk up to it.
  At the far end of every wing is a **treasure room** with a chest holding a
  magic item — the same kind the shop sells, at the floor's level — behind a
  **sealed door**. If the item's slot is empty it goes straight on; if not,
  the chest asks whether to wear it in place of what you have or melt it down
  for coins. The seal is a lock, and each floor rolls one of three:
  - **Runes**: three or four runes on the floors of the other rooms. Step on
    them in the right order and the seal opens; step on the wrong one and
    every rune goes dark again. How the order is told varies. Sometimes each
    rune shows its place as dots. Sometimes the order is carved on the sealed
    door itself, and you have to go and read it. Sometimes nothing anywhere
    says, and three runes are six orders and a walk each.
  - **The orb**: an orb lies in the room furthest from the door, and a cradle
    stands in front of the seal. Walk onto the orb to pick it up and carry it
    to the cradle. Both hands are full while you carry it: the hero sets it
    down to fight, under their own feet, and you step back onto it to pick it
    up again. Get knocked down and it lands where you fell. Carry it out of
    the wing and it slips back to where it lay.
  - **A keystone**: the door is carved with a shape — a sun, a moon, a star —
    and opens only for the matching **relic**. Relics lie in the wings of
    earlier floors, so a keystone seal is only ever asking for something the
    run put behind you; whether you went looking for it with a lens at the
    time is another matter. Relics ride in your pack for the rest of the run
    (the help screen's Hero tab lists them), and a seal takes its relic when
    you walk into it.
  From the second theme on, some wings hold an **altar**, carved with a skull,
  a pair of horns or a single tear. Beat a boss and you keep its **trophy**;
  an altar carved for that trophy trades it for a **boon**: a Deathless Pact
  (two extra hearts), Bull's Vigor (attack and defense) or Second Sight (a
  lens for the first three floors). A boon is yours at once, and it is the one
  thing in the game that outlives a run: it holds for the next two runs as
  well, and then it breaks.
  Nothing on a floor ever needs a wing: the stairs, every key and every shrine
  are reachable without one, so the lens buys you loot and a harder fight,
  never the way out.
- Four **shrines** stand in alcoves on every maze floor, and no two are worth the
  same walk. One sits in a dead end hanging straight off the route down, where you
  cannot miss it. One or two are at the back of the longer **warrens**, so clearing
  a loop is worth something beyond the xp. The rest are scattered across the map, as
  far from each other as the floor allows. Nothing about them blocks — a shrine is
  floor you walk over, so even the ones standing mid-corridor are stepped straight
  across — which means you can note one on the way past and come back for it when a
  fight actually needs it. Walk over one to light it and it hands you its gift, once, and then goes
  dark for the rest of the floor. Every gift runs out. **Ward** hands you extra
  temporary hearts, in blue on the end of your heart row; hits eat those first and
  nothing ever refills them. **Fury** and **Stone Skin** buy you attack or defense
  for twenty seconds. **Frost** throws an ice ball at the nearest monster in sight
  every couple of seconds and freezes whatever it hits solid — no step, no swing —
  for a moment. **Mending** refills a quarter heart on a fast beat, fighting or not.
  **Time Bubble** drops every monster within six tiles to a crawl. What is running
  shows as a row of pips floating above the hero. They never count down in numbers:
  a pip is solid while there is time on it, blinks for the last ten seconds, and
  blinks twice as fast for the last five. For the actual seconds, open the help
  screen: its Hero tab lists exactly what you have running and how long is left on
  each, and nothing else — it is a read on your hero, not a catalogue. Get knocked down and
  every shrine effect goes with it. They do survive the stairs, so a shrine near the
  way down is a way to walk into the next floor, or a boss chamber, already buffed.
- **Spirit** is your third stat, next to attack and defense, and the only thing it
  does is make shrines go further. Every point is ten percent more, up to double.
  The timed shrines run longer; the ward, which has no clock, hands out more hearts
  instead — each one gets more of the only currency it has, so nothing is made both
  longer and stronger. Spirit creeps up a point every third hero level, and
  *anything* you wear in the spirit slot adds to it, whatever else that item does.
  So the star podium in the shop is not only a gold charm or an XP tome: it is also
  a standing bet on the alcoves of every floor after it.
- After every third floor you face a **boss** before you reach the shop. An intro card
  explains the fight, then the game is on: **The Necromancer** channels a spell in a
  central chamber while raising skeletons — smash all five crystals down his corridors
  before the spell finishes, and you can't hurt him directly. **The Minotaur** is a slow
  but unkillable hunter in a braided maze — just find the stairs. **The Weeping Angels**
  haunt a grid of rooms and lay siege — they are much slower than you, but they always
  know where you are and take the shortest way round, so they walk into the doorways of
  whatever room you are in and wait there, just out of reach. Block every way out of a
  room and they finally move in; three touches turn you to stone. Keep moving, and never
  let them have the last door. Deeper angel floors are a bigger grid of rooms with more
  statues in them — a longer walk with more of them awake behind you — rather than faster
  angels. Win and one of your magic items gains a level (or
  you gain a heart if you're wearing nothing), and your hearts refill. Lose in a boss
  chamber and the run ends there — no waking up nearby this time — and a stats screen
  shows how far you got, your level, kills, bosses beaten, gold, and time played before
  you start a new run. Win and you also keep the boss's trophy, for the altars.
- After every third floor you visit a **shop**: a room with three podiums, one magic
  item per slot. Each podium wears its slot emblem — a sword for offense, a shield for
  defense, a star for spirit — so you can see what kind of item it holds from across
  the room. Walk into a podium and a card tells you the item's name, what it does and
  what it costs; buy it with the green button or walk away with the red one. Below the
  podiums stands the **forge**: walk into it and it offers a level on any magic item
  you already wear, for less than a new one would cost. You can buy one thing per
  shop — an item or an upgrade — and a new item replaces whatever was in that slot.
  Items scale with the floor you bought them on.
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
- **Sound** is on by default; the speaker button in the HUD turns it and the
  music off, and remembers your choice. It tries to start playing the moment
  the game loads; where the browser won't allow that without a gesture, the
  first sound arrives with your first tap instead. Hold the speaker button
  down to open a volume slider.
  Everything you hear is generated as you play — square waves, triangles and
  filtered noise, the palette of a 1980s sound chip. The sounds you hear all
  day (a footstep, a swing, a hit) shift a fraction in pitch every time so a
  long fight doesn't turn into a stuck sample; the ones that mean something
  specific — a chest opening, a level up, the stairs, a crystal breaking —
  never change, so you can learn them by ear and know what happened without
  looking. The music is ambience rather than a tune: a low drone, a
  chord that changes every fifteen seconds or so, and the odd single note, all
  through a big reverb so the dungeon sounds like a large stone room. There are
  seven pieces — five for the dungeon (the theme picks one, so it changes every
  three floors), one for the shop, and one for boss chambers, which is the only
  one with a pulse under it. None of them is a loop: each is a set of rules the
  game plays fresh as it goes, so which notes land, and whether any land at
  all, is different every time. About a third of bars hold nothing but the
  drone, which is what keeps the music somewhere behind you rather than in
  front.
- The **help button** (`?`) pauses the game and opens three tabs: **Hero** (what you
  are wearing and what you have running), **Log** (everything that has happened this
  run, newest first) and **How to play**. The panel under the maze deliberately
  keeps none of that — it is hearts, XP, seven numbers and your three gear slots,
  and the only things on it that look pressable are the three buttons that are.
- Progress is saved in your browser's local storage automatically.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # unit tests (maze generation, pathfinding, game rules)
npm run build      # typecheck + production build into dist/
```

Plain TypeScript with hand-drawn pixel sprites on the Canvas API and music and
sound effects synthesised on the fly with the Web Audio API. No art files, no
audio files, and no runtime dependencies beyond React.

`src/engine/CONTRACTS.md` describes what each module owes the others.

## Deploying

Pushes to `main` run `.github/workflows/deploy.yml`, which builds the site and
publishes it to GitHub Pages. One-time setup in the repository settings:
**Settings → Pages → Build and deployment → Source: GitHub Actions**.
