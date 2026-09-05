import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES } from '../src/engine/themes';
import type { RosterKind } from '../src/engine/types';
import { MONSTER_CFGS, monsterSpriteKey } from '../src/render/monsterArt';

test('every theme roster entry resolves to a real monster sprite', () => {
  for (const theme of THEMES) {
    for (const looks of Object.values(theme.roster)) {
      for (const look of looks) {
        const key = monsterSpriteKey(look.name);
        assert.notEqual(key, 'blob', `${theme.id}: "${look.name}" falls back to the generic blob sprite`);
        assert.ok(MONSTER_CFGS[key], `${theme.id}: "${look.name}" resolves to unknown sprite "${key}"`);
      }
    }
  }
});

test('a monster is the same role everywhere it appears, and never two roles in one theme', () => {
  const roleForSpriteKey = new Map<string, RosterKind>();
  for (const theme of THEMES) {
    for (const [role, looks] of Object.entries(theme.roster) as [RosterKind, { name: string }[]][]) {
      for (const look of looks) {
        const key = monsterSpriteKey(look.name);
        const prevRole = roleForSpriteKey.get(key);
        if (prevRole) {
          assert.equal(
            prevRole,
            role,
            `"${look.name}" (sprite "${key}") is a ${role} in ${theme.id} but a ${prevRole} elsewhere`,
          );
        }
        roleForSpriteKey.set(key, role);
      }
    }
  }
});
