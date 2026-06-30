window.RawDeal = window.RawDeal || {};

/**
 * Sequential effect runner for actionEffects / maneuverEffects / reversalEffects step arrays.
 */
window.RawDeal.EffectPipeline = {
  async start(engine, player, sourceName, steps, timing = 'action', sourceCard = null) {
    if (!steps?.length) return false;

    const playerIndex = engine._playerIndex(player);
    const opponentIndex = 1 - playerIndex;

    engine.effectPipelineFlow = {
      playerIndex,
      opponentIndex,
      sourceName,
      sourceCard,
      steps: steps.map((s) => ({ ...s })),
      timing,
      snapshotInstanceIds: null,
      selectedInstanceIds: null,
      paused: false,
      allowSkip: false,
    };

    return await this._runUntilPause(engine);
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

  async resume(engine, playerIndex, { skipped = false, selectedIds = null } = {}) {
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
    engine._notify();

    await this._runUntilPause(engine);
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

  async resumeAfterCardEffect(engine) {
    const pipeline = engine.effectPipelineFlow;
    if (!pipeline?.paused) return false;
    pipeline.paused = false;
    await this._runUntilPause(engine);
    return true;
  },

  async _runUntilPause(engine) {
    const pipeline = engine.effectPipelineFlow;
    if (!pipeline) return false;

    while (pipeline.steps.length > 0) {
      const step = pipeline.steps.shift();
      const paused = await this._runStep(engine, pipeline, step);
      if (paused) {
        pipeline.paused = true;
        engine._notify();
        return true;
      }
    }

    const timing = pipeline.timing;
    engine.effectPipelineFlow = null;
    engine._notify();

    if (timing === 'maneuver' && engine.pendingManeuverResolution?.resumeAt === 'maneuver') {
      await engine._continuePendingManeuverDamage();
    } else if (
      timing === 'reversal' &&
      engine.stateMachine.phase !== window.RawDeal.PHASES.GAME_OVER
    ) {
      await engine._finishHandReversalTurn();
    }

    return false;
  },

  async _runStep(engine, pipeline, step) {
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

      case 'drawUpTo':
        return engine._beginDrawUpToPrompt(
          player,
          pipeline.playerIndex,
          sourceName,
          step.max || 3
        );

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

      case 'nextCardManeuverBonus': {
        const value = step.value || 0;
        if (!player.turnState) player.turnState = engine._emptyTurnState();
        player.turnState.nextCardManeuverBonus = value;
        engine.actionLog.push({
          message: `${sourceName}: if your next card played this turn is a maneuver, it is +${value}D.`,
        });
        return false;
      }

      case 'nextCardSubtypeManeuverBonus': {
        const value = step.value || 0;
        const subtype = step.subtype || 'strike';
        if (!player.turnState) player.turnState = engine._emptyTurnState();
        player.turnState.nextCardSubtypeBonus = { subtype, value };
        const label = subtype.charAt(0).toUpperCase() + subtype.slice(1);
        engine.actionLog.push({
          message: `${sourceName}: if your next card played this turn is a ${label} maneuver, it is +${value}D.`,
        });
        return false;
      }

      case 'nextManeuverReversalTax': {
        const value = step.value || 0;
        if (!player.turnState) player.turnState = engine._emptyTurnState();
        player.turnState.nextManeuverReversalTax =
          (player.turnState.nextManeuverReversalTax || 0) + value;
        engine.actionLog.push({
          message: `${sourceName}: opponent's reversal to your next maneuver is +${value}F.`,
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

      case 'skipOpponentNextTurn': {
        if (!player.turnState) player.turnState = engine._emptyTurnState();
        player.turnState.skipOpponentNextTurn = true;
        engine.actionLog.push({
          message: `${sourceName}: opponent skips their next turn.`,
        });
        return false;
      }

      case 'setupIrishWhip': {
        engine._applyIrishWhipSetup(player, { name: sourceName }, step.strikeBonus || 5);
        return false;
      }

      case 'jockeyingChoice':
        return engine._beginJockeyingChoice(player, pipeline.playerIndex, sourceName);

      case 'turnDamageBonus': {
        engine._addTurnDamageBonus(player, {
          all: step.value || 0,
          sourceName,
        });
        return false;
      }

      case 'discardUpTo':
        return engine._beginDiscardUpToPrompt(
          player,
          pipeline.playerIndex,
          sourceName,
          step.max || 2
        );

      case 'shuffleRingsideUpTo':
        return engine._beginShuffleRingsideUpToPrompt(
          player,
          pipeline.playerIndex,
          sourceName,
          step.max || 2
        );

      case 'returnFromRingside': {
        const count = pipeline.discardedCount || 0;
        if (count === 0) return false;
        if (player.ringside.length === 0) {
          engine.actionLog.push({
            message: `${sourceName}: no cards in Ringside to return.`,
          });
          return false;
        }
        const toReturn = Math.min(count, player.ringside.length);
        return engine._beginReturnFromRingsidePrompt(
          player,
          pipeline.playerIndex,
          sourceName,
          toReturn
        );
      }

      case 'discardFromHand':
        return engine._beginDiscardFromHandPrompt(player, pipeline.playerIndex, sourceName, step.count || 1);

      case 'drawOrOpponentChoice':
        return engine._beginDrawOrOpponentChoice(player, pipeline.playerIndex, sourceName, step.count || 2);

      case 'topArsenalToRingside': {
        await engine._topArsenalToRingside(player, { name: sourceName });
        return false;
      }

      case 'opponentDiscardFromHand':
        return engine._beginOpponentDiscardFromHandEffect(player, opponent, sourceName, step.count || 1);

      case 'shuffleHandIntoArsenal':
        return engine._beginShuffleHandIntoArsenalPrompt(
          player,
          pipeline.playerIndex,
          sourceName,
          step.draw || step.count || 0
        );

      case 'reorderArsenalTop': {
        const targetPlayer = step.target === 'opponent' ? opponent : player;
        const targetPlayerIndex =
          step.target === 'opponent' ? pipeline.opponentIndex : pipeline.playerIndex;
        return engine._beginArsenalTopReorderPrompt(
          targetPlayer,
          pipeline.playerIndex,
          sourceName,
          step.count || 5,
          { targetPlayerIndex }
        );
      }

      case 'removeOpponentRingCard':
        return engine._beginRemoveOpponentRingCardPrompt(
          player,
          opponent,
          pipeline.playerIndex,
          sourceName
        );

      case 'balanceFortitudeByRingRemoval':
        return await engine._beginBalanceFortitudeByRingRemoval(sourceName);

      case 'opponentDraw': {
        engine._drawForOpponent(player, sourceName, step.count || 1);
        return false;
      }

      case 'turnSubtypeDamageBonus': {
        engine._addTurnDamageBonus(player, {
          subtype: step.subtype,
          value: step.value || 1,
          sourceName,
        });
        return false;
      }

      case 'nextStrikeBonus': {
        engine._applyNextStrikeBonus(player, sourceName, step.value || 2);
        return false;
      }

      case 'dealDamage': {
        const sourceCard = pipeline.sourceCard;
        const damage = step.fromReversedManeuver
          ? engine.reversedManeuverDamage ?? 0
          : step.count ?? sourceCard?.damage ?? 0;
        const result = await engine._applyReversalFromHandDamage(
          player,
          opponent,
          sourceCard,
          damage
        );
        if (result.gameOver) {
          engine.effectPipelineFlow = null;
        }
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