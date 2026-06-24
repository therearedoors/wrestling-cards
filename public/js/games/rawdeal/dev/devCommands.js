window.RawDeal = window.RawDeal || {};

window.RawDeal.DevCommands = {
  resolveCardId(input) {
    const cardId = (input || '').trim().toLowerCase();
    if (!cardId) return { error: 'Card id required.' };
    if (!window.RawDeal.CARDS[cardId]) {
      return { error: `Unknown card: ${input}. Use exact card id (e.g. irish-whip).` };
    }
    return { cardId };
  },

  execute(engine, line, options = {}) {
    const trimmed = (line || '').trim();
    if (!trimmed) return { ok: false, message: '' };

    const mySeat = options.mySeat ?? 0;
    const oppSeat = 1 - mySeat;

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === 'help') {
      return {
        ok: true,
        message: [
          'Commands:',
          '  draw <card-id>     — add card to your hand',
          '  stack <card-id> [n] — put n cards on top of opponent Arsenal (default 1)',
          '  cards              — list all card ids',
          '  help               — this message',
        ].join('\n'),
      };
    }

    if (cmd === 'cards') {
      const ids = Object.keys(window.RawDeal.CARDS).sort();
      return { ok: true, message: ids.join('\n') };
    }

    if (cmd === 'draw') {
      const resolved = this.resolveCardId(parts[1]);
      if (resolved.error) return { ok: false, message: resolved.error };
      const ok = engine.devGiveCard(mySeat, resolved.cardId);
      return ok
        ? { ok: true, message: `Drew ${resolved.cardId} to hand.` }
        : { ok: false, message: 'Could not draw card.' };
    }

    if (cmd === 'stack') {
      const resolved = this.resolveCardId(parts[1]);
      if (resolved.error) return { ok: false, message: resolved.error };
      const count = parts[2] ? parseInt(parts[2], 10) : 1;
      if (!Number.isFinite(count) || count < 1) {
        return { ok: false, message: 'Count must be a positive number.' };
      }
      const stacked = engine.devStackArsenal(oppSeat, resolved.cardId, count);
      return {
        ok: true,
        message: `Stacked ${stacked}× ${resolved.cardId} on opponent Arsenal.`,
      };
    }

    return { ok: false, message: `Unknown command: ${cmd}. Type help.` };
  },
};