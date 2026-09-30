// The match analysis on a real (anonymized) match: Ascent 5:13, the player on Reyna is "you".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shapeMatch, roundStarts, T } from '../src/lib/matchAnalysis.js';
import { analyseMatch, playerStats } from '../src/lib/insights.js';

const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/match.json', import.meta.url), 'utf8'));
const me = raw.players.find((p) => p.agent.name === 'Reyna').puuid;

test('scoreboard numbers match the game', () => {
  const d = shapeMatch(raw, me);
  assert.equal(d.players.length, 10);
  assert.deepEqual(d.score, { us: 5, them: 13 });
  assert.equal(d.won, false);
  const p = d.players.find((x) => x.isMe);
  assert.equal(p.acs, 162);
  assert.deepEqual([p.kills, p.deaths, p.assists], [10, 16, 3]);
  assert.equal(p.kast, 78);
  // the lobby's top player (the enemy team's, 263 ACS) and the Jett on your team (tracker.gg: 242 ACS, 61% KAST, 2 FK, 5 FD)
  assert.equal(d.players[0].acs, 263);
  const top = d.players.find((x) => x.agent === 'Jett' && x.team === p.team);
  assert.equal(top.acs, 242);
  assert.equal(top.kast, 61);
  assert.deepEqual([top.fk, top.fd], [2, 5]);
  // first kills and first deaths add up to the number of rounds with a kill
  const fk = d.players.reduce((s, x) => s + x.fk, 0), fd = d.players.reduce((s, x) => s + x.fd, 0);
  assert.equal(fk, fd);
  assert.ok(fk <= d.rounds.length);
});

test('every duel has its facts, and the flags are consistent', () => {
  const d = shapeMatch(raw, me);
  for (const r of d.rounds) for (const k of r.kills) {
    if (k.spike) continue;
    assert.ok(k.facts, 'facts');
    assert.ok(k.facts.alive.killerTeam >= 1 && k.facts.alive.killerTeam <= 5);
    assert.ok(k.key.startsWith(`${r.n}:`));
  }
  for (const x of d.duels) {
    if (x.flags.includes('early')) assert.ok(x.t < T.earlyDeathMs);
    if (x.kind === 'kill') assert.ok(!x.flags.includes('not-traded'));
  }
  assert.equal(d.duels.filter((x) => x.kind === 'kill').length, 10);
  assert.equal(d.duels.filter((x) => x.kind === 'death').length, 16);
});

test('round starts are in order', () => {
  const s = roundStarts(raw);
  assert.equal(s.length, raw.rounds.length);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1], `round ${i + 1} after round ${i}`);
});

test('economy graph has both teams every round', () => {
  const d = shapeMatch(raw, me);
  assert.equal(d.teamEconomy.rounds.length, d.rounds.length);
  for (const r of d.teamEconomy.rounds) { assert.ok(r.us.loadout >= 0); assert.ok(r.them.total >= r.them.loadout); }
  assert.equal(d.economy[0].pistol, true);
});

test('insights stats of one match agree with the scoreboard', () => {
  const a = analyseMatch(raw, null, new Map());
  const s = playerStats([{ a, puuid: me }]);
  assert.equal(s.kills, 10);
  assert.equal(s.deaths, 16);
  assert.equal(s.rounds, 18);
  assert.ok(Math.abs(s.kast - 0.78) < 0.01);
});
