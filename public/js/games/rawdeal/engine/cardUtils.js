window.RawDeal = window.RawDeal || {};

window.RawDeal.CardUtils = {
  HAND_PLAY_MODES: ['maneuver', 'action'],

  getTypes(card) {
    if (!card?.types?.length) return [];
    return card.types;
  },

  isHybrid(card) {
    return this.getTypes(card).length > 1;
  },

  hasType(card, type) {
    return this.getTypes(card).includes(type);
  },

  isSuperstar(card) {
    return this.hasType(card, 'superstar');
  },

  primaryType(card) {
    return this.getTypes(card)[0] || 'maneuver';
  },

  typeLabel(card, type) {
    if (type === 'maneuver' && card.subtype) {
      return card.subtype.replace(/-/g, ' ');
    }
    return type.charAt(0).toUpperCase() + type.slice(1);
  },

  typesLabel(card) {
    return this.getTypes(card).map((t) => this.typeLabel(card, t)).join(' / ');
  },

  canPlayFromHandAs(card, playAs) {
    if (!this.HAND_PLAY_MODES.includes(playAs)) return false;
    return this.hasType(card, playAs);
  },

  meetsPlayRequirement(player, card, playAs = 'maneuver') {
    if (playAs !== 'maneuver' || !card.requiresPlayed) return true;
    const state = player.turnState || {};
    if (card.requiresPlayed === 'irish-whip') return !!state.irishWhipPlayed;
    return true;
  },


  _hasDiscardSelfToDraw(card) {
    return card.actionEffects?.some((step) => step.op === 'discardSelfToDraw');
  },

  /** Fortitude required to play from hand. Hybrid discard-to-draw actions cost 0. */
  playFortitudeCost(card, playAs = 'maneuver', player = null) {
    if (playAs === 'action' && this.isHybrid(card) && this._hasDiscardSelfToDraw(card)) {
      return 0;
    }

    let cost = card.fortitude || 0;
    const discount = card.discountAfterCard;
    if (player && discount?.cardId && discount.fortitude) {
      if (player.turnState?.lastPlayedCardId === discount.cardId) {
        cost = Math.max(0, cost - discount.fortitude);
      }
    }
    return cost;
  },

  getStunValue(card) {
    return card?.stunValue || 0;
  },

  /** Printed damage dealt when this reversal is played from hand. */
  getReversalFromHandDamage(card) {
    if (!this.hasType(card, 'reversal')) return 0;
    if (card.reversalEffects?.some((s) => s.op === 'dealDamage')) return card.damage || 0;
    return 0;
  },

  actionHint(card) {
    const step = card.actionEffects?.find((s) => s.op === 'discardSelfToDraw');
    if (step) {
      const n = step.count || 1;
      return `Discard · Draw ${n}`;
    }
    return 'Action';
  },

  /**
   * Whether a reversal card can stop a maneuver. effectiveDamage should include
   * all modifiers (Haymaker, Irish Whip, etc.) when known.
   * options.afterIrishWhip — attacker played Irish Whip before this maneuver this turn.
   */
  canReverseManeuver(reversalCard, maneuver, defenderFortitude, effectiveDamage = null, options = {}) {
    const canReverse =
      this.hasType(reversalCard, 'reversal') ||
      (reversalCard.reverses && reversalCard.reverses.length > 0);
    if (!canReverse || !reversalCard.reverses) return false;

    const { afterIrishWhip = false, reversalFortitudeTax = 0 } = options;
    const reversalCost = (reversalCard.fortitude || 0) + reversalFortitudeTax;
    if (defenderFortitude < reversalCost) return false;

    const damage = effectiveDamage ?? (maneuver.damage || 0);
    const reverses = reversalCard.reverses;

    if (reverses.includes('irish-whip') && maneuver.id === 'irish-whip') return true;

    if (reverses.includes('after-irish-whip') && afterIrishWhip) {
      return true;
    }

    if (reverses.includes('low-damage') && damage <= (reversalCard.maxDamage ?? 7)) {
      return true;
    }

    const subtype = maneuver.subtype || '';
    if (subtype && reverses.includes(subtype)) return true;
    if (reverses.includes('strike') && subtype === 'strike') return true;
    if (reverses.includes('grapple') && subtype === 'grapple') return true;
    if (reverses.includes('submission') && subtype === 'submission') return true;
    if (
      reverses.includes('strike') &&
      reverses.includes('grapple') &&
      reverses.includes('submission')
    ) {
      return ['strike', 'grapple', 'submission', 'high-risk'].includes(subtype);
    }
    return false;
  },

  /** Whether a reversal can stop an action played from hand. */
  canReverseAction(reversalCard, actionCard, defenderFortitude) {
    const canReverse =
      this.hasType(reversalCard, 'reversal') ||
      (reversalCard.reverses && reversalCard.reverses.length > 0);
    if (!canReverse || !this.hasType(actionCard, 'action')) return false;

    const reversalCost = reversalCard.fortitude || 0;
    if (defenderFortitude < reversalCost) return false;

    const reverses = reversalCard.reverses || [];
    if (reverses.includes('action')) return true;
    if (reverses.includes('irish-whip') && actionCard.id === 'irish-whip') return true;
    if (reverses.includes('jockeying-for-position') && actionCard.id === 'jockeying-for-position') {
      return true;
    }
    return false;
  },
};