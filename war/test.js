// Engine tests for Egyptian War — rigs hands directly and checks rules.
const { Game } = require('./game');

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
}

function newGame(nPlayers) {
  const g = new Game();
  for (let i = 1; i <= nPlayers; i++) g.addPlayer(`p${i}`);
  g.start('p1');
  return g;
}
const C = (v, s = '♠') => ({ v, s });

// ---- 1. Deal ----
{
  const g = newGame(3);
  const counts = g.players.map((p) => p.cards.length);
  check('deal: 52 cards split 18/17/17', counts.reduce((a, b) => a + b) === 52 && Math.max(...counts) - Math.min(...counts) <= 1);
  check('deal: phase is playing', g.phase === 'playing');
}

// ---- 2. Pair slap ----
{
  const g = newGame(2);
  g.turnId = 'p1';
  g.players[0].cards = [C(7), C(5)]; // top = 5
  g.players[1].cards = [C(9), C(5)]; // top = 5
  g.flip('p1'); // pile: 5
  g.flip('p2'); // pile: 5,5 -> pair
  const r = g.slap('p2');
  check('pair slap: valid slap wins pile', r.events.some((e) => e.type === 'slapWin'));
  check('pair slap: winner has the 2 pile cards', g.players[1].cards.length === 3 && g.pile.length === 0);
  check('pair slap: winner flips next', g.turnId === 'p2');
}

// ---- 3. Sandwich slap ----
{
  const g = newGame(2);
  g.turnId = 'p1';
  g.pile = [C(8), C(3), C(8)]; // 8,3,8 -> sandwich
  g.players[0].cards = [C(2)];
  const r = g.slap('p1');
  check('sandwich slap: valid', r.events.some((e) => e.type === 'slapWin'));
}

// ---- 4. False slap donates to pile bottom ----
{
  const g = newGame(2);
  g.turnId = 'p1';
  g.lastResolve = 0; // outside the too-slow grace window
  g.pile = [C(8), C(3)];
  g.players[0].cards = [C(2), C(9)]; // top = 9
  const r = g.slap('p1');
  check('false slap: event emitted', r.events.some((e) => e.type === 'falseSlap'));
  check('false slap: top card donated to pile BOTTOM', g.pile.length === 3 && g.pile[0].v === 9);
  check('false slap: donation does not enable a slap', !g.slapValid());
}

// ---- 5. Too-slow grace: no penalty right after a collect ----
{
  const g = newGame(2);
  g.turnId = 'p1';
  g.lastResolve = Date.now();
  g.pile = [C(8), C(3)];
  g.players[0].cards = [C(2), C(9)];
  const r = g.slap('p1');
  check('too slow: no donation inside grace window', r.events.some((e) => e.type === 'tooSlow') && g.pile.length === 2);
}

// ---- 6. Challenge: J=1, responder fails -> challenger collects ----
{
  const g = newGame(2);
  g.turnId = 'p1';
  g.players[0].cards = [C(2), C(11)]; // top = J
  g.players[1].cards = [C(3), C(9)];  // top = 9 (not a face)
  g.flip('p1'); // J -> challenge count 1, p2 responds
  check('challenge: created with count 1', g.challenge && g.challenge.remaining === 1 && g.challenge.toId === 'p2');
  g.flip('p2'); // 9 -> fail
  check('challenge: pending collect for challenger', g.collectPending && g.collectPending.winnerId === 'p1');
  const r = g.finishCollect();
  check('challenge: p1 collected pile', r.events.some((e) => e.type === 'collect') && g.players[0].cards.length === 3);
  check('challenge: winner flips next', g.turnId === 'p1');
}

// ---- 7. Challenge chain: K -> J neutralizes, third player fails, middle wins ----
{
  const g = newGame(3);
  g.turnId = 'p1';
  g.players[0].cards = [C(2), C(13)];        // top = K (count 3)
  g.players[1].cards = [C(3), C(11), C(5)];  // flips 5, then J -> new challenge
  g.players[2].cards = [C(4), C(9)];         // flips 9 -> fails
  g.flip('p1'); // K
  check('chain: K challenge count 3 to p2', g.challenge.remaining === 3 && g.challenge.toId === 'p2');
  g.flip('p2'); // 5 -> remaining 2, still p2
  check('chain: counts down, same responder', g.challenge.remaining === 2 && g.challenge.toId === 'p2');
  g.flip('p2'); // J -> new challenge: p2 challenges p3, count 1
  check('chain: face card starts new challenge p2->p3', g.challenge.byId === 'p2' && g.challenge.toId === 'p3' && g.challenge.remaining === 1);
  g.flip('p3'); // 9 -> fail
  check('chain: most recent challenger (p2) wins', g.collectPending && g.collectPending.winnerId === 'p2');
  g.finishCollect();
  check('chain: p2 holds pile (1 left + 4 pile)', g.players[1].cards.length === 5);
}

// ---- 8. Slap steals a pending challenge collection ----
{
  const g = newGame(2);
  g.turnId = 'p1';
  g.players[0].cards = [C(2), C(11)]; // J
  g.players[1].cards = [C(3, '♥'), C(11, '♦')]; // wait — responding with J would chain; use numbers
  g.players[1].cards = [C(3, '♥'), C(2, '♦')]; // flips 2 -> fails, but pile top two = J? no: pile = J,2
  g.flip('p1'); // J
  g.flip('p2'); // 2 -> challenge failed, pending collect for p1; pile = J,2 (no slap cond)
  // rig: pretend pile is slappable during the window
  g.pile.push(C(2, '♣')); // pile J,2,2 -> pair on top
  const r = g.slap('p2');
  check('steal: valid slap during collect window wins', r.events.some((e) => e.type === 'slapWin') && r.cancelTimer === true);
  check('steal: collect pending cleared', g.collectPending === null);
  check('steal: p2 owns the cards', g.players[1].cards.length === 4);
}

// ---- 9. Elimination, re-entry, lockout, game over ----
{
  const g = newGame(2);
  g.turnId = 'p1';
  g.players[0].cards = [C(5)];           // last card
  g.players[1].cards = [C(9), C(5, '♥')];
  g.flip('p1'); // p1 now has 0 cards; pile: 5
  check('elim: turn passes to p2', g.turnId === 'p2');
  g.flip('p2'); // pile: 5,5 -> pair
  const r = g.slap('p1'); // eliminated player slaps back in
  check('re-entry: 0-card player slaps back in', r.events.some((e) => e.type === 'slapWin' && e.wasOut));
  check('re-entry: p1 has 2 cards', g.players[0].cards.length === 2);
  check('no premature game over', g.phase === 'playing');
}

// ---- 10. 0-card false slap locks player for 3 rounds (not permanently) ----
{
  const g = newGame(3);
  g.turnId = 'p2';
  g.lastResolve = 0;
  g.players[0].cards = [];
  g.players[1].cards = [C(9), C(5)];
  g.players[2].cards = [C(7)];
  g.pile = [C(8), C(3)];
  const r = g.slap('p1'); // false slap with 0 cards
  check('lockout: event says 3 rounds', r.events.some((e) => e.type === 'lockedOut' && e.rounds === 3));
  check('lockout: lockedFor is 3', g.publicState().players[0].lockedFor === 3);
  check('lockout: game continues', g.phase === 'playing');
  check('lockout: slap while locked is ignored', g.slap('p1').events.some((e) => e.type === 'slapIgnoredLocked'));
  // Three pile collections later the lock expires.
  for (let i = 0; i < 3; i++) {
    g.pile = [C(4), C(4, '♥')];
    g.slap('p2');
  }
  check('lockout: expired after 3 collections', g.publicState().players[0].lockedFor === 0);
  g.pile = [C(6), C(6, '♥')];
  const r2 = g.slap('p1');
  check('lockout: can slap back in after expiry', r2.events.some((e) => e.type === 'slapWin' && e.wasOut));
}

// ---- 11. Pile collection no longer locks 0-card players (house rule) ----
{
  const g = newGame(3);
  g.turnId = 'p2';
  g.players[0].cards = [];               // p1 eliminated
  g.players[1].cards = [C(5), C(5, '♥')];
  g.players[2].cards = [C(9)];
  g.pile = [C(5, '♦')];
  g.flip('p2'); // pile 5,5 -> pair
  g.slap('p3'); // p3 slaps it
  check('collect: p1 (0 cards) is NOT locked, can still slap in', g.publicState().players[0].lockedFor === 0 && g.phase === 'playing');
}

// ---- 12. Responder with 0 cards in a challenge -> challenger wins immediately ----
{
  const g = newGame(3);
  g.turnId = 'p1';
  g.players[0].cards = [C(2), C(12)];   // Q (count 2)
  g.players[1].cards = [C(7)];          // only 1 card
  g.players[2].cards = [C(4), C(9)];
  g.flip('p1'); // Q -> p2 must answer with up to 2
  g.flip('p2'); // 7, p2 now empty mid-challenge
  check('mid-challenge runout: challenger collects', g.collectPending && g.collectPending.winnerId === 'p1');
}

// ---- 13. Custom names + host rename ----
{
  const g = new Game();
  g.addPlayer('a', '  Speedy <b>Gonzales</b>  ');
  check('names: custom name sanitized', g.players[0].name === 'Speedy bGonzales');
  g.addPlayer('b', '');
  check('names: empty input falls back to default', g.players[1].name === 'Player 2');
  g.addPlayer('c', 'player 2');
  check('names: duplicate gets suffixed', g.players[2].name === 'player 2 (3)');
  check('names: non-host rename rejected', !!g.rename('b', 'Sneaky').error);
  g.rename('a', 'TheHost');
  check('names: host rename works', g.players[0].name === 'TheHost');
  check('names: empty rename rejected', !!g.rename('a', '   ').error);
  check('names: nextDefaultName advertised', g.publicState().nextDefaultName === 'Player 4');
}

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
