window.RawDeal = window.RawDeal || {};

window.RawDeal.CardRenderer = {
  createCardEl(card, options = {}) {
    const { clickable = false, faceDown = false, small = false, preview = false, onClick } = options;
    const el = document.createElement('div');
    el.className = 'rd-card';
    if (small) el.classList.add('rd-card--small');
    if (preview) el.classList.add('rd-card--preview');
    if (faceDown) el.classList.add('rd-card--face-down');
    if (clickable) el.classList.add('rd-card--clickable');
    if (!faceDown && !preview) el.classList.add('rd-card--hoverable');
    el.dataset.instanceId = card.instanceId || '';
    el.dataset.cardId = card.id || '';

    const color = window.RawDeal.CARD_COLORS[card.type] || '#555';
    el.style.setProperty('--card-color', color);

    if (!faceDown) {
      el.innerHTML = `
        <div class="rd-card__inner">
          <div class="rd-card__face rd-card__front">
            <span class="rd-card__type">${this._typeLabel(card)}</span>
            <span class="rd-card__name">${card.name}</span>
            <div class="rd-card__stats">
              ${card.fortitude !== undefined ? `<span class="rd-card__fort">F ${card.fortitude}</span>` : ''}
              ${card.damage ? `<span class="rd-card__dmg">D ${card.damage}</span>` : ''}
            </div>
          </div>
          <div class="rd-card__face rd-card__back">
            <span class="rd-card__back-logo">RAW DEAL</span>
          </div>
        </div>
      `;
    } else {
      el.innerHTML = `
        <div class="rd-card__inner">
          <div class="rd-card__face rd-card__back rd-card__back--solo">
            <span class="rd-card__back-logo">RAW DEAL</span>
          </div>
        </div>
      `;
    }

    if (clickable && onClick) {
      el.addEventListener('click', onClick);
    }

    return el;
  },

  _typeLabel(card) {
    if (card.type === 'maneuver' && card.subtype) {
      return card.subtype.replace(/-/g, ' ');
    }
    return card.type || '';
  },

  clearContainer(container) {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  },
};