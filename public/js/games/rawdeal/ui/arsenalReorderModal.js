window.RawDeal = window.RawDeal || {};

/**
 * Modal for reordering the top cards of a player's Arsenal (e.g. Hmmm).
 */
window.RawDeal.ArsenalReorderModal = class ArsenalReorderModal {
  constructor(rootEl) {
    this.root = rootEl;
    this.messageEl = rootEl.querySelector('[data-rd-arsenal-reorder-message]');
    this.cardsEl = rootEl.querySelector('[data-rd-arsenal-reorder-cards]');
    this.shuffleBtn = rootEl.querySelector('[data-rd-arsenal-reorder-shuffle]');
    this.confirmBtn = rootEl.querySelector('[data-rd-arsenal-reorder-confirm]');
    this.onShuffle = null;
    this.onConfirm = null;
    this.onReorder = null;
    this._prompt = null;
    this._sortable = null;

    this.shuffleBtn?.addEventListener('click', () => {
      this.hide();
      if (this.onShuffle) this.onShuffle();
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
    this._destroySortable();
    this.root.classList.add('hidden');
    this._prompt = null;
    if (this.cardsEl) {
      window.RawDeal.CardRenderer.clearContainer(this.cardsEl);
    }
  }

  _destroySortable() {
    if (this._sortable) {
      this._sortable.destroy();
      this._sortable = null;
    }
  }

  _renderCards() {
    if (!this.cardsEl || !this._prompt) return;

    this._destroySortable();
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
      slot.appendChild(el);
      row.appendChild(slot);
    }

    this.cardsEl.appendChild(row);
    this._initSortable(row);
    this._updateScroll();
  }

  _initSortable(row) {
    if (typeof Sortable === 'undefined') return;

    this._sortable = Sortable.create(row, {
      direction: 'horizontal',
      animation: 180,
      easing: 'cubic-bezier(0.25, 0.8, 0.25, 1)',
      draggable: '.rd-arsenal-reorder-modal__slot',
      ghostClass: 'rd-arsenal-reorder-modal__ghost',
      chosenClass: 'rd-arsenal-reorder-modal__chosen',
      dragClass: 'rd-arsenal-reorder-modal__drag',
      dataIdAttr: 'data-instance-id',
      forceFallback: true,
      fallbackTolerance: 3,
      scroll: this.cardsEl,
      scrollSensitivity: 48,
      scrollSpeed: 12,
      onEnd: () => this._syncOrderFromDom(),
    });
  }

  _syncOrderFromDom() {
    if (!this._sortable || !this._prompt) return;

    const ids = this._sortable.toArray();
    const prevKey = (this._prompt.orderedIds || []).join(',');
    const nextKey = ids.join(',');
    if (prevKey === nextKey) return;

    this._prompt.orderedIds = ids;
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