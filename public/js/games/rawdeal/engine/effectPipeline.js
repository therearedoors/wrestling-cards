window.RawDeal = window.RawDeal || {};

/**
 * Sequential effect runner for actionEffects / onSuccessEffects step arrays.
 */
window.RawDeal.EffectPipeline = {
  start(engine, player, sourceName, steps, timing = 'action') {
    if (!steps?.length) return false;

    const playerIndex = engine._playerIndex(player);
    const opponentIndex = 1 - playerIndex;

    engine.effectPipelineFlow = {
      playerIndex,
      opponentIndex,
      sourceName,
      steps: steps.map((s) => ({ ...s })),
      timing,
      snapshotInstanceIds: null,
      selectedInstanceIds: null,
      paused: false,
      allowSkip: false,
    };

    return this._runUntilPause(engine);
  },

  isPaused(engine, playerIndex) {
    return (
      !!engine.handRevealFlow &&
      engine.handRevealFlow.viewerIndex === playerIndex &&
      !!engine.effectPipelineFlow?.paused
    );
  },

  publicHandReveal(engine, viewerIndex) {
    const flow = engine.handRevealFlow;
    if (!flow || flow.viewerIndex !== viewerIndex) return null;

    const n = flow.cards.length;
    let message = flow.message;
    if (!message) {
      message =
        n === 0
          ? `${flow.sourceName}: opponent has no cards in hand.`
          : `${flow.sourceName}: opponent's hand (${n} card${n === 1 ? '' : 's'}).`;
    }

    if (flow.mode === 'select') {
      const need = flow.selectCount || 1;
      const picked = flow.selectedIds?.length || 0;
      message = `${flow.sourceName}: choose ${need} card${need === 1 ? '' : 's'} from opponent's hand (${picked}/${need}).`;
    }

    return {
      message,
      cards: flow.cards.map((c) => ({ ...c })),
      mode: flow.mode || 'view',
      allowSkip: !!flow.allowSkip,
      selectCount: flow.selectCount || 0,
      selectedIds: [...(flow.selectedIds || [])],
    };
  },

  resume(engine, playerIndex, { skipped = false, selectedIds = null } = {}) {
    const pipeline = engine.effectPipelineFlow;
    if (!pipeline?.paused || pipeline.playerIndex !== playerIndex) return false;

    const reveal = engine.handRevealFlow;
    if (!reveal || reveal.viewerIndex !== playerIndex) return false;

    if (skipped) {
      if (!reveal.allowSkip) return false;
      engine.actionLog.push({
        message: `${pipeline.sourceName}: skipped looking at opponent's hand.`,
      });
    } else if (reveal.mode === 'select') {
      const need = reveal.selectCount || 1;
      const ids = selectedIds || reveal.selectedIds || [];
      if (ids.length !== need) return false;
      const valid = new Set(reveal.cards.map((c) => c.instanceId));
      if (!ids.every((id) => valid.has(id))) return false;
      pipeline.selectedInstanceIds = [...ids];
    }

    engine.handRevealFlow = null;
    pipeline.paused = false;

    this._runUntilPause(engine);
    return true;
  },

  toggleSelection(engine, playerIndex, instanceId) {
    const pipeline = engine.effectPipelineFlow;
    const reveal = engine.handRevealFlow;
    if (!pipeline?.paused || pipeline.playerIndex !== playerIndex) return false;
    if (!reveal || reveal.mode !== 'select') return false;

    const valid = reveal.cards.some((c) => c.instanceId === instanceId);
    if (!valid) return false;

    const need = reveal.selectCount || 1;
    const selected = reveal.selectedIds || [];
    const idx = selected.indexOf(instanceId);

    if (idx >= 0) {
      selected.splice(idx, 1);
    } else if (selected.length < need) {
      selected.push(instanceId);
    } else if (need === 1) {
      selected[0] = instanceId;
    } else {
      return false;
    }

    reveal.selectedIds = selected;
    engine._notify();
    return true;
  },

  _runUntilPause(engine) {
    const pipeline = engine.effectPipelineFlow;
    if (!pipeline) return false;

    while (pipeline.steps.length > 0) {
      const step = pipeline.steps.shift();
      const paused = this._runStep(engine, pipeline, step);
      if (paused) {
        pipeline.paused = true;
        engine._notify();
        return true;
      }
    }

    engine.effectPipelineFlow = null;
    engine._notify();
    return false;
  },

  _runStep(engine, pipeline, step) {
    const player = engine.players[pipeline.playerIndex];
    const opponent = engine.players[pipeline.opponentIndex];
    const { sourceName } = pipeline;

    switch (step.op) {
      case 'draw': {
        const count = step.count || 1;
        for (let i = 0; i < count; i++) {
          engine._drawCard(player);
        }
        engine.actionLog.push({
          message: `${sourceName}: drew ${count} card${count === 1 ? '' : 's'}.`,
        });
        return false;
      }

      case 'revealOpponentHand':
        return this._pauseForReveal(engine, pipeline, player, opponent, step);

      case 'discardFromOpponentHand':
        this._discardFromOpponentHand(engine, pipeline, opponent, sourceName, step);
        return false;

      case 'nextManeuverBonus': {
        const value = step.value || 0;
        engine.nextManeuverBonus[pipeline.playerIndex] += value;
        engine.actionLog.push({
          message: `${sourceName}: next maneuver +${value}D.`,
        });
        return false;
      }

      case 'blockOpponentReversals': {
        if (!player.turnState) player.turnState = engine._emptyTurnState();
        player.turnState.opponentReversalsBlocked = true;
        engine.actionLog.push({
          message: `${sourceName}: opponent's Arsenal reversals cannot reverse your maneuvers this turn.`,
        });
        return false;
      }

      default:
        return false;
    }
  },

  _pauseForReveal(engine, pipeline, player, opponent, step) {
    const viewerIndex = pipeline.playerIndex;
    const cards = opponent.hand.map((c) => ({ ...c }));
    pipeline.snapshotInstanceIds = new Set(cards.map((c) => c.instanceId));

    const selectCount = step.selectCount || 0;
    const mode = selectCount > 0 ? 'select' : 'view';

    engine.handRevealFlow = {
      viewerIndex,
      opponentIndex: pipeline.opponentIndex,
      sourceName: pipeline.sourceName,
      cards,
      mode,
      allowSkip: !!step.optional,
      selectCount,
      selectedIds: [],
    };

    const n = cards.length;
    engine.actionLog.push({
      message:
        n === 0
          ? `${pipeline.sourceName}: opponent has no cards in hand.`
          : `${pipeline.sourceName}: viewing opponent's hand (${n} card${n === 1 ? '' : 's'}).`,
    });

    if (n === 0 && step.optional) {
      engine.handRevealFlow = null;
      return false;
    }

    if (n === 0 && mode === 'select') {
      engine.handRevealFlow = null;
      pipeline.selectedInstanceIds = [];
      return false;
    }

    return true;
  },

  _discardFromOpponentHand(engine, pipeline, opponent, sourceName, step) {
    const snapshot = pipeline.snapshotInstanceIds;
    if (!snapshot?.size) {
      engine.actionLog.push({
        message: `${sourceName}: no cards to discard from opponent's hand.`,
      });
      return;
    }

    let toDiscard = [];

    if (step.mode === 'chosen') {
      const ids = pipeline.selectedInstanceIds || [];
      toDiscard = opponent.hand.filter((c) => ids.includes(c.instanceId) && snapshot.has(c.instanceId));
    } else {
      const filter = step.filter || {};
      toDiscard = opponent.hand.filter(
        (c) => snapshot.has(c.instanceId) && this._cardMatchesFilter(c, filter)
      );
    }

    if (toDiscard.length === 0) {
      engine.actionLog.push({
        message: `${sourceName}: no matching cards in opponent's hand to discard.`,
      });
      return;
    }

    const discardIds = new Set(toDiscard.map((c) => c.instanceId));
    opponent.hand = opponent.hand.filter((c) => !discardIds.has(c.instanceId));
    for (const card of toDiscard) {
      opponent.ringside.push(card);
    }

    const names = toDiscard.map((c) => c.name).join(', ');
    engine.actionLog.push({
      message: `${sourceName}: opponent discarded ${names} to Ringside.`,
    });
  },

  _cardMatchesFilter(card, filter) {
    if (filter.alignment && card.alignment !== filter.alignment) return false;
    if (filter.cardId && card.id !== filter.cardId) return false;
    return true;
  },
};