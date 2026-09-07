/**
 * STUB: art for the cemetery world. A subagent replaces this file wholesale.
 * Contract: export PROP_ART (keyed by Prop.art, optionally 'art:state'),
 * MONSTER_CFGS for the world's own monster names, and DEFEAT_ART, a 16x16
 * scene for its game-over screen.
 */
import type { ArtSpec } from '../itemArt';
import type { CreatureCfg } from '../monsterArt';

export const PROP_ART: Record<string, ArtSpec> = {
  'portal-home': {
    rows: ['..PPPP..', '.PLLLLP.', 'PLWWWWLP', 'PLWWWWLP', 'PLWWWWLP', 'PLWWWWLP', '.PLLLLP.', '..PPPP..'],
    palette: { P: '#5a2596', L: '#b56cff', W: '#e8d9ff' },
  },
};

export const MONSTER_CFGS: Record<string, CreatureCfg> = {};

export const DEFEAT_ART: ArtSpec = {
  rows: Array.from({ length: 16 }, () => '................'),
  palette: {},
};
