import type { MonsterKind } from './types';

/**
 * Dungeon themes. Every three maze floors the look of the dungeon and the
 * monsters that live in it change; the three monster roles (guard, patrol,
 * lurker) and their stat scaling stay exactly the same, only the roster and
 * the palette differ. Themes cycle once the list runs out.
 */

export type ThemeId =
  | 'crypt'
  | 'sewer'
  | 'cavern'
  | 'glacier'
  | 'forest'
  | 'library'
  | 'hive'
  | 'abyss';

export interface ThemePalette {
  /** Two alternating brick shades, a highlight row and the mortar lines. */
  wallA: string;
  wallB: string;
  wallHi: string;
  mortar: string;
  floor: string;
  speckLight: string;
  speckDark: string;
  /** Translucent tint for tiles the hero has walked on. */
  trail: string;
}

export interface Look {
  name: string;
  glyph: string;
}

export interface Theme {
  id: ThemeId;
  name: string;
  palette: ThemePalette;
  /** Monster looks per role. Names must contain a sprite keyword the renderer knows. */
  roster: Record<MonsterKind, Look[]>;
}

export const THEMES: readonly Theme[] = [
  {
    id: 'crypt',
    name: 'Crypt',
    palette: { wallA: '#34324a', wallB: '#2b2a3d', wallHi: '#403e5c', mortar: '#18172a', floor: '#100f1c', speckLight: '#241f38', speckDark: '#0a0912', trail: 'rgba(245,196,81,0.13)' },
    roster: {
      guard: [{ name: 'Spider', glyph: '🕷️' }, { name: 'Scorpion', glyph: '🦂' }],
      patrol: [{ name: 'Rat', glyph: '🐀' }, { name: 'Bat', glyph: '🦇' }],
      lurker: [{ name: 'Bat', glyph: '🦇' }, { name: 'Spider', glyph: '🕷️' }],
    },
  },
  {
    id: 'sewer',
    name: 'Sewer',
    palette: { wallA: '#2f4a35', wallB: '#26402c', wallHi: '#3b5a41', mortar: '#152218', floor: '#0e1a12', speckLight: '#1f3324', speckDark: '#08110b', trail: 'rgba(160,230,120,0.14)' },
    roster: {
      guard: [{ name: 'Toad', glyph: '🐸' }, { name: 'Crab', glyph: '🦀' }],
      patrol: [{ name: 'Leech', glyph: '🪱' }, { name: 'Rat', glyph: '🐀' }],
      lurker: [{ name: 'Slime', glyph: '🟢' }, { name: 'Snake', glyph: '🐍' }],
    },
  },
  {
    id: 'cavern',
    name: 'Magma Cavern',
    palette: { wallA: '#4a2a26', wallB: '#3d221f', wallHi: '#5e3630', mortar: '#1f100e', floor: '#1a0d0b', speckLight: '#4a1e14', speckDark: '#0e0605', trail: 'rgba(255,140,58,0.15)' },
    roster: {
      guard: [{ name: 'Magma Beetle', glyph: '🪲' }, { name: 'Golem', glyph: '🗿' }],
      patrol: [{ name: 'Fire Imp', glyph: '👿' }, { name: 'Salamander', glyph: '🦎' }],
      lurker: [{ name: 'Fire Imp', glyph: '👿' }, { name: 'Bat', glyph: '🦇' }],
    },
  },
  {
    id: 'glacier',
    name: 'Glacier',
    palette: { wallA: '#4a5f7a', wallB: '#3d5068', wallHi: '#6a82a0', mortar: '#1f2a3a', floor: '#141c2a', speckLight: '#2b3d55', speckDark: '#0c1119', trail: 'rgba(190,227,255,0.16)' },
    roster: {
      guard: [{ name: 'Yeti', glyph: '🦍' }, { name: 'Ice Golem', glyph: '🗿' }],
      patrol: [{ name: 'Ice Wolf', glyph: '🐺' }, { name: 'Frost Sprite', glyph: '❄️' }],
      lurker: [{ name: 'Frost Sprite', glyph: '❄️' }, { name: 'Ice Wolf', glyph: '🐺' }],
    },
  },
  {
    id: 'forest',
    name: 'Overgrown Ruins',
    palette: { wallA: '#4a4634', wallB: '#3d3a2b', wallHi: '#5c5a3a', mortar: '#1c1b12', floor: '#121a0e', speckLight: '#2c3d1c', speckDark: '#0a0d07', trail: 'rgba(200,230,120,0.14)' },
    roster: {
      guard: [{ name: 'Treant', glyph: '🌳' }, { name: 'Boar', glyph: '🐗' }],
      patrol: [{ name: 'Wolf', glyph: '🐺' }, { name: 'Boar', glyph: '🐗' }],
      lurker: [{ name: 'Spider', glyph: '🕷️' }, { name: 'Snake', glyph: '🐍' }],
    },
  },
  {
    id: 'library',
    name: 'Haunted Library',
    palette: { wallA: '#3f2f55', wallB: '#342647', wallHi: '#513e6b', mortar: '#1a1226', floor: '#130e1c', speckLight: '#2a1f3a', speckDark: '#0b0810', trail: 'rgba(200,160,255,0.15)' },
    roster: {
      guard: [{ name: 'Skeleton', glyph: '💀' }, { name: 'Knight', glyph: '🛡️' }],
      patrol: [{ name: 'Ghost', glyph: '👻' }, { name: 'Zombie', glyph: '🧟' }],
      lurker: [{ name: 'Wraith', glyph: '👻' }, { name: 'Ghost', glyph: '👻' }],
    },
  },
  {
    id: 'hive',
    name: 'Hive',
    palette: { wallA: '#5a4a1e', wallB: '#4a3d18', wallHi: '#736028', mortar: '#241d0a', floor: '#1a1408', speckLight: '#3a2e10', speckDark: '#0d0a04', trail: 'rgba(255,220,100,0.15)' },
    roster: {
      guard: [{ name: 'Larva', glyph: '🐛' }, { name: 'Ant', glyph: '🐜' }],
      patrol: [{ name: 'Bee', glyph: '🐝' }, { name: 'Wasp', glyph: '🐝' }],
      lurker: [{ name: 'Wasp', glyph: '🐝' }, { name: 'Spider', glyph: '🕷️' }],
    },
  },
  {
    id: 'abyss',
    name: 'Abyss',
    palette: { wallA: '#2a1a24', wallB: '#20141c', wallHi: '#3d2433', mortar: '#0d070b', floor: '#0a0509', speckLight: '#3a0f1c', speckDark: '#050204', trail: 'rgba(255,90,120,0.14)' },
    roster: {
      guard: [{ name: 'Ogre', glyph: '👹' }, { name: 'Drake', glyph: '🐉' }],
      patrol: [{ name: 'Goblin', glyph: '👺' }, { name: 'Fire Imp', glyph: '👿' }],
      lurker: [{ name: 'Vampire', glyph: '🧛' }, { name: 'Demon', glyph: '😈' }],
    },
  },
];

/** Floors 1-3 use theme 0, floors 4-6 theme 1, and so on, cycling. */
export function themeForDepth(depth: number): Theme {
  const d = Math.max(1, Math.floor(depth));
  return THEMES[Math.floor((d - 1) / 3) % THEMES.length];
}

export function themeById(id: string | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
