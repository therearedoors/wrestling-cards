window.RawDeal = window.RawDeal || {};

/**
 * Reusable choice modal for engine-driven player decisions.
 * Modes:
 * - choice: { message, options: [{ id, label }] }
 * - drawCount: { message, min, max, selected }
 */
window.RawDeal.ChoiceModal = class ChoiceModal {
  constructor(rootEl) {
    this.root = rootEl;
    this.messageEl = rootEl.querySelector('[data-rd-choice-message]');
    this.actionsEl = rootEl.querySelector('[data-rd-choice-actions]');
    this.onSelect = null;
    this.onAdjust = null;
    this.onConfirm = null;
    this._prompt = null;
  }

  show(prompt) {
    if (!prompt) {
      this.hide();
      return;
    }

    if (prompt.mode === 'drawCount') {
      this._showDrawCount(prompt);
      return;
    }

    if (!prompt?.options?.length) {
      this.hide();
      return;
    }

    this._prompt = prompt;
    this.root.classList.remove('hidden');
    if (this.messageEl) {
      this.messageEl.textContent = prompt.message || 'Choose one:';
    }

    if (this.actionsEl) {
      this.actionsEl.innerHTML = '';
      for (const option of prompt.options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rd-btn rd-btn--primary rd-choice-modal__btn';
        btn.textContent = option.label;
        btn.addEventListener('click', () => {
          if (this.onSelect) this.onSelect(option.id);
        });
        this.actionsEl.appendChild(btn);
      }
    }
  }

  _showDrawCount(prompt) {
    this._prompt = prompt;
    this.root.classList.remove('hidden');

    if (this.messageEl) {
      this.messageEl.textContent = prompt.message || 'Draw how many cards?';
    }

    if (!this.actionsEl) return;

    this.actionsEl.innerHTML = '';

    const stepper = document.createElement('div');
    stepper.className = 'rd-choice-modal__stepper';

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'rd-choice-modal__stepper-btn';
    minusBtn.textContent = '−';
    minusBtn.disabled = prompt.selected <= (prompt.min ?? 0);
    minusBtn.addEventListener('click', () => {
      if (this.onAdjust) this.onAdjust(-1);
    });

    const countEl = document.createElement('span');
    countEl.className = 'rd-choice-modal__stepper-count';
    countEl.textContent = String(prompt.selected ?? 0);

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'rd-choice-modal__stepper-btn';
    plusBtn.textContent = '+';
    plusBtn.disabled = prompt.selected >= (prompt.max ?? 0);
    plusBtn.addEventListener('click', () => {
      if (this.onAdjust) this.onAdjust(1);
    });

    stepper.append(minusBtn, countEl, plusBtn);
    this.actionsEl.appendChild(stepper);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'rd-btn rd-btn--primary rd-choice-modal__confirm';
    confirmBtn.textContent = 'Confirm';
    confirmBtn.addEventListener('click', () => {
      if (this.onConfirm) this.onConfirm();
    });
    this.actionsEl.appendChild(confirmBtn);
  }

  hide() {
    this.root.classList.add('hidden');
    this._prompt = null;
    if (this.actionsEl) this.actionsEl.innerHTML = '';
  }
};