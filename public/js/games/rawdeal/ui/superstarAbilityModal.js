window.RawDeal = window.RawDeal || {};

/**
 * Modal for Ringside card selection (superstar abilities, Roll Out of the Ring, etc.).
 */
window.RawDeal.SuperstarAbilityModal = class SuperstarAbilityModal {
  constructor(rootEl) {
    this.root = rootEl;
    this.messageEl = rootEl.querySelector('[data-rd-superstar-ability-message]');
    this.cardsEl = rootEl.querySelector('[data-rd-superstar-ability-cards]');
    this.passBtn = rootEl.querySelector('[data-rd-superstar-ability-pass]');
    this.confirmBtn = rootEl.querySelector('[data-rd-superstar-ability-confirm]');
    this.onPass = null;
    this.onConfirm = null;
    this.onToggleSelect = null;
    this._prompt = null;

    this.passBtn?.addEventListener('click', () => {
      this.hide();
      if (this.onPass) this.onPass();
    });

    this.confirmBtn?.addEventListener('click', () => {
      if (!this._prompt || !this._canConfirm(this._prompt)) return;
      const selection = this._selectionForConfirm(this._prompt);
      this.hide();
      if (this.onConfirm) this.onConfirm(selection);
    });
  }

  _selectCount(prompt) {
    return prompt.selectCount ?? 1;
  }

  _selectedIds(prompt) {
    if (prompt.selectedIds?.length) {
      return prompt.selectedIds;
    }
    return prompt.selectedId ? [prompt.selectedId] : [];
  }

  _isSelected(prompt, instanceId) {
    return this._selectedIds(prompt).includes(instanceId);
  }

  _canConfirm(prompt) {
    const selected = this._selectedIds(prompt);
    if (prompt.upTo) {
      const max = prompt.maxSelect ?? this._selectCount(prompt);
      return selected.length <= max;
    }
    return selected.length === this._selectCount(prompt);
  }

  _selectionForConfirm(prompt) {
    const selected = this._selectedIds(prompt);
    if (prompt.upTo || this._selectCount(prompt) > 1) {
      return [...selected];
    }
    return selected[0];
  }

  _toggleLocalSelection(instanceId) {
    if (!this._prompt) return;

    const prompt = this._prompt;
    const selectCount = this._selectCount(prompt);
    const maxSelect = prompt.maxSelect ?? prompt.selectCount ?? selectCount;
    const upTo = !!prompt.upTo;
    let selected = [...this._selectedIds(prompt)];

    if (selected.includes(instanceId)) {
      if (upTo) {
        selected = selected.filter((id) => id !== instanceId);
      }
    } else if (upTo) {
      if (selected.length < maxSelect) {
        selected.push(instanceId);
      }
    } else if (selectCount === 1) {
      selected = [instanceId];
    } else if (selected.length < selectCount) {
      selected.push(instanceId);
    }

    this._prompt = {
      ...prompt,
      selectedIds: selected,
      selectedId: selectCount === 1 && !upTo ? selected[0] || null : prompt.selectedId,
    };
    this._syncSelectionUi();
  }

  _syncSelectionUi() {
    const prompt = this._prompt;
    if (!prompt) return;

    if (this.confirmBtn) {
      this.confirmBtn.disabled = !this._canConfirm(prompt);
    }

    if (!this.cardsEl) return;

    for (const el of this.cardsEl.querySelectorAll('[data-instance-id]')) {
      const selected = this._isSelected(prompt, el.dataset.instanceId);
      el.classList.toggle('rd-card--selected', selected);
    }
  }

  show(prompt) {
    if (!prompt) {
      this.hide();
      return;
    }

    this._prompt = prompt;
    this.root.classList.remove('hidden');

    if (this.messageEl) {
      this.messageEl.textContent = prompt.message || 'Choose from Ringside';
    }

    if (this.passBtn) {
      const showPass = prompt.allowPass !== false;
      this.passBtn.classList.toggle('hidden', !showPass);
      this.passBtn.disabled = !showPass;
    }

    if (this.cardsEl) {
      window.RawDeal.CardRenderer.clearContainer(this.cardsEl);
      const row = document.createElement('div');
      row.className = 'rd-hand';

      for (const card of prompt.cards || []) {
        const el = window.RawDeal.CardRenderer.createCardEl(card, {
          small: true,
          clickable: true,
          onClick: (e) => {
            e.stopPropagation();
            this._toggleLocalSelection(card.instanceId);
            if (this.onToggleSelect) this.onToggleSelect(card.instanceId);
          },
        });
        row.appendChild(el);
      }

      this.cardsEl.appendChild(row);
      this._syncSelectionUi();
      this._updateScroll();
    } else {
      this._syncSelectionUi();
    }
  }

  hide() {
    this.root.classList.add('hidden');
    this._prompt = null;
    if (this.cardsEl) {
      window.RawDeal.CardRenderer.clearContainer(this.cardsEl);
    }
  }

  _updateScroll() {
    if (!this.cardsEl) return;
    requestAnimationFrame(() => {
      const overflows = this.cardsEl.scrollWidth > this.cardsEl.clientWidth + 1;
      this.cardsEl.classList.toggle('rd-superstar-ability-modal__scroll--overflow', overflows);
    });
  }
};