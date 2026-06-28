window.RawDeal = window.RawDeal || {};

/**
 * Modal for reordering the top cards of a player's Arsenal (e.g. Hmmm).
 */
window.RawDeal.ArsenalReorderModal = class ArsenalReorderModal {
  constructor(rootEl) {
    this.root = rootEl;
    this.messageEl = rootEl.querySelector('[data-rd-arsenal-reorder-message]');
    this.cardsEl = rootEl.querySelector('[data-rd-arsenal-reorder-cards]');
    this.passBtn = rootEl.querySelector('[data-rd-arsenal-reorder-pass]');
    this.confirmBtn = rootEl.querySelector('[data-rd-arsenal-reorder-confirm]');
    this.onPass = null;
    this.onConfirm = null;
    this.onReorder = null;
    this._prompt = null;
    this._dragId = null;

    this.passBtn?.addEventListener('click', () => {
      this.hide();
      if (this.onPass) this.onPass();
    });

    this.confirmBtn?.addEventListener('click', () => {
      if (!this._prompt) return;
      const orderedIds = [...this._prompt.orderedIds];
      this.hide();
      if (this.onConfirm) this.onConfirm(orderedIds);
    });
  }

  show(prompt) {
    if (!prompt) {
      this.hide();
      return;
    }

    const orderKey = (prompt.orderedIds || []).join(',');
    const prevKey = (this._prompt?.orderedIds || []).join(',');
    const needsRender = orderKey !== prevKey || !this.cardsEl?.querySelector('.rd-arsenal-reorder-modal__row');

    this._prompt = prompt;
    this.root.classList.remove('hidden');

    if (this.messageEl) {
      this.messageEl.textContent = prompt.message || 'Reorder Arsenal cards';
    }

    if (needsRender) {
      this._renderCards();
    }
  }

  hide() {
    this.root.classList.add('hidden');
    this._prompt = null;
    this._dragId = null;
    if (this.cardsEl) {
      window.RawDeal.CardRenderer.clearContainer(this.cardsEl);
    }
  }

  _renderCards() {
    if (!this.cardsEl || !this._prompt) return;

    window.RawDeal.CardRenderer.clearContainer(this.cardsEl);
    const row = document.createElement('div');
    row.className = 'rd-arsenal-reorder-modal__row';

    const byId = new Map((this._prompt.cards || []).map((c) => [c.instanceId, c]));

    for (const id of this._prompt.orderedIds || []) {
      const card = byId.get(id);
      if (!card) continue;

      const slot = document.createElement('div');
      slot.className = 'rd-arsenal-reorder-modal__slot';
      slot.dataset.instanceId = id;

      const el = window.RawDeal.CardRenderer.createCardEl(card, { small: true });
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        this._dragId = id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        el.classList.add('rd-card--dragging');
      });
      el.addEventListener('dragend', () => {
        this._dragId = null;
        el.classList.remove('rd-card--dragging');
      });

      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromId = this._dragId || e.dataTransfer.getData('text/plain');
        if (!fromId || fromId === id) return;
        this._moveCard(fromId, id);
      });

      slot.appendChild(el);
      row.appendChild(slot);
    }

    this.cardsEl.appendChild(row);
    this._updateScroll();
  }

  _moveCard(fromId, toId) {
    const ids = [...(this._prompt.orderedIds || [])];
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;

    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, fromId);
    this._prompt.orderedIds = ids;
    this._renderCards();
    if (this.onReorder) this.onReorder(ids);
  }

  _updateScroll() {
    if (!this.cardsEl) return;
    requestAnimationFrame(() => {
      const overflows = this.cardsEl.scrollWidth > this.cardsEl.clientWidth + 1;
      this.cardsEl.classList.toggle('rd-arsenal-reorder-modal__scroll--overflow', overflows);
    });
  }
};