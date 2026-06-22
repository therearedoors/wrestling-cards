window.RawDeal = window.RawDeal || {};

window.RawDeal.DeckStore = {
  overrides: {},
  resolvedDecks: null,

  buildDeck(counts) {
    const arsenal = [];
    let i = 0;
    for (const [id, count] of Object.entries(counts)) {
      const base = window.RawDeal.CARDS[id];
      if (!base) {
        console.warn('Missing card:', id);
        continue;
      }
      for (let c = 0; c < count; c++) {
        arsenal.push({ ...base, instanceId: `${id}-${i++}` });
      }
    }
    return arsenal;
  },

  arsenalToCounts(arsenal) {
    const counts = {};
    for (const card of arsenal) {
      counts[card.id] = (counts[card.id] || 0) + 1;
    }
    return counts;
  },

  validateDeck(counts) {
    const errors = [];
    let total = 0;

    for (const [cardId, count] of Object.entries(counts)) {
      if (count < 0 || count > 3) {
        errors.push(`${cardId}: count must be 0–3`);
        continue;
      }
      if (count === 0) continue;

      const card = window.RawDeal.CARDS[cardId];
      if (!card) {
        errors.push(`${cardId}: unknown card`);
        continue;
      }
      if (card.unique && count > 1) {
        errors.push(`${cardId}: unique (max 1)`);
      }
      total += count;
    }

    if (total !== 60) errors.push(`Deck must have 60 cards (has ${total})`);
    return errors;
  },

  getDefaultDeckMeta(deckId) {
    const deck = window.RawDeal.DECKS[deckId];
    if (!deck) return null;
    return {
      id: deck.id,
      name: deck.name,
      superstarId: deck.superstarId,
      defaultOpponent: deck.defaultOpponent,
      cards: this.arsenalToCounts(deck.arsenal),
    };
  },

  resolveDeck(deckId, override) {
    const defaultDeck = window.RawDeal.DECKS[deckId];
    if (!defaultDeck) return null;

    const cards = override?.cards ?? this.arsenalToCounts(defaultDeck.arsenal);
    return {
      id: deckId,
      name: override?.name ?? defaultDeck.name,
      superstarId: override?.superstarId ?? defaultDeck.superstarId,
      defaultOpponent: override?.defaultOpponent ?? defaultDeck.defaultOpponent,
      arsenal: this.buildDeck(cards),
    };
  },

  resolveAllDecks() {
    const resolved = {};
    for (const deckId of Object.keys(window.RawDeal.DECKS)) {
      resolved[deckId] = this.resolveDeck(deckId, this.overrides[deckId]);
    }
    this.resolvedDecks = resolved;
    return resolved;
  },

  getResolvedDecks() {
    return this.resolvedDecks || this.resolveAllDecks();
  },

  hasOverrides() {
    return Object.keys(this.overrides).length > 0;
  },

  async fetchOverrides() {
    const res = await fetch('/api/rawdeal/decks', { credentials: 'same-origin' });
    if (!res.ok) {
      if (res.status === 401) return {};
      throw new Error('Failed to load deck overrides');
    }
    const data = await res.json();
    return data.overrides || {};
  },

  async load() {
    try {
      this.overrides = await this.fetchOverrides();
    } catch (err) {
      console.warn('DeckStore.load:', err);
      this.overrides = {};
    }
    this.resolveAllDecks();
    return this.getResolvedDecks();
  },

  async saveDeck(deckId, payload) {
    const errors = this.validateDeck(payload.cards);
    if (errors.length) throw new Error(errors.join('; '));

    const res = await fetch(`/api/rawdeal/decks/${deckId}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Save failed');
    }

    this.overrides[deckId] = {
      name: payload.name,
      superstarId: payload.superstarId,
      defaultOpponent: payload.defaultOpponent,
      cards: payload.cards,
    };
    this.resolveAllDecks();
  },

  async resetDeck(deckId) {
    const res = await fetch(`/api/rawdeal/decks/${deckId}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Reset failed');
    }

    delete this.overrides[deckId];
    this.resolveAllDecks();
  },
};