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

  /** Fortitude required to play from hand. Hybrid discard-to-draw actions cost 0. */
  playFortitudeCost(card, playAs = 'maneuver') {
    if (playAs === 'action' && this.isHybrid(card) && card.actionEffect === 'discardToDraw') {
      return 0;
    }
    return card.fortitude || 0;
  },

  getStunValue(card) {
    return card?.stunValue || 0;
  },

  actionHint(card) {
    if (card.actionEffect === 'discardToDraw') {
      const n = card.actionEffectValue || 1;
      return `Discard · Draw ${n}`;
    }
    return 'Action';
  },

  /**
   * Whether a reversal card can stop a maneuver. effectiveDamage should include
   * all modifiers (Haymaker, Irish Whip, etc.) when known.
   */
  canReverseManeuver(reversalCard, maneuver, defenderFortitude, effectiveDamage = null) {
    const canReverse =
      this.hasType(reversalCard, 'reversal') ||
      (reversalCard.reverses && reversalCard.reverses.length > 0);
    if (!canReverse || !reversalCard.reverses) return false;

    const reversalCost = reversalCard.fortitude || 0;
    if (defenderFortitude < reversalCost) return false;

    const damage = effectiveDamage ?? (maneuver.damage || 0);

    if (reversalCard.reverses.includes('low-damage')) {
      return damage <= (reversalCard.maxDamage ?? 7);
    }

    const subtype = maneuver.subtype || '';
    if (subtype && reversalCard.reverses.includes(subtype)) return true;
    if (reversalCard.reverses.includes('strike') && subtype === 'strike') return true;
    if (reversalCard.reverses.includes('grapple') && subtype === 'grapple') return true;
    if (reversalCard.reverses.includes('submission') && subtype === 'submission') return true;
    if (
      reversalCard.reverses.includes('strike') &&
      reversalCard.reverses.includes('grapple') &&
      reversalCard.reverses.includes('submission')
    ) {
      return ['strike', 'grapple', 'submission', 'high-risk'].includes(subtype);
    }
    return false;
  },
};