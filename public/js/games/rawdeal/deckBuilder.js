(function () {
  const deckSelect = document.getElementById('rd-db-deck-select');
  const superstarSelect = document.getElementById('rd-db-superstar-select');
  const opponentSelect = document.getElementById('rd-db-opponent-select');
  const nameInput = document.getElementById('rd-db-deck-name');
  const searchInput = document.getElementById('rd-db-search');
  const catalogEl = document.getElementById('rd-db-catalog');
  const totalEl = document.getElementById('rd-db-total');
  const alignmentEl = document.getElementById('rd-db-alignment');
  const statusEl = document.getElementById('rd-db-status');
  const errorsEl = document.getElementById('rd-db-errors');
  const saveBtn = document.getElementById('rd-db-save');
  const resetBtn = document.getElementById('rd-db-reset');
  const previewRoot = document.getElementById('rd-card-preview');

  if (!deckSelect || !catalogEl) return;

  const cardPreview = previewRoot ? new window.RawDeal.CardPreview(previewRoot) : null;
  const store = window.RawDeal.DeckStore;

  const SUPERSTARS = [
    { id: 'the-rock', name: 'The Rock' },
    { id: 'stone-cold', name: '"Stone Cold" Steve Austin' },
    { id: 'undertaker', name: 'The Undertaker' },
    { id: 'mankind', name: 'Mankind' },
    { id: 'hhh', name: 'Triple H' },
    { id: 'kane', name: 'Kane' },
    { id: 'jericho', name: 'Chris Jericho' },
  ];

  let currentDeckId = deckSelect.value || 'rock';
  let counts = {};
  let filter = '';

  function sortedCards() {
    return Object.values(window.RawDeal.CARDS).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  function loadDeckState(deckId) {
    currentDeckId = deckId;
    const meta = store.getDefaultDeckMeta(deckId);
    const override = store.overrides[deckId];
    const resolved = store.resolveDeck(deckId, override);

    counts = { ...(override?.cards ?? meta.cards) };
    nameInput.value = resolved.name;
    superstarSelect.value = resolved.superstarId;
    opponentSelect.value = resolved.defaultOpponent;

    renderCatalog();
    updateValidation();
  }

  function setCount(cardId, value) {
    const card = window.RawDeal.CARDS[cardId];
    const max = card?.unique ? 1 : 3;
    counts[cardId] = Math.max(0, Math.min(max, value));
    if (counts[cardId] === 0) delete counts[cardId];
    updateValidation();
  }

  function formatAlignmentLabel(alignment) {
    if (alignment === 'face') return 'Face';
    if (alignment === 'heel') return 'Heel';
    return '—';
  }

  function cardConflictsWithDeck(card, deckAlignment) {
    if (!deckAlignment || deckAlignment === 'mixed' || !card?.alignment) return false;
    return card.alignment !== deckAlignment;
  }

  function updateRow(cardId, deckAlignment) {
    const row = catalogEl.querySelector(`[data-card-id="${cardId}"]`);
    if (!row) return;
    const count = counts[cardId] || 0;
    const card = window.RawDeal.CARDS[cardId];
    const countEl = row.querySelector('[data-rd-count]');
    const minusBtn = row.querySelector('[data-rd-minus]');
    const plusBtn = row.querySelector('[data-rd-plus]');
    const blocked = cardConflictsWithDeck(card, deckAlignment);
    if (countEl) countEl.textContent = String(count);
    if (minusBtn) minusBtn.disabled = count <= 0;
    if (plusBtn) {
      const max = card?.unique ? 1 : 3;
      plusBtn.disabled = count >= max || blocked;
    }
    row.classList.toggle('rd-db-row--active', count > 0);
    row.classList.toggle('rd-db-row--blocked', blocked && count === 0);
  }

  function updateValidation() {
    const errors = store.validateDeck(counts);
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    const deckAlignment = store.getDeckAlignment(counts);

    totalEl.textContent = String(total);
    totalEl.classList.toggle('rd-db-total--valid', total === 60);
    totalEl.classList.toggle('rd-db-total--invalid', total !== 60);

    if (alignmentEl) {
      alignmentEl.textContent = formatAlignmentLabel(deckAlignment);
      alignmentEl.classList.remove('rd-db-alignment--face', 'rd-db-alignment--heel');
      if (deckAlignment === 'face') alignmentEl.classList.add('rd-db-alignment--face');
      if (deckAlignment === 'heel') alignmentEl.classList.add('rd-db-alignment--heel');
    }

    for (const row of catalogEl.querySelectorAll('[data-card-id]')) {
      updateRow(row.dataset.cardId, deckAlignment);
    }

    if (errors.length) {
      errorsEl.textContent = errors.join(' · ');
      errorsEl.classList.remove('hidden');
    } else {
      errorsEl.textContent = '';
      errorsEl.classList.add('hidden');
    }

    saveBtn.disabled = errors.length > 0;
    return { errors, deckAlignment };
  }

  function renderCatalog() {
    catalogEl.innerHTML = '';
    const deckAlignment = store.getDeckAlignment(counts);
    const cards = sortedCards().filter((card) => {
      if (!filter) return true;
      const q = filter.toLowerCase();
      return (
        card.name.toLowerCase().includes(q) ||
        card.id.toLowerCase().includes(q)
      );
    });

    for (const card of cards) {
      const row = document.createElement('div');
      row.className = 'rd-db-row';
      row.dataset.cardId = card.id;
      const count = counts[card.id] || 0;
      if (count > 0) row.classList.add('rd-db-row--active');

      const info = document.createElement('div');
      info.className = 'rd-db-row__info';

      const name = document.createElement('span');
      name.className = 'rd-db-row__name';
      name.textContent = card.name;

      const meta = document.createElement('span');
      meta.className = 'rd-db-row__meta';
      const types = (card.types || []).join(', ');
      const alignmentPart = card.alignment
        ? ` · ${card.alignment.charAt(0).toUpperCase() + card.alignment.slice(1)}`
        : '';
      meta.textContent = `${card.id}${card.unique ? ' · unique' : ''} · ${types}${alignmentPart}`;

      info.append(name, meta);

      const stepper = document.createElement('div');
      stepper.className = 'rd-db-stepper';

      const minusBtn = document.createElement('button');
      minusBtn.type = 'button';
      minusBtn.className = 'rd-db-stepper__btn';
      minusBtn.dataset.rdMinus = '';
      minusBtn.textContent = '−';
      minusBtn.disabled = count <= 0;
      minusBtn.addEventListener('click', () => setCount(card.id, (counts[card.id] || 0) - 1));

      const countEl = document.createElement('span');
      countEl.className = 'rd-db-stepper__count';
      countEl.dataset.rdCount = '';
      countEl.textContent = String(count);

      const plusBtn = document.createElement('button');
      plusBtn.type = 'button';
      plusBtn.className = 'rd-db-stepper__btn';
      plusBtn.dataset.rdPlus = '';
      plusBtn.textContent = '+';
      const max = card.unique ? 1 : 3;
      const blocked = cardConflictsWithDeck(card, deckAlignment);
      plusBtn.disabled = count >= max || blocked;
      plusBtn.addEventListener('click', () => setCount(card.id, (counts[card.id] || 0) + 1));

      stepper.append(minusBtn, countEl, plusBtn);

      row.append(info, stepper);
      if (blocked && count === 0) row.classList.add('rd-db-row--blocked');
      row.addEventListener('mouseenter', () => cardPreview?.show(card));
      catalogEl.appendChild(row);
    }
  }

  function setStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle('rd-db-status--error', isError);
    statusEl.classList.toggle('hidden', !message);
  }

  deckSelect.addEventListener('change', () => loadDeckState(deckSelect.value));

  searchInput?.addEventListener('input', () => {
    filter = searchInput.value.trim();
    renderCatalog();
  });

  saveBtn?.addEventListener('click', async () => {
    const { errors } = updateValidation();
    if (errors.length) return;

    saveBtn.disabled = true;
    setStatus('Saving…');

    try {
      await store.saveDeck(currentDeckId, {
        name: nameInput.value.trim(),
        superstarId: superstarSelect.value,
        defaultOpponent: opponentSelect.value,
        cards: { ...counts },
      });
      setStatus('Deck saved.');
    } catch (err) {
      setStatus(err.message || 'Save failed', true);
    } finally {
      saveBtn.disabled = store.validateDeck(counts).length > 0;
    }
  });

  resetBtn?.addEventListener('click', async () => {
    if (!confirm('Reset this deck to the default starter list?')) return;

    resetBtn.disabled = true;
    setStatus('Resetting…');

    try {
      if (store.overrides[currentDeckId]) {
        await store.resetDeck(currentDeckId);
      }
      loadDeckState(currentDeckId);
      setStatus('Deck reset to default.');
    } catch (err) {
      setStatus(err.message || 'Reset failed', true);
    } finally {
      resetBtn.disabled = false;
    }
  });

  store.load().then(() => {
    loadDeckState(currentDeckId);
  }).catch((err) => {
    console.warn('deckBuilder load:', err);
    loadDeckState(currentDeckId);
  });
})();