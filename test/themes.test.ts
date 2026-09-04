import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, themeById, themeForDepth } from '../src/engine/themes';
import { makeMonster } from '../src/engine/balance';
import { makeRng } from '../src/engine/rng';
import { generateLevel } from '../src/engine/maze';

test('themes change every three floors and cycle', () => {
  assert.equal(themeForDepth(1).id, THEMES[0].id);
  assert.equal(themeForDepth(3).id, THEMES[0].id);
  assert.equal(themeForDepth(4).id, THEMES[1].id);
  assert.equal(themeForDepth(6).id, THEMES[1].id);
  assert.equal(themeForDepth(7).id, THEMES[2].id);
  assert.equal(themeForDepth(3 * THEMES.length + 1).id, THEMES[0].id, 'cycles back to the first theme');
  assert.equal(themeById('nope').id, THEMES[0].id, 'unknown ids fall back');
});

test('every theme has a full roster and palette', () => {
  const ids = new Set<string>();
  for (const t of THEMES) {
    assert.ok(!ids.has(t.id), `duplicate theme id ${t.id}`);
    ids.add(t.id);
    for (const role of ['guard', 'patrol', 'lurker'] as const) {
      assert.ok(t.roster[role].length >= 1, `${t.id} has no ${role}s`);
      for (const look of t.roster[role]) assert.ok(look.name.length > 0 && look.glyph.length > 0);
    }
    for (const v of Object.values(t.palette)) assert.ok(typeof v === 'string' && v.length > 0);
  }
});

test('monsters take their look from the floor theme but keep role scaling', () => {
  const rng = makeRng(11);
  const crypt = makeMonster('guard', 2, rng, { x: 1, y: 1 }, 'a');
  const sewer = makeMonster('guard', 5, rng, { x: 1, y: 1 }, 'b');
  assert.ok(THEMES[0].roster.guard.some((l) => l.name === crypt.name));
  assert.ok(THEMES[1].roster.guard.some((l) => l.name === sewer.name));
  assert.ok(sewer.maxHp > crypt.maxHp, 'stats still scale with depth');
  const lv = generateLevel(5, 42);
  assert.equal(lv.theme, THEMES[1].id);
  for (const m of lv.monsters) assert.ok(THEMES[1].roster[m.kind].some((l) => l.name === m.name), `${m.name} is not a sewer ${m.kind}`);
});
