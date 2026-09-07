/**
 * STUB: the Boston world. A subagent replaces this file wholesale; only the
 * export name and the `WorldModule` shape are contract.
 */
import type { Hero, LevelData, WorldData } from '../types';
import { Tile } from '../types';
import type { WorldModule } from './world';

function stubLevel(stage: number, runSeed: number, data: WorldData['data'] | null): LevelData {
  const width = 9;
  const height = 7;
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x++) row.push(x > 0 && y > 0 && x < width - 1 && y < height - 1 ? Tile.Floor : Tile.Wall);
    tiles.push(row);
  }
  return {
    depth: 1,
    seed: runSeed ^ stage,
    kind: 'world',
    theme: 'crypt',
    world: { kind: 'necromancer', stage, data: data ?? {}, won: false },
    width,
    height,
    tiles,
    start: { x: 1, y: 1 },
    exit: { x: width - 2, y: height - 2 },
    keys: [],
    doors: [],
    chests: [],
    monsters: [],
    props: [{ id: 'home', pos: { x: width - 2, y: height - 2 }, kind: 'portal-home', solid: true, art: 'portal-home' }],
  };
}

export const ARKHAM: WorldModule = {
  kind: 'necromancer',
  name: 'Boston',
  intro: () => ({ title: 'Boston', lines: ['This world is not built yet.'] }),
  collectible: { id: 'silver-key', name: 'The Silver Key', description: 'A key of tarnished silver, to a gate that is not in this world.' },
  defeat: () => 'The run ends here.',
  generate: (stage, runSeed, _hero: Hero, data) => stubLevel(stage, runSeed, data),
  onBump: (ctx, prop) => {
    if (prop.kind === 'portal-home') ctx.returnHome();
  },
};
