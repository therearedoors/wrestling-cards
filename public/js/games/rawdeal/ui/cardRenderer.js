window.RawDeal = window.RawDeal || {};

window.RawDeal.CardRenderer = {
  createCardEl(card, options = {}) {
    const {
      clickable = false,
      faceDown = false,
      small = false,
      preview = false,
      onClick,
      playZones = null,
    } = options;
    const utils = window.RawDeal.CardUtils;
    const types = utils.getTypes(card);
    const isHybrid = !faceDown && !small && utils.isHybrid(card);

    const el = document.createElement('div');
    el.className = 'rd-card';
    if (small) el.classList.add('rd-card--small');
    if (preview) el.classList.add('rd-card--preview');
    if (faceDown) el.classList.add('rd-card--face-down');
    if (clickable) el.classList.add('rd-card--clickable');
    if (isHybrid) {
      el.classList.add('rd-card--hybrid');
      el.style.setProperty('--hybrid-cols', String(types.length));
    }
    if (!faceDown && !preview) el.classList.add('rd-card--hoverable');
    el.dataset.instanceId = card.instanceId || '';
    el.dataset.cardId = card.id || '';

    const color = window.RawDeal.CARD_COLORS[utils.primaryType(card)] || '#555';
    el.style.setProperty('--card-color', color);

    if (!faceDown) {
      if (isHybrid) {
        el.innerHTML = this._hybridFrontHtml(card, types, playZones);
      } else {
        el.innerHTML = `
          <div class="rd-card__inner">
            <div class="rd-card__face rd-card__front">
              <span class="rd-card__type">${this._typeLabel(card)}</span>
              <span class="rd-card__name">${card.name}</span>
              <div class="rd-card__stats">
                ${card.handSize !== undefined ? `<span class="rd-card__hand">H ${card.handSize}</span>` : ''}
                ${card.superstarValue !== undefined ? `<span class="rd-card__sv">SV ${card.superstarValue}</span>` : ''}
                ${card.fortitude !== undefined ? `<span class="rd-card__fort">F ${card.fortitude}</span>` : ''}
                ${card.damage ? `<span class="rd-card__dmg">D ${card.damage}</span>` : ''}
                ${card.stunValue ? `<span class="rd-card__sv">SV ${card.stunValue}</span>` : ''}
              </div>
            </div>
            <div class="rd-card__face rd-card__back">
              <span class="rd-card__back-logo">RAW DEAL</span>
            </div>
          </div>
        `;
      }
    } else {
      el.innerHTML = `
        <div class="rd-card__inner">
          <div class="rd-card__face rd-card__back rd-card__back--solo">
            <span class="rd-card__back-logo">RAW DEAL</span>
          </div>
        </div>
      `;
    }

    if (isHybrid && playZones) {
      this._bindPlayZones(el, playZones);
    } else if (clickable && onClick) {
      el.addEventListener('click', onClick);
    }

    return el;
  },

  _hybridFrontHtml(card, types, playZones) {
    const utils = window.RawDeal.CardUtils;
    const zones = types
      .map((type) => {
        const zone = playZones?.[type];
        const playable = zone?.playable;
        const disabled = zone && !playable;
        const classes = [
          'rd-card__zone',
          `rd-card__zone--${type}`,
          playable ? 'rd-card__zone--playable' : '',
          disabled ? 'rd-card__zone--disabled' : '',
        ]
          .filter(Boolean)
          .join(' ');

        let stats = '';
        if (type === 'maneuver') {
          if (card.damage) stats += `<span class="rd-card__zone-stat">D ${card.damage}</span>`;
          if (card.fortitude !== undefined) {
            stats += `<span class="rd-card__zone-stat">F ${card.fortitude}</span>`;
          }
        } else if (type === 'action') {
          stats += `<span class="rd-card__zone-stat">${utils.actionHint(card)}</span>`;
        } else if (type === 'reversal') {
          stats += `<span class="rd-card__zone-stat">Reversal</span>`;
        }

        const tag = playZones ? 'button' : 'div';
        const attrs = playZones
          ? `type="button" data-play-as="${type}"${disabled ? ' disabled' : ''}`
          : `data-play-as="${type}"`;
        return `<${tag} class="${classes}" ${attrs}>
          <span class="rd-card__zone-kind">${utils.typeLabel(card, type)}</span>
          ${stats}
        </${tag}>`;
      })
      .join('');

    const titleBands = types
      .map((type) => `<span class="rd-card__hybrid-color rd-card__hybrid-color--${type}"></span>`)
      .join('');

    return `
      <div class="rd-card__inner">
        <div class="rd-card__face rd-card__front rd-card__front--hybrid">
          <div class="rd-card__hybrid-header">
            <div class="rd-card__hybrid-header-colors" aria-hidden="true">${titleBands}</div>
            <span class="rd-card__hybrid-name">${card.name}</span>
          </div>
          <div class="rd-card__zones">${zones}</div>
        </div>
        <div class="rd-card__face rd-card__back">
          <span class="rd-card__back-logo">RAW DEAL</span>
        </div>
      </div>
    `;
  },

  _bindPlayZones(el, playZones) {
    for (const [mode, zone] of Object.entries(playZones)) {
      if (!zone?.onClick) continue;
      const btn = el.querySelector(`[data-play-as="${mode}"]`);
      if (!btn || btn.disabled) continue;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        zone.onClick();
      });
    }
  },

  _typeLabel(card) {
    const utils = window.RawDeal.CardUtils;
    if (utils.isHybrid(card)) return utils.typesLabel(card);
    return utils.typeLabel(card, utils.primaryType(card));
  },

  clearContainer(container) {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  },
};