window.RawDeal = window.RawDeal || {};

window.RawDeal.GameEngine = class GameEngine {
  constructor(options = {}) {
    this.engineMode = options.engineMode || 'goldfish';
    this.onStateChange = options.onStateChange || (() => {});
    this.onDamageStep = options.onDamageStep || (async () => {});
    this.onArsenalToRingside =
      options.onArsenalToRingside || (async ({ onReveal }) => { if (onReveal) onReveal(); });
    this.stateMachine = new window.RawDeal.StateMachine(this.engineMode);
    this.stateMachine.onTransition(() => this._notify());
    this.reset();
  }

  reset() {
    this.players = [null, null];
    this.winner = null;
    this.winReason = null;
    this.nextManeuverBonus = [0, 0];
    this.turnDamageBonus = [this._emptyTurnDamageBonus(), this._emptyTurnDamageBonus()];
    this.pendingTurnDamageBonus = [this._emptyTurnDamageBonus(), this._emptyTurnDamageBonus()];
    this.pendingTurnOpponentReversalTax = [0, 0];
    this.damageLog = [];
    this.actionLog = [];
    this.abilityFlow = null;
    this.cardEffectFlow = null;
    this.pendingManeuverResolution = null;
    this.reversalWindow = null;
    this.handRevealFlow = null;
    this.effectPipelineFlow = null;
    this.pendingEgoBoostDraws = [];
    this.opponentDiscardResumeMeta = null;
    this.discardAllHandsFlow = null;
    this.reversedManeuverDamage = null;
    this.reversedManeuverHandReversalDamageBonus = 0;
    this.pendingReversalAfterDiscard = null;
    this.pendingOpponentReversal = null;
    this.maintainedSubmissionFlow = null;
    this._pendingMaintainedSubmissionWindow = false;
    this.animationEvents = [];
    this.stateMachine.phase = window.RawDeal.PHASES.SETUP;
    this.stateMachine.activePlayer = 0;
    this.stateMachine.turnNumber = 0;
    this._notify();
  }

  _gc() {
    return window.RawDeal.GameCopy;
  }

  _notify() {
    this.onStateChange(this.getPublicState());
  }

  _emptyTurnDamageBonus() {
    return { all: 0, strike: 0, grapple: 0, submission: 0 };
  }

  _emptyTurnState() {
    return {
      irishWhipPlayed: false,
      nextStrikeBonus: 0,
      nextGrappleBonus: 0,
      nextGrappleReversalTax: 0,
      nextManeuverReversalTax: 0,
      turnOpponentReversalTax: 0,
      nextCardManeuverBonus: 0,
      nextCardSubtypeBonus: null,
      nextCardFortitudeDiscount: 0,
      lastPlayedCardId: null,
      lastSuccessfulManeuverSubtype: null,
      lastSuccessfulManeuverDamage: null,
      opponentReversalsBlocked: false,
      skipOpponentNextTurn: false,
      discardHandAtEndOfTurn: false,
      canPlayAfterSuccessfulManeuver: false,
      canPlayAfterSuccessfulSubmission: false,
      lastSuccessfulSubmissionInstanceId: null,
      nextManeuverUnreversiblePending: false,
      nextManeuverUnreversibleMaxDamage: null,
      nextManeuverUnreversibleManeuverOnly: false,
      activeManeuverUnreversible: false,
    };
  }

  _clearTurnSetupEffects(player) {
    if (!player?.turnState) return;
    player.turnState.irishWhipPlayed = false;
    player.turnState.nextStrikeBonus = 0;
    player.turnState.nextGrappleBonus = 0;
    player.turnState.nextGrappleReversalTax = 0;
    player.turnState.nextManeuverReversalTax = 0;
    player.turnState.nextCardManeuverBonus = 0;
    player.turnState.nextCardFortitudeDiscount = 0;
    player.turnState.opponentReversalsBlocked = false;
    player.turnState.nextManeuverUnreversiblePending = false;
    player.turnState.nextManeuverUnreversibleMaxDamage = null;
    player.turnState.nextManeuverUnreversibleManeuverOnly = false;
    player.turnState.activeManeuverUnreversible = false;
    this.nextManeuverBonus[this._playerIndex(player)] = 0;
  }

  _expireNextCardManeuverBonusIfNotManeuver(player, mode) {
    if (mode !== 'maneuver' && player.turnState?.nextCardManeuverBonus) {
      player.turnState.nextCardManeuverBonus = 0;
    }
  }

  _expireNextCardSubtypeBonusUnlessMatch(player, card, mode) {
    if (!player.turnState?.nextCardSubtypeBonus) return;
    if (mode !== 'maneuver' || card.subtype !== player.turnState.nextCardSubtypeBonus.subtype) {
      player.turnState.nextCardSubtypeBonus = null;
    }
  }

  _handleNextCardUnreversibleOnPlay(player, opponent, played, mode) {
    if (!player.turnState?.nextManeuverUnreversiblePending) return;

    const maxDamage = player.turnState.nextManeuverUnreversibleMaxDamage;
    const maneuverOnly = player.turnState.nextManeuverUnreversibleManeuverOnly;

    if (mode !== 'maneuver') {
      if (!maneuverOnly) {
        player.turnState.nextManeuverUnreversiblePending = false;
        player.turnState.nextManeuverUnreversibleMaxDamage = null;
        player.turnState.nextManeuverUnreversibleManeuverOnly = false;
      }
      return;
    }

    player.turnState.nextManeuverUnreversiblePending = false;
    player.turnState.nextManeuverUnreversibleMaxDamage = null;
    player.turnState.nextManeuverUnreversibleManeuverOnly = false;
    player.turnState.activeManeuverUnreversible = false;

    const damage = this._calcManeuverDamage(player, opponent, played);
    if (maxDamage == null || damage <= maxDamage) {
      player.turnState.activeManeuverUnreversible = true;
    }
  }

  _markManeuverSuccessfullyPlayed(player, played, damage = null) {
    if (!player.turnState) player.turnState = this._emptyTurnState();
    player.turnState.canPlayAfterSuccessfulManeuver = true;
    if (damage != null) {
      player.turnState.lastSuccessfulManeuverDamage = damage;
    }
    if (played?.subtype) {
      player.turnState.lastSuccessfulManeuverSubtype = played.subtype;
    }
    if (
      played &&
      (played.subtype === 'submission' || played.grantsMaintainHoldAfterPlay)
    ) {
      player.turnState.canPlayAfterSuccessfulSubmission = true;
      player.turnState.lastSuccessfulSubmissionInstanceId = played.instanceId;
    }
  }

  _isMaintainHoldLockActive() {
    const flow = this.maintainedSubmissionFlow;
    return !!(flow?.active && flow?.abilityActive);
  }

  _resolveMaintainedSubmissionCard() {
    const flow = this.maintainedSubmissionFlow;
    if (!flow?.submissionInstanceId) return null;
    const maintainer = this.players[flow.maintainerIndex];
    if (!maintainer) return null;
    return (
      maintainer.ring.maneuvers.find((c) => c.instanceId === flow.submissionInstanceId) || null
    );
  }

  _shouldOpenMaintainedSubmissionWindow() {
    const flow = this.maintainedSubmissionFlow;
    if (!flow?.abilityActive) return false;
    if (this.stateMachine.activePlayer !== flow.maintainerIndex) return false;
    return !!this._resolveMaintainedSubmissionCard();
  }

  _disableMaintainHoldAbility(reason) {
    if (!this.maintainedSubmissionFlow) return;
    this.maintainedSubmissionFlow.abilityActive = false;
    this.maintainedSubmissionFlow.active = false;
    this.actionLog.push({
      message: this._gc().log.maintainHoldDisabled(reason),
    });
  }

  _getManeuverReversalFortitudeTax(attacker, maneuver) {
    if (!attacker?.turnState) return 0;
    let tax = attacker.turnState.nextManeuverReversalTax || 0;
    tax += attacker.turnState.turnOpponentReversalTax || 0;
    if (maneuver.subtype === 'grapple') {
      tax += attacker.turnState.nextGrappleReversalTax || 0;
    }
    return tax;
  }

  _getActionReversalFortitudeTax(attacker) {
    if (!attacker?.turnState) return 0;
    return attacker.turnState.turnOpponentReversalTax || 0;
  }

  _clearNextManeuverReversalTax(player) {
    if (player?.turnState?.nextManeuverReversalTax) {
      player.turnState.nextManeuverReversalTax = 0;
    }
  }

  _playerIndex(player) {
    if (player.seatIndex !== undefined) return player.seatIndex;
    return player.isHuman ? 0 : 1;
  }

  _activePlayerIndex() {
    return this.stateMachine.activePlayer;
  }

  _getRingPassiveManeuverDamageBonus(player) {
    if (!player?.ring) return 0;
    let bonus = 0;
    for (const area of ['maneuvers', 'reversals', 'actions']) {
      for (const card of player.ring[area] || []) {
        for (const effect of card.ringPassiveEffects || []) {
          if (effect.op === 'maneuverDamageBonus') {
            bonus += effect.value || 0;
          }
        }
      }
    }
    return bonus;
  }

  _applyDisqualificationWin(winnerIndex, sourceName = 'Disqualification!') {
    this.winner = winnerIndex;
    this.winReason = window.RawDeal.WIN_REASONS.DISQUALIFICATION;
    this.stateMachine.phase = window.RawDeal.PHASES.GAME_OVER;
    this.reversalWindow = null;
    this.cardEffectFlow = null;
    this.pendingReversalAfterDiscard = null;
    this.pendingOpponentReversal = null;
    this.actionLog.push({
      message: this._gc().log.disqualificationWin(sourceName),
    });
    this._notify();
  }

  _checkDisqualificationRingsideTrigger(defender, attacker, damageSource) {
    if (!window.RawDeal.CardUtils.isHeelCard(damageSource)) return null;
    const minHeel = 5;
    if (window.RawDeal.CardUtils.countHeelCardsInRing(attacker) < minHeel) return null;
    return this._playerIndex(defender);
  }

  _getRingTitleWordDamageBonus(player, { word, value = 1 } = {}) {
    if (!player?.ring?.maneuvers?.length || !word) return 0;
    const needle = word.toLowerCase();
    let count = 0;
    for (const card of player.ring.maneuvers) {
      if (card.name?.toLowerCase().includes(needle)) {
        count += 1;
      }
    }
    return count * (value || 1);
  }

  _addTurnDamageBonus(player, { all = 0, subtype, value = 0, sourceName }) {
    const idx = this._playerIndex(player);
    const bonuses = this.turnDamageBonus[idx];

    if (all) {
      bonuses.all += all;
      this.actionLog.push({
        message: this._gc().log.turnDamageAll(sourceName, all),
      });
    }

    if (subtype && value) {
      bonuses[subtype] = (bonuses[subtype] || 0) + value;
      this.actionLog.push({
        message: this._gc().log.turnDamageSubtype(sourceName, subtype, value),
      });
    }
  }

  _addNextTurnDamageBonus(player, { all = 0, subtype, value = 0, sourceName }) {
    const idx = this._playerIndex(player);
    const bonuses = this.pendingTurnDamageBonus[idx];

    if (all) {
      bonuses.all += all;
      this.actionLog.push({
        message: this._gc().log.nextTurnDamageAll(sourceName, all),
      });
    }

    if (subtype && value) {
      bonuses[subtype] = (bonuses[subtype] || 0) + value;
      this.actionLog.push({
        message: this._gc().log.nextTurnDamageSubtype(sourceName, subtype, value),
      });
    }
  }

  _addNextTurnOpponentReversalTax(player, value, sourceName) {
    const idx = this._playerIndex(player);
    this.pendingTurnOpponentReversalTax[idx] += value;
    this.actionLog.push({
      message: this._gc().log.nextTurnOpponentReversalTax(sourceName, value),
    });
  }

  _applyPendingTurnBonuses(player, playerIndex) {
    const pendingDamage = this.pendingTurnDamageBonus[playerIndex];
    if (pendingDamage.all || pendingDamage.strike || pendingDamage.grapple || pendingDamage.submission) {
      const bonuses = this.turnDamageBonus[playerIndex];
      bonuses.all += pendingDamage.all;
      bonuses.strike += pendingDamage.strike;
      bonuses.grapple += pendingDamage.grapple;
      bonuses.submission += pendingDamage.submission;
      this.pendingTurnDamageBonus[playerIndex] = this._emptyTurnDamageBonus();
    }

    const pendingTax = this.pendingTurnOpponentReversalTax[playerIndex];
    if (pendingTax) {
      if (!player.turnState) player.turnState = this._emptyTurnState();
      player.turnState.turnOpponentReversalTax =
        (player.turnState.turnOpponentReversalTax || 0) + pendingTax;
      this.pendingTurnOpponentReversalTax[playerIndex] = 0;
    }
  }

  getPublicState(viewerIndex = 0) {
    return {
      phase: this.stateMachine.phase,
      activePlayer: this.stateMachine.activePlayer,
      turnNumber: this.stateMachine.turnNumber,
      engineMode: this.engineMode,
      players: this.players.map((p) => (p ? this._publicPlayer(p, viewerIndex) : null)),
      winner: this.winner,
      winReason: this.winReason,
      damageLog: [...this.damageLog],
      actionLog: [...this.actionLog],
      canPlay: this.stateMachine.canPlayCards(viewerIndex),
      selectionPrompt: this._publicSelectionPrompt(viewerIndex),
      superstarAbility: this._publicSuperstarAbility(viewerIndex),
      reversalWindow: this._publicReversalWindow(viewerIndex),
      handReveal: this._publicHandReveal(viewerIndex),
      animationEvents: this.animationEvents.map((e) => ({ ...e })),
    };
  }

  _publicHandReveal(viewerIndex) {
    return window.RawDeal.EffectPipeline.publicHandReveal(this, viewerIndex);
  }

  async _startEffectPipeline(player, sourceName, steps, timing = 'action', sourceCard = null) {
    return window.RawDeal.EffectPipeline.start(
      this,
      player,
      sourceName,
      steps,
      timing,
      sourceCard
    );
  }

  async dismissHandReveal(playerIndex) {
    return window.RawDeal.EffectPipeline.resume(this, playerIndex, { skipped: false });
  }

  async skipHandReveal(playerIndex) {
    return window.RawDeal.EffectPipeline.resume(this, playerIndex, { skipped: true });
  }

  async confirmHandRevealSelection(playerIndex, instanceIds) {
    return window.RawDeal.EffectPipeline.resume(this, playerIndex, { selectedIds: instanceIds });
  }

  toggleHandRevealSelection(playerIndex, instanceId) {
    return window.RawDeal.EffectPipeline.toggleSelection(this, playerIndex, instanceId);
  }

  clearAnimationEvents() {
    this.animationEvents = [];
  }

  _reversalWindowResponderIndex(kind, attackerIndex, defenderIndex) {
    return kind === 'opponentReversal' ? attackerIndex : defenderIndex;
  }

  _reversalWindowHeelPlayerIndex(kind, attackerIndex, defenderIndex) {
    return kind === 'opponentReversal' ? defenderIndex : attackerIndex;
  }

  _publicReversalWindow(viewerIndex) {
    if (!this.reversalWindow) return null;
    const { attackerIndex, defenderIndex, played, damage, kind = 'maneuver' } = this.reversalWindow;
    const heelPlayerIndex = this._reversalWindowHeelPlayerIndex(
      kind,
      attackerIndex,
      defenderIndex
    );
    const heelPlayer = this.players[heelPlayerIndex];
    const catalog = window.RawDeal.CARDS?.[played.id];
    return {
      active: true,
      kind,
      attackerIndex,
      defenderIndex,
      heelPlayerIndex,
      opponentHeelInRing: window.RawDeal.CardUtils.countHeelCardsInRing(heelPlayer),
      canRespond:
        viewerIndex ===
        this._reversalWindowResponderIndex(kind, attackerIndex, defenderIndex),
      maneuver: {
        id: played.id,
        name: played.name,
        subtype: played.subtype,
        alignment:
          played.alignment ?? catalog?.alignment ?? null,
        types: played.types?.length ? played.types : (catalog?.types ?? []),
        damage: kind === 'action' ? 0 : damage,
        afterIrishWhip: kind === 'maneuver'
          ? !!this.players[attackerIndex]?.turnState?.irishWhipPlayed
          : false,
        reversalFortitudeTax:
          kind === 'action'
            ? this._getActionReversalFortitudeTax(this.players[attackerIndex])
            : kind === 'maneuver' || kind === 'maintained'
              ? this._getManeuverReversalFortitudeTax(
                  this.players[attackerIndex],
                  played
                )
              : 0,
      },
    };
  }

  _publicSelectionPrompt(viewerIndex = 0) {
    if (this.cardEffectFlow?.playerIndex !== viewerIndex) return null;

    const flow = this.cardEffectFlow;
    if (flow.type === 'choice') {
      const { message, options } = this._gc().choice(flow.choiceId, flow) || {};
      return {
        mode: 'choice',
        message,
        options: (options || []).map((o) => ({ ...o })),
      };
    }

    if (flow.type === 'drawCountChoice') {
      const player = this.players[flow.playerIndex];
      const available = this._drawCountAvailableMax(player, flow.max);
      return {
        mode: 'drawCount',
        message: this._gc().prompt.drawCountChoice(flow.sourceName, available),
        min: 0,
        max: available,
        selected: flow.selectedCount ?? 0,
      };
    }

    if (flow.type === 'discardCountChoice') {
      const player = this.players[flow.playerIndex];
      const available = this._discardUpToAvailableMax(player, flow.max);
      return {
        mode: 'discardCount',
        message: this._gc().prompt.discardCountChoice(flow.sourceName, available),
        min: 0,
        max: available,
        selected: flow.selectedCount ?? 0,
      };
    }

    if (flow.type === 'forceOpponentDiscardCountChoice') {
      const opponent = this.players[flow.opponentIndex];
      const available = Math.min(flow.max || 5, opponent.hand.length);
      return {
        mode: 'forceOpponentDiscardCount',
        message: this._gc().prompt.forceOpponentDiscardCountChoice(flow.sourceName, available),
        min: 0,
        max: available,
        selected: flow.selectedCount ?? 0,
      };
    }

    if (flow.type === 'shuffleRingsideIntoArsenal') {
      const picked = flow.selectedIds.length;
      const player = this.players[flow.playerIndex];
      const upTo = flow.exact === false;
      const maxSelect = flow.maxSelect ?? flow.count ?? 1;
      const message = upTo
        ? this._gc().prompt.shuffleRingsideUpTo(flow.sourceName, maxSelect, picked)
        : this._gc().prompt.shuffleRingsideIntoArsenal(flow.sourceName, maxSelect, picked);
      return {
        mode: 'ringsideModal',
        message,
        cards: player.ringside.map((c) => ({ ...c })),
        selectCount: upTo ? maxSelect : maxSelect,
        maxSelect,
        upTo,
        selectedIds: [...flow.selectedIds],
        allowPass: false,
      };
    }

    if (flow.type === 'returnFromRingside') {
      const n = flow.count || 1;
      const picked = flow.selectedIds.length;
      const message = this._gc().prompt.returnFromRingside(flow.sourceName, n, picked);
      const player = this.players[flow.playerIndex];
      return {
        mode: 'ringsideModal',
        message,
        cards: player.ringside.map((c) => ({ ...c })),
        selectCount: n,
        selectedIds: [...flow.selectedIds],
        allowPass: false,
      };
    }

    if (flow.type === 'discardFromHand') {
      const n = flow.count || 1;
      const picked = flow.selectedIds.length;
      const message = this._gc().prompt.discardFromHand(flow.sourceName, n, picked);
      return {
        mode: 'hand',
        count: n,
        message,
        selectedIds: [...flow.selectedIds],
      };
    }

    if (flow.type === 'opponentDiscardFromHand') {
      const n = flow.count || 1;
      const picked = flow.selectedIds.length;
      const message = this._gc().prompt.opponentDiscardFromHand(flow.sourceName, n, picked);
      return {
        mode: 'hand',
        count: n,
        message,
        selectedIds: [...flow.selectedIds],
      };
    }

    if (flow.type === 'shuffleHandIntoArsenal') {
      const drawCount = flow.drawCount || 0;
      return {
        mode: 'hand',
        count: 1,
        message: this._gc().prompt.shuffleHandIntoArsenal(flow.sourceName, drawCount),
        selectedIds: [...flow.selectedIds],
      };
    }

    if (flow.type === 'removeOpponentRingCard') {
      const opponent = this.players[1 - flow.playerIndex];
      const sections = this._buildOpponentRingSelectSections(opponent, flow.maxDamage);
      return {
        mode: 'opponentRingModal',
        message: this._gc().prompt.removeOpponentRingCard(flow.sourceName, flow.maxDamage),
        sections,
        selectedId: flow.selectedId || null,
      };
    }

    if (flow.type === 'balanceFortitudeRingRemoval') {
      const target = this.players[flow.playerIndex];
      const other = this.players[1 - flow.playerIndex];
      const sections = this._buildRingSelectSections(target, {
        areas: ['maneuvers', 'reversals'],
        maxDamage: Infinity,
      });
      return {
        mode: 'opponentRingModal',
        message: this._gc().prompt.balanceFortitudeRingRemoval(
          flow.sourceName,
          target.fortitude,
          other.fortitude
        ),
        sections,
        selectedId: flow.selectedId || null,
      };
    }

    if (flow.type === 'arsenalReorder') {
      const targetPlayer = this.players[flow.targetPlayerIndex];
      const topSlice = targetPlayer.arsenal.slice(-flow.count);
      const byId = new Map(topSlice.map((c) => [c.instanceId, c]));
      const cards = flow.orderedIds
        .map((id) => {
          const card = byId.get(id);
          return card ? { ...card } : null;
        })
        .filter(Boolean);
      const whose =
        flow.target === 'opponent' ? "opponent's top" : 'your top';
      return {
        mode: 'arsenalReorder',
        message: this._gc().prompt.arsenalReorder(
          flow.sourceName,
          whose,
          flow.count,
          flow.target
        ),
        cards,
        orderedIds: [...flow.orderedIds],
        count: flow.count,
        target: flow.target,
      };
    }

    if (flow.type === 'arsenalSearch') {
      const targetPlayer = this.players[flow.targetPlayerIndex];
      const cards = targetPlayer.arsenal
        .filter((c) => !flow.filterCardId || c.id === flow.filterCardId)
        .map((c) => ({ ...c }));
      const picked = flow.selectedIds.length;
      const n = flow.selectCount || 1;
      const message = this._gc().prompt.arsenalSearch(
        flow.sourceName,
        flow.purpose,
        n,
        picked,
        flow.filterCardId
      );
      return {
        mode: 'arsenalSearch',
        purpose: flow.purpose,
        message,
        cards,
        selectCount: n,
        selectedIds: [...flow.selectedIds],
        filterCardId: flow.filterCardId || null,
      };
    }

    if (flow.type === 'pickArsenalOrRingsideToHand') {
      const player = this.players[flow.playerIndex];
      const filterId = flow.filterCardId || null;
      const arsenalCards = player.arsenal
        .filter((c) => !filterId || c.id === filterId)
        .map((c) => ({ ...c }));
      const ringsideCards = player.ringside
        .filter((c) => !filterId || c.id === filterId)
        .map((c) => ({ ...c }));
      return {
        mode: 'arsenalOrRingsideModal',
        message: this._gc().prompt.arsenalOrRingsidePick(flow.sourceName, filterId),
        arsenalCards,
        ringsideCards,
        selectedId: flow.selectedId,
        selectedZone: flow.selectedZone,
        filterCardId: filterId,
      };
    }

    return null;
  }

  _publicSuperstarAbility(viewerIndex = 0) {
    const player = this.players[viewerIndex];
    if (!player) {
      return {
        supported: false,
        usesButton: false,
        canUse: false,
        used: false,
        label: null,
        prompt: null,
      };
    }

    const id = player.superstar.id;
    const supported =
      id === 'stone-cold' ||
      id === 'undertaker' ||
      id === 'the-rock' ||
      id === 'kane' ||
      id === 'jericho';
    const usesButton = id === 'stone-cold' || id === 'undertaker' || id === 'jericho';

    let prompt = null;
    if (this.abilityFlow?.playerIndex === viewerIndex) {
      const flow = this.abilityFlow;
      if (flow.step === 'rockRingside') {
        prompt = {
          mode: 'ringsideModal',
          message: this._gc().prompt.superstar.rockRingside(),
          cards: player.ringside.map((c) => ({ ...c })),
          selectedId: flow.selectedId || null,
        };
      } else if (flow.step === 'pickBottom') {
        prompt = {
          mode: 'hand',
          count: 1,
          message: this._gc().prompt.superstar.pickBottom(),
          selectedIds: [],
        };
      } else if (flow.step === 'pickDiscard') {
        prompt = {
          mode: 'hand',
          count: 2,
          message: this._gc().prompt.superstar.pickDiscard(flow.discardSelected.length),
          selectedIds: [...flow.discardSelected],
        };
      } else if (flow.step === 'pickRingside') {
        prompt = {
          mode: 'ringsideModal',
          message: this._gc().prompt.superstar.pickRingside(),
          cards: player.ringside.map((c) => ({ ...c })),
          selectCount: 1,
          selectedId: flow.selectedId || null,
          allowPass: false,
        };
      } else if (flow.step === 'jerichoDiscardSelf') {
        prompt = {
          mode: 'hand',
          count: 1,
          message: this._gc().prompt.superstar.jerichoDiscardSelf(),
          selectedIds: [],
        };
      }
    }

    return {
      supported,
      usesButton,
      canUse: this.canUseSuperstarAbility(viewerIndex),
      used: player.superstarAbilityUsed,
      label: this._gc().prompt.superstarAbilityLabel,
      prompt,
    };
  }

  _publicPlayer(player, viewerIndex = 0) {
    const seat = this._playerIndex(player);
    const showHand = this.engineMode === 'multiplayer'
      ? seat === viewerIndex
      : player.isHuman;
    return {
      superstar: player.superstar,
      deckId: player.deckId,
      username: player.username || null,
      handSize: player.hand.length,
      arsenalSize: player.arsenal.length,
      ringsideSize: player.ringside.length,
      fortitude: player.fortitude,
      hand: showHand ? player.hand : [],
      ring: player.ring,
      ringside: player.ringside,
      arsenal: player.arsenal,
      turnState: player.turnState ? { ...player.turnState } : this._emptyTurnState(),
      isHuman: showHand,
      seatIndex: seat,
    };
  }

  async startGame(playerDeckId, opponentDeckId = 'austin', decks = null, options = {}) {
    const { CARDS } = window.RawDeal;
    const deckMap = decks || window.RawDeal.DeckStore?.getResolvedDecks() || window.RawDeal.DECKS;
    const playerDeck = deckMap[playerDeckId];
    const opponentDeck = deckMap[opponentDeckId];

    const multiplayer = this.engineMode === 'multiplayer';
    this.players[0] = this._createPlayer(playerDeck, 0, true, options.player0);
    this.players[1] = this._createPlayer(
      opponentDeck,
      1,
      multiplayer,
      options.player1
    );

    const firstPlayer =
      this.players[0].superstar.superstarValue >= this.players[1].superstar.superstarValue ? 0 : 1;

    this._dealOpeningHands();
    this.stateMachine.transition(window.RawDeal.EVENTS.START_GAME, { firstPlayer });
    await this._runAutoPhases();
  }

  _createPlayer(deck, seatIndex, isHuman, meta = {}) {
    const arsenal = this._shuffle([...deck.arsenal]);
    return {
      superstar: { ...window.RawDeal.CARDS[deck.superstarId] },
      arsenal,
      hand: [],
      ringside: [],
      ring: { maneuvers: [], actions: [], reversals: [] },
      fortitude: 0,
      superstarAbilityUsed: false,
      preDrawSuperstarResolved: false,
      turnState: this._emptyTurnState(),
      isHuman,
      seatIndex,
      deckId: deck.id,
      username: meta.username || null,
      userId: meta.userId || null,
    };
  }

  _shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  _shuffleCardIntoArsenal(player, card) {
    const insertAt = Math.floor(Math.random() * (player.arsenal.length + 1));
    player.arsenal.splice(insertAt, 0, card);
  }

  _drawCardsForEffect(player, sourceName, drawCount) {
    if (!drawCount) return;
    let drawn = 0;
    for (let i = 0; i < drawCount; i++) {
      if (this._drawCard(player)) drawn += 1;
    }
    if (drawn > 0) {
      this.actionLog.push({
        message: this._gc().log.drewCards(sourceName, drawn),
      });
    } else {
      this.actionLog.push({
        message: this._gc().log.arsenalEmptyNoDraw(sourceName),
      });
    }
  }

  async _completeShuffleHandIntoArsenal(player, flow, card) {
    this._shuffleCardIntoArsenal(player, card);
    this.actionLog.push({
      message: this._gc().log.shuffledFromHand(flow.sourceName, card.name),
    });
    this._drawCardsForEffect(player, flow.sourceName, flow.drawCount || 0);
    await this._finishCardEffectResolution();
  }

  _beginShuffleHandIntoArsenalPrompt(player, playerIndex, sourceName, drawCount = 0) {
    if (player.hand.length === 0) {
      this.actionLog.push({
        message: this._gc().log.noHandToShuffle(sourceName),
      });
      return false;
    }

    if (!player.isHuman) {
      const idx = Math.floor(Math.random() * player.hand.length);
      const card = player.hand.splice(idx, 1)[0];
      this._shuffleCardIntoArsenal(player, card);
      this.actionLog.push({
        message: this._gc().log.shuffledFromHand(sourceName, card.name),
      });
      this._drawCardsForEffect(player, sourceName, drawCount);
      return false;
    }

    this.cardEffectFlow = {
      type: 'shuffleHandIntoArsenal',
      playerIndex,
      sourceName,
      drawCount,
      count: 1,
      selectedIds: [],
    };
    this._notify();
    return true;
  }

  _dealOpeningHands() {
    for (const player of this.players) {
      const count = player.superstar.handSize;
      for (let i = 0; i < count; i++) {
        if (player.arsenal.length > 0) {
          player.hand.push(player.arsenal.pop());
        }
      }
    }
  }

  _calcFortitude(player) {
    let total = 0;
    for (const card of [...player.ring.maneuvers, ...player.ring.reversals]) {
      total += card.damage || 0;
    }
    return total;
  }

  _syncFortitude(player) {
    player.fortitude = this._calcFortitude(player);
  }

  _placeManeuverInRing(player, played) {
    if (!player.ring.maneuvers.some((c) => c.instanceId === played.instanceId)) {
      player.ring.maneuvers.push(played);
    }
    this._syncFortitude(player);
  }

  _sendReversedManeuverToRingside(attacker, played) {
    const idx = attacker.ring.maneuvers.findIndex((c) => c.instanceId === played.instanceId);
    if (idx >= 0) {
      attacker.ring.maneuvers.splice(idx, 1);
    }
    if (!attacker.ringside.some((c) => c.instanceId === played.instanceId)) {
      attacker.ringside.push(played);
    }
    this._syncFortitude(attacker);
  }

  _drawCard(player) {
    if (player.arsenal.length === 0) return null;
    const card = player.arsenal.pop();
    player.hand.push(card);
    return card;
  }

  async _runAutoPhases() {
    const { PHASES, EVENTS } = window.RawDeal;

    while (
      this.stateMachine.phase !== PHASES.MAIN &&
      this.stateMachine.phase !== PHASES.GAME_OVER &&
      this.stateMachine.phase !== PHASES.SETUP
    ) {
      const phase = this.stateMachine.phase;
      const active = this.players[this.stateMachine.activePlayer];

      if (phase === PHASES.START_OF_TURN) {
        this.stateMachine.transition(null);
        continue;
      }

      if (phase === PHASES.REFRESH) {
        active.superstarAbilityUsed = false;
        active.preDrawSuperstarResolved = false;
        this.abilityFlow = null;
        if (active.isHuman) {
          this.cardEffectFlow = null;
          this.pendingManeuverResolution = null;
        }
        this.turnDamageBonus[this.stateMachine.activePlayer] = this._emptyTurnDamageBonus();
        active.turnState = this._emptyTurnState();
        this._applyPendingTurnBonuses(active, this.stateMachine.activePlayer);
        this._syncFortitude(active);
        this.stateMachine.transition(EVENTS.REFRESH_DONE);
        continue;
      }

      if (phase === PHASES.DRAW) {
        if (this.abilityFlow?.step === 'rockRingside') {
          break;
        }

        if (!active.preDrawSuperstarResolved) {
          const waiting = await this._handlePreDrawSuperstarAbilities(
            active,
            this.stateMachine.activePlayer
          );
          if (waiting) {
            break;
          }
        }

        const drawCount = active.superstar.id === 'mankind' ? 2 : 1;
        for (let d = 0; d < drawCount; d++) {
          this._drawCard(active);
        }
        this.stateMachine.transition(EVENTS.DRAW_DONE);
        this._pendingMaintainedSubmissionWindow = this._shouldOpenMaintainedSubmissionWindow();
        continue;
      }

      if (phase === PHASES.OPPONENT_TURN) {
        if (this.engineMode === 'multiplayer') {
          break;
        }
        await this._delay(400);
        this.stateMachine.transition(EVENTS.OPPONENT_DONE);
        continue;
      }

      if (phase === PHASES.END_OF_TURN) {
        const skipOpponent = !!active.turnState?.skipOpponentNextTurn;
        if (skipOpponent) {
          active.turnState.skipOpponentNextTurn = false;
        }
        this._resolveEndOfTurnHandDiscard(active);
        this._clearTurnSetupEffects(active);
        const opponent = this.players[1 - this.stateMachine.activePlayer];
        const gameOver = this._checkCountOut(opponent);
        this.stateMachine.transition(null, { gameOver, skipOpponentTurn: skipOpponent });
        if (!gameOver) continue;
        break;
      }

      break;
    }

    if (
      this.stateMachine.phase === PHASES.MAIN &&
      this._pendingMaintainedSubmissionWindow
    ) {
      this._pendingMaintainedSubmissionWindow = false;
      await this._openMaintainedSubmissionWindowOrReapply();
    }

    this._notify();
  }

  _checkCountOut(player) {
    if (player.arsenal.length === 0) {
      this.winner = 1 - this._playerIndex(player);
      this.winReason = window.RawDeal.WIN_REASONS.COUNT_OUT;
      return true;
    }
    return false;
  }

  _resolveEndOfTurnHandDiscard(player) {
    if (!player.turnState?.discardHandAtEndOfTurn) return;

    player.turnState.discardHandAtEndOfTurn = false;
    if (player.hand.length === 0) return;

    const discarded = [...player.hand];
    player.hand = [];
    for (const card of discarded) {
      player.ringside.push(card);
    }

    const count = discarded.length;
    this.actionLog.push({
      message: this._gc().log.endOfTurnDiscardHand(count),
    });
  }

  _effectiveFortitudeCost(player, card, playAs = 'maneuver') {
    return window.RawDeal.CardUtils.playFortitudeCost(card, playAs, player);
  }

  canPlayCard(playerIndex, instanceId, playAs) {
    if (
      !this.stateMachine.canPlayCards(playerIndex) ||
      this.abilityFlow ||
      this.cardEffectFlow ||
      this.reversalWindow ||
      window.RawDeal.EffectPipeline.isPaused(this, playerIndex)
    ) {
      return false;
    }

    if (this._isMaintainHoldLockActive()) {
      return false;
    }

    const player = this.players[playerIndex];
    const card = player.hand.find((c) => c.instanceId === instanceId);
    if (!card) return false;

    if (card.requiresAfterSuccessfulSubmission) {
      const subId = player.turnState?.lastSuccessfulSubmissionInstanceId;
      if (!subId || !player.ring.maneuvers.some((c) => c.instanceId === subId)) {
        return false;
      }
    }

    const utils = window.RawDeal.CardUtils;
    const mode =
      playAs || (utils.canPlayFromHandAs(card, 'maneuver') ? 'maneuver' : utils.primaryType(card));
    if (!utils.canPlayFromHandAs(card, mode)) return false;
    if (!utils.meetsPlayRequirement(player, card, mode)) return false;

    const opponent = this.players[1 - playerIndex];
    if (mode === 'action' && !utils.meetsActionPlayRequirement(player, opponent, card)) {
      return false;
    }

    const cost = this._effectiveFortitudeCost(player, card, mode);
    return player.fortitude >= cost;
  }

  async playCard(playerIndex, instanceId, playAs) {
    const player = this.players[playerIndex];
    const card = player.hand.find((c) => c.instanceId === instanceId);
    const utils = window.RawDeal.CardUtils;
    const mode =
      playAs || (utils.canPlayFromHandAs(card, 'maneuver') ? 'maneuver' : utils.primaryType(card));

    if (!this.canPlayCard(playerIndex, instanceId, mode)) return false;

    const opponent = this.players[1 - playerIndex];
    const handIndex = player.hand.findIndex((c) => c.instanceId === instanceId);
    const played = player.hand.splice(handIndex, 1)[0];
    this._expireNextCardManeuverBonusIfNotManeuver(player, mode);
    this._expireNextCardSubtypeBonusUnlessMatch(player, played, mode);
    this._handleNextCardUnreversibleOnPlay(player, opponent, played, mode);
    if (mode === 'maneuver' && played.unreversible) {
      if (!player.turnState) player.turnState = this._emptyTurnState();
      player.turnState.activeManeuverUnreversible = true;
    }
    if (!player.turnState) player.turnState = this._emptyTurnState();
    player.turnState.lastPlayedCardId = played.id;
    if (player.turnState.nextCardFortitudeDiscount) {
      player.turnState.nextCardFortitudeDiscount = 0;
    }

    if (mode === 'action') {
      if (this._openActionReversalWindowOrPlay(player, opponent, played)) {
        return true;
      }
      await this._playFromHandAsAction(player, played);
      this._notify();
      return true;
    }

    if (mode === 'maneuver' || mode === 'reversal') {
      const deferManeuverToRing =
        mode === 'maneuver' && this.engineMode === 'multiplayer';

      if (!deferManeuverToRing) {
        const ringArea = mode === 'reversal' ? player.ring.reversals : player.ring.maneuvers;
        ringArea.push(played);
        this._syncFortitude(player);
      }

      const damage = this._calcManeuverDamage(player, opponent, played);

      return this._openReversalWindowOrApplyDamage(player, opponent, played, damage);
    } else if (window.RawDeal.CardUtils.hasType(played, 'action')) {
      await this._playFromHandAsAction(player, played);
    }

    this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
    this._notify();
    return true;
  }

  async _playFromHandAsAction(player, card) {
    if (card.requiresAfterSuccessfulSubmission) {
      await this._resolveMaintainHoldAction(player, card);
      return;
    }

    const firstOp = card.actionEffects?.[0]?.op;

    if (firstOp === 'discardSelfToDraw') {
      player.ringside.push(card);
      const draws = card.actionEffects[0].count || 1;
      for (let i = 0; i < draws; i++) {
        this._drawCard(player);
      }
      this.actionLog.push({
        message: this._gc().log.actionDiscardToDraw(card.name, draws),
      });
      return;
    }

    if (firstOp === 'shuffleSelfToArsenalAndDraw') {
      const draws = card.actionEffects[0].count || 2;
      this._shuffleCardIntoArsenal(player, card);
      this._shuffle(player.arsenal);
      this.actionLog.push({
        message: this._gc().log.actionShuffledSelfToArsenal(card.name),
      });
      this._drawCardsForEffect(player, card.name, draws);
      return;
    }

    player.ring.actions.push(card);
    this.actionLog.push({
      message: this._gc().log.actionPlayed(card.name),
    });

    if (card.actionEffects?.length) {
      await this._startEffectPipeline(player, card.name, card.actionEffects, 'action');
    }
  }

  async _resolveMaintainHoldAction(player, card) {
    const playerIndex = this._playerIndex(player);
    const submissionInstanceId = player.turnState?.lastSuccessfulSubmissionInstanceId;
    const submission = player.ring.maneuvers.find(
      (c) => c.instanceId === submissionInstanceId
    );
    if (!submission) return;

    player.ring.actions.push(card);
    this.actionLog.push({
      message: this._gc().log.maintainHoldPlayed(submission.name),
    });

    this.maintainedSubmissionFlow = {
      active: true,
      abilityActive: true,
      maintainerIndex: playerIndex,
      submissionInstanceId: submission.instanceId,
      maintainHoldInstanceId: card.instanceId,
    };

    player.turnState.canPlayAfterSuccessfulSubmission = false;
    player.turnState.lastSuccessfulSubmissionInstanceId = null;

    this._notify();
    await this._forceEndTurnFromEffect(playerIndex);
  }

  async _openMaintainedSubmissionWindowOrReapply() {
    const flow = this.maintainedSubmissionFlow;
    if (!flow?.abilityActive) return;

    const maintainer = this.players[flow.maintainerIndex];
    const opponent = this.players[1 - flow.maintainerIndex];
    const submission = this._resolveMaintainedSubmissionCard();
    if (!submission) {
      this._disableMaintainHoldAbility('missing');
      return;
    }

    const damage = this._calcManeuverDamage(maintainer, opponent, submission);

    if (this.engineMode !== 'multiplayer') {
      await this._reapplyMaintainedSubmission();
      return;
    }

    this.stateMachine.transition(window.RawDeal.EVENTS.PLAY_CARD, { openReversalWindow: true });
    this.reversalWindow = {
      kind: 'maintained',
      attackerIndex: flow.maintainerIndex,
      defenderIndex: 1 - flow.maintainerIndex,
      player: maintainer,
      opponent,
      played: submission,
      damage,
    };
    this._notify();
  }

  async _reapplyMaintainedSubmission() {
    const flow = this.maintainedSubmissionFlow;
    if (!flow?.abilityActive) return false;

    const maintainer = this.players[flow.maintainerIndex];
    const opponent = this.players[1 - flow.maintainerIndex];
    const submission = this._resolveMaintainedSubmissionCard();
    if (!submission) {
      this._disableMaintainHoldAbility('missing');
      return false;
    }

    const damage = this._calcManeuverDamage(maintainer, opponent, submission);
    this.actionLog.push({
      message: this._gc().log.maintainHoldReapplied(submission.name, damage),
    });

    return this._continueManeuverAfterReversal(maintainer, opponent, submission, damage, {
      isMaintainedReapplication: true,
    });
  }

  _peekManeuverDamage(player, opponent, played) {
    const idx = this._playerIndex(player);
    let damage = played.damage || 0;
    if (opponent.superstar.id === 'mankind' && damage > 0) {
      damage = Math.max(0, damage - 1);
    }
    damage += this.nextManeuverBonus[idx];

    const turnBonus = this.turnDamageBonus[idx];
    damage += turnBonus.all || 0;
    const subtype = played.subtype;
    if (subtype && turnBonus[subtype]) {
      damage += turnBonus[subtype];
    }

    damage += this._getRingPassiveManeuverDamageBonus(player);

    const afterMinDamageBonus = played.damageBonusAfterMinDamage;
    if (afterMinDamageBonus) {
      const lastDamage = player.turnState?.lastSuccessfulManeuverDamage;
      if (lastDamage != null && lastDamage >= (afterMinDamageBonus.min || 0)) {
        damage += afterMinDamageBonus.value || 0;
      }
    }

    if (played.ringTitleWordDamageBonus) {
      damage += this._getRingTitleWordDamageBonus(player, played.ringTitleWordDamageBonus);
    }

    const afterSubtypeBonus = played.damageBonusAfterLastSubtype;
    if (
      afterSubtypeBonus &&
      player.turnState?.lastSuccessfulManeuverSubtype === afterSubtypeBonus.subtype
    ) {
      damage += afterSubtypeBonus.value || 0;
    }

    if (played.subtype === 'strike' && player.turnState?.nextStrikeBonus) {
      damage += player.turnState.nextStrikeBonus;
    }

    if (played.subtype === 'grapple' && player.turnState?.nextGrappleBonus) {
      damage += player.turnState.nextGrappleBonus;
    }

    if (player.turnState?.nextCardManeuverBonus) {
      damage += player.turnState.nextCardManeuverBonus;
    }

    const subtypeBonus = player.turnState?.nextCardSubtypeBonus;
    if (subtypeBonus && played.subtype === subtypeBonus.subtype) {
      damage += subtypeBonus.value;
    }

    return damage;
  }

  _calcManeuverDamage(player, opponent, played) {
    const damage = this._peekManeuverDamage(player, opponent, played);
    const idx = this._playerIndex(player);
    this.nextManeuverBonus[idx] = 0;

    if (played.subtype === 'strike' && player.turnState?.nextStrikeBonus) {
      player.turnState.nextStrikeBonus = 0;
    }

    if (played.subtype === 'grapple' && player.turnState?.nextGrappleBonus) {
      player.turnState.nextGrappleBonus = 0;
    }

    if (player.turnState?.nextCardManeuverBonus) {
      player.turnState.nextCardManeuverBonus = 0;
    }

    if (
      player.turnState?.nextCardSubtypeBonus &&
      played.subtype === player.turnState.nextCardSubtypeBonus.subtype
    ) {
      player.turnState.nextCardSubtypeBonus = null;
    }

    return damage;
  }

  _applyNextStrikeBonus(player, sourceName, bonus) {
    if (!player.turnState) player.turnState = this._emptyTurnState();
    player.turnState.nextStrikeBonus = bonus;
    this.actionLog.push({
      message: this._gc().log.nextStrikeBonus(sourceName, bonus),
    });
  }

  _applyIrishWhipSetup(player, card, strikeBonus = 5) {
    if (!player.turnState) player.turnState = this._emptyTurnState();
    player.turnState.irishWhipPlayed = true;
    this._applyNextStrikeBonus(player, card.name, strikeBonus);
  }

  _beginJockeyingChoice(player, playerIndex, sourceName) {
    this.cardEffectFlow = {
      type: 'choice',
      choiceId: 'jockeyingForPosition',
      playerIndex,
      sourceName,
    };
    this._notify();
    return true;
  }

  _beginDiscardFromHandPrompt(player, playerIndex, sourceName, count, meta = {}) {
    if (player.hand.length === 0) {
      this.actionLog.push({
        message: this._gc().log.noHandToDiscard(sourceName),
      });
      return false;
    }

    this.cardEffectFlow = {
      type: 'discardFromHand',
      playerIndex,
      sourceName,
      count,
      selectedIds: [],
      meta,
    };
    this._notify();
    return true;
  }

  _discardEntireHandToRingside(player, sourceName, whoLabel) {
    const cards = [...player.hand];
    player.hand = [];
    for (const card of cards) {
      player.ringside.push(card);
    }
    if (cards.length > 0) {
      const names = cards.map((c) => c.name).join(', ');
      this.actionLog.push({
        message: this._gc().log.discardedEntireHand(sourceName, whoLabel, names),
      });
    }
    this._notify();
    return cards.length;
  }

  async _beginDiscardAllHands(activePlayer, activeIndex, opponent, opponentIndex, sourceName) {
    this.discardAllHandsFlow = {
      activeIndex,
      opponentIndex,
      sourceName,
      phase: 'active',
    };
    return await this._advanceDiscardAllHands();
  }

  async _advanceDiscardAllHands() {
    const flow = this.discardAllHandsFlow;
    if (!flow) return false;

    if (flow.phase === 'active') {
      const player = this.players[flow.activeIndex];
      const count = player.hand.length;
      if (count === 0) {
        flow.phase = 'opponent';
        return await this._advanceDiscardAllHands();
      }

      const autoPick = this.engineMode === 'goldfish' || !player.isHuman;
      if (autoPick) {
        this._discardEntireHandToRingside(player, flow.sourceName, 'you');
        flow.phase = 'opponent';
        return await this._advanceDiscardAllHands();
      }

      const paused = this._beginDiscardFromHandPrompt(
        player,
        flow.activeIndex,
        flow.sourceName,
        count,
        { discardAllHands: true, phase: 'active' }
      );
      return !!paused;
    }

    if (flow.phase === 'opponent') {
      const opponent = this.players[flow.opponentIndex];
      const count = opponent.hand.length;
      if (count === 0) {
        this.discardAllHandsFlow = null;
        this.actionLog.push({
          message: this._gc().log.opponentNoHandToDiscard(flow.sourceName),
        });
        this._notify();
        return false;
      }

      return await this._beginOpponentControlledDiscard(
        opponent,
        flow.opponentIndex,
        flow.sourceName,
        count,
        { resumePipeline: true, discardAllHands: true }
      );
    }

    return false;
  }

  async _resumeDiscardAllHandsAfterActiveDiscard() {
    if (!this.discardAllHandsFlow || this.discardAllHandsFlow.phase !== 'active') {
      return false;
    }
    this.discardAllHandsFlow.phase = 'opponent';
    const paused = await this._advanceDiscardAllHands();
    return !!paused;
  }

  async _opponentTopArsenalToRingside(opponent, sourceName, count = 5) {
    const opponentIndex = this._playerIndex(opponent);
    const moved = [];
    const requested = count;
    const sourceCard = { name: sourceName };

    for (let i = 0; i < count && opponent.arsenal.length > 0; i++) {
      const top = opponent.arsenal.pop();
      this._notify();

      await this.onArsenalToRingside({
        card: top,
        sourceManeuver: sourceCard,
        playerSeat: opponentIndex,
        onReveal: () => {
          opponent.ringside.push(top);
          moved.push(top);
          this._notify();
        },
      });
    }

    if (moved.length > 0) {
      const names = moved.map((c) => c.name).join(', ');
      this.actionLog.push({
        message:
          moved.length === requested
            ? this._gc().log.opponentTopArsenalToRingside(sourceName, moved.length, names)
            : this._gc().log.opponentTopArsenalPartial(sourceName, moved.length, requested),
      });
      this._notify();
    }
  }

  _beginDrawOrOpponentChoice(player, playerIndex, sourceName, count) {
    this.cardEffectFlow = {
      type: 'choice',
      choiceId: 'drawOrOpponentDiscard',
      playerIndex,
      sourceName,
      count,
    };
    this._notify();
    return true;
  }

  _beginDrawOrOpponentDiscardUpToChoice(player, playerIndex, sourceName, max = 5) {
    this.cardEffectFlow = {
      type: 'choice',
      choiceId: 'drawOrOpponentDiscardUpTo',
      playerIndex,
      sourceName,
      max,
    };
    this._notify();
    return true;
  }

  _beginForceOpponentDiscardCountPrompt(player, playerIndex, sourceName, max = 5) {
    const opponent = this.players[1 - playerIndex];
    const available = Math.min(max, opponent.hand.length);
    if (available === 0) {
      this.actionLog.push({
        message: this._gc().log.opponentNoHandToDiscard(sourceName),
      });
      return false;
    }

    this.cardEffectFlow = {
      type: 'forceOpponentDiscardCountChoice',
      playerIndex,
      opponentIndex: 1 - playerIndex,
      sourceName,
      max,
      selectedCount: 0,
    };
    this._notify();
    return true;
  }

  _beginMarkingOutChoice(player, playerIndex, sourceName) {
    this.cardEffectFlow = {
      type: 'choice',
      choiceId: 'markingOut',
      playerIndex,
      sourceName,
    };
    this._notify();
    return true;
  }

  _drawCountAvailableMax(player, max) {
    return Math.min(max || 0, player.arsenal.length);
  }

  _discardUpToAvailableMax(player, max) {
    return Math.min(max || 0, player.hand.length);
  }

  _shuffleRingsideUpToAvailableMax(player, max) {
    return Math.min(max || 0, player.ringside.length);
  }

  _beginShuffleRingsideUpToPrompt(
    player,
    playerIndex,
    sourceName,
    max = 2,
    { exact = true } = {}
  ) {
    if (player.ringside.length === 0) {
      this.actionLog.push({
        message: this._gc().log.shuffledZeroRingside(sourceName),
      });
      return false;
    }

    const maxSelect = Math.min(max, player.ringside.length);
    return this._beginShuffleRingsideSelectPrompt(player, playerIndex, sourceName, maxSelect, {
      exact,
    });
  }

  _beginShuffleRingsideSelectPrompt(
    player,
    playerIndex,
    sourceName,
    maxSelect,
    { exact = true } = {}
  ) {
    this.cardEffectFlow = {
      type: 'shuffleRingsideIntoArsenal',
      playerIndex,
      sourceName,
      count: exact ? maxSelect : maxSelect,
      maxSelect,
      exact,
      selectedIds: [],
    };
    this._notify();
    return true;
  }

  _beginDiscardUpToPrompt(player, playerIndex, sourceName, max = 2) {
    const available = this._discardUpToAvailableMax(player, max);
    if (available === 0) {
      if (this.effectPipelineFlow) {
        this.effectPipelineFlow.discardedCount = 0;
      }
      this.actionLog.push({
        message: this._gc().log.discardedZero(sourceName),
      });
      return false;
    }

    this.cardEffectFlow = {
      type: 'discardCountChoice',
      playerIndex,
      sourceName,
      max,
      selectedCount: 0,
    };
    this._notify();
    return true;
  }

  adjustDiscardCount(playerIndex, delta) {
    const flow = this.cardEffectFlow;
    if (
      !flow ||
      flow.playerIndex !== playerIndex ||
      (flow.type !== 'discardCountChoice' && flow.type !== 'forceOpponentDiscardCountChoice')
    ) {
      return false;
    }

    const player =
      flow.type === 'forceOpponentDiscardCountChoice'
        ? this.players[flow.opponentIndex]
        : this.players[playerIndex];
    const available =
      flow.type === 'forceOpponentDiscardCountChoice'
        ? Math.min(flow.max, player.hand.length)
        : this._discardUpToAvailableMax(player, flow.max);
    const next = (flow.selectedCount ?? 0) + delta;
    flow.selectedCount = Math.max(0, Math.min(available, next));
    this._notify();
    return true;
  }

  async confirmDiscardCount(playerIndex) {
    const flow = this.cardEffectFlow;
    if (
      !flow ||
      flow.playerIndex !== playerIndex ||
      (flow.type !== 'discardCountChoice' && flow.type !== 'forceOpponentDiscardCountChoice')
    ) {
      return false;
    }

    if (flow.type === 'forceOpponentDiscardCountChoice') {
      const count = flow.selectedCount ?? 0;
      const sourceName = flow.sourceName;
      const opponent = this.players[flow.opponentIndex];
      this.cardEffectFlow = null;
      this._notify();

      if (count === 0) {
        this.actionLog.push({
          message: this._gc().log.forcedOpponentDiscardZero(sourceName),
        });
        if (this.effectPipelineFlow?.paused) {
          await window.RawDeal.EffectPipeline.resumeAfterCardEffect(this);
        }
        return true;
      }

      const paused = await this._beginOpponentControlledDiscard(
        opponent,
        flow.opponentIndex,
        sourceName,
        count,
        { resumePipeline: true }
      );
      return !!paused;
    }

    const player = this.players[playerIndex];
    const count = flow.selectedCount ?? 0;
    const sourceName = flow.sourceName;

    if (count === 0) {
      if (this.effectPipelineFlow) {
        this.effectPipelineFlow.discardedCount = 0;
      }
      this.actionLog.push({
        message: this._gc().log.discardedZero(sourceName),
      });
      this.cardEffectFlow = null;
      this._notify();
      if (this.effectPipelineFlow?.paused) {
        await window.RawDeal.EffectPipeline.resumeAfterCardEffect(this);
      }
      return true;
    }

    this.cardEffectFlow = null;
    this._notify();
    return this._beginDiscardFromHandPrompt(player, playerIndex, sourceName, count);
  }

  _beginReturnFromRingsidePrompt(player, playerIndex, sourceName, count) {
    this.cardEffectFlow = {
      type: 'returnFromRingside',
      playerIndex,
      sourceName,
      count,
      selectedIds: [],
    };
    this._notify();
    return true;
  }

  async _beginPickArsenalOrRingsidePrompt(
    player,
    playerIndex,
    sourceName,
    { cardId = null } = {}
  ) {
    const arsenalMatches = cardId
      ? player.arsenal.filter((c) => c.id === cardId)
      : player.arsenal;
    const ringsideMatches = cardId
      ? player.ringside.filter((c) => c.id === cardId)
      : player.ringside;

    if (arsenalMatches.length === 0 && ringsideMatches.length === 0) {
      this.actionLog.push({
        message: cardId
          ? this._gc().log.searchArsenalOrRingsideNoMatch(sourceName, cardId)
          : this._gc().log.noArsenalOrRingsideToPick(sourceName),
      });
      this._shuffle(player.arsenal);
      this.actionLog.push({
        message: this._gc().log.shuffledArsenal(sourceName, false),
      });
      return false;
    }

    this.cardEffectFlow = {
      type: 'pickArsenalOrRingsideToHand',
      playerIndex,
      sourceName,
      selectedId: null,
      selectedZone: null,
      filterCardId: cardId || null,
    };
    if (cardId) {
      this.actionLog.push({
        message: this._gc().log.searchArsenalOrRingsideLook(sourceName, cardId),
      });
    }
    this._notify();
    return true;
  }

  async _beginSearchArsenalOrRingsideForCardPrompt(
    player,
    playerIndex,
    sourceName,
    { cardId = null } = {}
  ) {
    return this._beginPickArsenalOrRingsidePrompt(player, playerIndex, sourceName, {
      cardId,
    });
  }

  async _completePickArsenalOrRingside(player, playerIndex, sourceName, card, zone) {
    if (zone === 'ringside') {
      const idx = player.ringside.findIndex((c) => c.instanceId === card.instanceId);
      if (idx >= 0) {
        const [picked] = player.ringside.splice(idx, 1);
        player.hand.push(picked);
        this.actionLog.push({
          message: this._gc().log.pickedFromRingsideToHand(sourceName, picked.name),
        });
      }
    } else {
      const idx = player.arsenal.findIndex((c) => c.instanceId === card.instanceId);
      if (idx >= 0) {
        const [picked] = player.arsenal.splice(idx, 1);
        player.hand.push(picked);
        this.actionLog.push({
          message: this._gc().log.pickedFromArsenalToHand(sourceName, picked.name),
        });
      }
    }

    this._shuffle(player.arsenal);
    this.actionLog.push({
      message: this._gc().log.shuffledArsenal(sourceName, false),
    });
    this.cardEffectFlow = null;
    await this._finishCardEffectResolution();
    return true;
  }

  selectArsenalOrRingsidePick(playerIndex, instanceId, zone) {
    const flow = this.cardEffectFlow;
    if (!flow || flow.playerIndex !== playerIndex) return false;
    if (flow.type !== 'pickArsenalOrRingsideToHand') return false;

    const player = this.players[playerIndex];
    const pool = zone === 'ringside' ? player.ringside : player.arsenal;
    const card = pool.find((c) => c.instanceId === instanceId);
    if (!card) return false;
    if (flow.filterCardId && card.id !== flow.filterCardId) return false;
    if (flow.selectedId === instanceId && flow.selectedZone === zone) {
      flow.selectedId = null;
      flow.selectedZone = null;
    } else {
      flow.selectedId = instanceId;
      flow.selectedZone = zone;
    }

    this._notify();
    return true;
  }

  async confirmArsenalOrRingsidePick(playerIndex) {
    if (!this.cardEffectFlow || this.cardEffectFlow.playerIndex !== playerIndex) return false;
    if (this.cardEffectFlow.type !== 'pickArsenalOrRingsideToHand') return false;

    const flow = this.cardEffectFlow;
    if (!flow.selectedId || !flow.selectedZone) return false;

    return this.pickArsenalOrRingsideToHand(
      playerIndex,
      flow.selectedId,
      flow.selectedZone
    );
  }

  async pickArsenalOrRingsideToHand(playerIndex, instanceId, zone) {
    if (!this.cardEffectFlow || this.cardEffectFlow.playerIndex !== playerIndex) return false;
    if (this.cardEffectFlow.type !== 'pickArsenalOrRingsideToHand') return false;

    const player = this.players[playerIndex];
    const pool = zone === 'ringside' ? player.ringside : player.arsenal;
    const card = pool.find((c) => c.instanceId === instanceId);
    if (!card) return false;

    const { sourceName } = this.cardEffectFlow;
    return this._completePickArsenalOrRingside(
      player,
      playerIndex,
      sourceName,
      card,
      zone
    );
  }

  _beginDrawUpToPrompt(player, playerIndex, sourceName, max = 3) {
    this.cardEffectFlow = {
      type: 'drawCountChoice',
      playerIndex,
      sourceName,
      max,
      selectedCount: 0,
    };
    this._notify();
    return true;
  }

  adjustDrawCount(playerIndex, delta) {
    const flow = this.cardEffectFlow;
    if (!flow || flow.type !== 'drawCountChoice' || flow.playerIndex !== playerIndex) {
      return false;
    }

    const player = this.players[playerIndex];
    const available = this._drawCountAvailableMax(player, flow.max);
    const next = (flow.selectedCount ?? 0) + delta;
    flow.selectedCount = Math.max(0, Math.min(available, next));
    this._notify();
    return true;
  }

  async confirmDrawCount(playerIndex) {
    const flow = this.cardEffectFlow;
    if (!flow || flow.type !== 'drawCountChoice' || flow.playerIndex !== playerIndex) {
      return false;
    }

    const player = this.players[playerIndex];
    const count = flow.selectedCount ?? 0;
    let drawn = 0;
    for (let i = 0; i < count; i++) {
      if (this._drawCard(player)) drawn += 1;
    }

    this.actionLog.push({
      message: this._gc().log.drewZeroOrCards(flow.sourceName, drawn),
    });

    this.cardEffectFlow = null;
    this._notify();

    if (this.pendingEgoBoostDraws.length > 0) {
      const next = this.pendingEgoBoostDraws.shift();
      const victim = this.players[next.victimIndex];
      this._beginDrawUpToPrompt(victim, next.victimIndex, 'Ego Boost', 2);
      return true;
    }

    const resumeMeta = this.opponentDiscardResumeMeta;
    if (resumeMeta) {
      this.opponentDiscardResumeMeta = null;
      await this._finishOpponentControlledDiscard(resumeMeta);
      return true;
    }

    if (this.effectPipelineFlow?.paused) {
      await window.RawDeal.EffectPipeline.resumeAfterCardEffect(this);
      return true;
    }

    return true;
  }

  _hasEgoBoostInHand(player) {
    return player.hand.some((c) => c.id === 'ego-boost');
  }

  _discardEgoBoostFromHand(player) {
    const idx = player.hand.findIndex((c) => c.id === 'ego-boost');
    if (idx < 0) return null;
    const [card] = player.hand.splice(idx, 1);
    player.ringside.push(card);
    return card;
  }

  _shouldOfferEgoBoostChoice(victim) {
    if (!this._hasEgoBoostInHand(victim)) return false;
    return this.engineMode === 'multiplayer' && victim.isHuman;
  }

  _offerEgoBoostChoice(victimIndex, sourceName, count, meta) {
    this.cardEffectFlow = {
      type: 'choice',
      choiceId: 'egoBoostOrDiscard',
      playerIndex: victimIndex,
      sourceName,
      count,
      meta,
    };
    this._notify();
    return true;
  }

  async _beginPendingEgoBoostDraws(meta) {
    if (!this.pendingEgoBoostDraws.length) {
      return await this._finishOpponentControlledDiscard(meta);
    }

    const next = this.pendingEgoBoostDraws.shift();
    const victim = this.players[next.victimIndex];
    this._beginDrawUpToPrompt(victim, next.victimIndex, 'Ego Boost', 2);
    return true;
  }

  async _beginOpponentControlledDiscard(victim, victimIndex, sourceName, count, meta = {}) {
    const batchCards = meta.batchCards || null;
    let discardCount = count;
    if (batchCards) {
      discardCount = Math.min(count, batchCards.length);
    } else {
      discardCount = Math.min(count, victim.hand.length);
    }

    if (discardCount <= 0) {
      if (!batchCards?.length) {
        this.actionLog.push({
          message: this._gc().log.opponentNoHandToDiscard(sourceName),
        });
      }
      return await this._finishOpponentControlledDiscard(meta);
    }

    if (this._shouldOfferEgoBoostChoice(victim)) {
      return this._offerEgoBoostChoice(victimIndex, sourceName, discardCount, meta);
    }

    return await this._executeOpponentControlledDiscard(
      victim,
      victimIndex,
      sourceName,
      discardCount,
      meta
    );
  }

  async _applyEgoBoostReaction(victim, victimIndex, sourceName, count, meta) {
    const ego = this._discardEgoBoostFromHand(victim);
    if (!ego) return false;

    this.actionLog.push({
      message: this._gc().log.egoBoostReplacedDiscard(sourceName),
    });

    if (this.pendingEgoBoostDraws.length === 0) {
      this.opponentDiscardResumeMeta = meta;
    }
    this.pendingEgoBoostDraws.push({ victimIndex });

    const remaining = Math.max(0, count - 1);
    this.cardEffectFlow = null;
    this._notify();

    if (remaining > 0 && this._shouldOfferEgoBoostChoice(victim)) {
      return this._offerEgoBoostChoice(victimIndex, sourceName, remaining, meta);
    }
    if (remaining > 0) {
      return await this._executeOpponentControlledDiscard(
        victim,
        victimIndex,
        sourceName,
        remaining,
        meta
      );
    }
    return await this._beginPendingEgoBoostDraws(meta);
  }

  async _executeOpponentControlledDiscard(victim, victimIndex, sourceName, count, meta = {}) {
    if (count <= 0) {
      return await this._beginPendingEgoBoostDraws(meta);
    }

    const batchCards = meta.batchCards;
    if (batchCards?.length) {
      const autoPick = this.engineMode === 'goldfish' || !victim.isHuman;
      let toRemove = [];

      if (batchCards.length <= count) {
        toRemove = [...batchCards];
      } else if (autoPick) {
        const pool = [...batchCards];
        for (let i = 0; i < count; i++) {
          const idx = Math.floor(Math.random() * pool.length);
          toRemove.push(pool.splice(idx, 1)[0]);
        }
      } else {
        return this._beginOpponentDiscardFromHandPrompt(
          victim,
          victimIndex,
          sourceName,
          count,
          meta,
          batchCards.map((c) => c.instanceId)
        );
      }

      for (const card of toRemove) {
        const idx = victim.hand.findIndex((c) => c.instanceId === card.instanceId);
        if (idx >= 0) {
          const [removed] = victim.hand.splice(idx, 1);
          victim.ringside.push(removed);
        }
      }
      if (toRemove.length > 0) {
        const names = toRemove.map((c) => c.name).join(', ');
        this.actionLog.push({
          message: this._gc().log.opponentDiscarded(sourceName, names),
        });
      }
      return await this._beginPendingEgoBoostDraws(meta);
    }

    const autoPick = this.engineMode === 'goldfish' || !victim.isHuman;
    if (autoPick) {
      const { count: discarded, cards } = this._forceOpponentDiscardFromHand(victim, count);
      if (discarded > 0) {
        const names = cards.map((c) => c.name).join(', ');
        this.actionLog.push({
          message: this._gc().log.opponentDiscarded(sourceName, names),
        });
      } else {
        this.actionLog.push({
          message: this._gc().log.opponentNoHandToDiscard(sourceName),
        });
      }
      return await this._beginPendingEgoBoostDraws(meta);
    }

    return this._beginOpponentDiscardFromHandPrompt(victim, victimIndex, sourceName, count, meta);
  }

  async _finishOpponentControlledDiscard(meta = {}) {
    if (meta.afterComplete === 'cleanBreak') {
      const reversalPlayer = this.players[meta.reversalPlayerIndex];
      const drawn = this._drawCard(reversalPlayer);
      if (drawn) {
        this.actionLog.push({
          message: this._gc().log.drewOneCard(meta.sourceName),
        });
      }
      this._notify();
      await this._runAutoPhases();
      return false;
    }

    if (meta.superstarAbilityOwnerIndex !== undefined) {
      const owner = this.players[meta.superstarAbilityOwnerIndex];
      if (owner) owner.superstarAbilityUsed = true;
      this._notify();
      return false;
    }

    if (meta.discardAllHands) {
      this.discardAllHandsFlow = null;
      if (meta.resumePipeline && this.effectPipelineFlow?.paused) {
        await window.RawDeal.EffectPipeline.resumeAfterCardEffect(this);
      }
      return false;
    }

    if (meta.resumePipeline && this.effectPipelineFlow?.paused) {
      await window.RawDeal.EffectPipeline.resumeAfterCardEffect(this);
      return false;
    }

    return false;
  }

  async _beginDiscardFromOpponentHandPipelineStep(pipeline, opponent, sourceName, step) {
    const snapshot = pipeline.snapshotInstanceIds;
    if (!snapshot?.size) {
      this.actionLog.push({
        message: this._gc().log.noOpponentHandToDiscard(sourceName),
      });
      return false;
    }

    let toDiscard = [];
    if (step.mode === 'chosen') {
      const ids = pipeline.selectedInstanceIds || [];
      toDiscard = opponent.hand.filter(
        (c) => ids.includes(c.instanceId) && snapshot.has(c.instanceId)
      );
    } else {
      const filter = step.filter || {};
      toDiscard = opponent.hand.filter(
        (c) =>
          snapshot.has(c.instanceId) &&
          window.RawDeal.EffectPipeline._cardMatchesFilter(c, filter)
      );
    }

    if (toDiscard.length === 0) {
      this.actionLog.push({
        message: this._gc().log.noMatchingOpponentHand(sourceName),
      });
      return false;
    }

    return await this._beginOpponentControlledDiscard(
      opponent,
      pipeline.opponentIndex,
      sourceName,
      toDiscard.length,
      { batchCards: toDiscard, resumePipeline: true }
    );
  }

  _buildRingSelectSections(player, { areas = ['maneuvers', 'reversals', 'actions'], maxDamage = Infinity } = {}) {
    const utils = window.RawDeal.CardUtils;
    const ring = player.ring || { maneuvers: [], reversals: [], actions: [] };
    const labels = {
      maneuvers: 'Maneuvers',
      reversals: 'Reversals',
      actions: 'Actions',
    };

    return areas
      .map((area) => ({
        label: labels[area],
        ringArea: area,
        cards: (ring[area] || []).map((card) => {
          const ringDamage = utils.getRingDamageValue(card, area);
          return {
            ...card,
            ringArea: area,
            ringDamage,
            selectable: ringDamage <= maxDamage,
          };
        }),
      }))
      .filter((section) => section.cards.length > 0);
  }

  _buildOpponentRingSelectSections(opponent, maxDamage) {
    return this._buildRingSelectSections(opponent, { maxDamage });
  }

  _listManeuverReversalRingCards(player) {
    const ring = player.ring || { maneuvers: [], reversals: [], actions: [] };
    const entries = [];
    for (const area of ['maneuvers', 'reversals']) {
      for (const card of ring[area] || []) {
        entries.push({ card, ringArea: area });
      }
    }
    return entries;
  }

  _pickHighestDamageRingRemoval(candidates) {
    const utils = window.RawDeal.CardUtils;
    let best = -1;
    for (const entry of candidates) {
      const damage = utils.getRingDamageValue(entry.card, entry.ringArea);
      if (damage > best) best = damage;
    }
    const tied = candidates.filter(
      (entry) => utils.getRingDamageValue(entry.card, entry.ringArea) === best
    );
    return tied[Math.floor(Math.random() * tied.length)];
  }

  _findHigherFortitudePlayer() {
    const p0 = this.players[0];
    const p1 = this.players[1];
    this._syncFortitude(p0);
    this._syncFortitude(p1);
    if (p0.fortitude > p1.fortitude) {
      return { higher: p0, higherIndex: 0, other: p1 };
    }
    if (p1.fortitude > p0.fortitude) {
      return { higher: p1, higherIndex: 1, other: p0 };
    }
    return null;
  }

  async _beginBalanceFortitudeByRingRemoval(sourceName) {
    return await this._continueBalanceFortitudeByRingRemoval(sourceName);
  }

  async _continueBalanceFortitudeByRingRemoval(sourceName) {
    const match = this._findHigherFortitudePlayer();
    if (!match) {
      this.cardEffectFlow = null;
      return false;
    }

    const { higher, higherIndex } = match;
    const candidates = this._listManeuverReversalRingCards(higher);
    if (candidates.length === 0) {
      this.actionLog.push({
        message: this._gc().log.comebackNoCardsToRemove(
          sourceName,
          this._gc().whoHas(higher.isHuman)
        ),
      });
      this.cardEffectFlow = null;
      return false;
    }

    const autoPick = this.engineMode === 'goldfish' || !higher.isHuman;
    if (autoPick) {
      const pick = this._pickHighestDamageRingRemoval(candidates);
      const card = this._removeCardFromRing(higher, pick.card.instanceId, pick.ringArea);
      if (card) {
        this.actionLog.push({
          message: this._gc().log.removedFromRing(sourceName, card.name),
        });
      }
      this._notify();
      return await this._continueBalanceFortitudeByRingRemoval(sourceName);
    }

    this.cardEffectFlow = {
      type: 'balanceFortitudeRingRemoval',
      playerIndex: higherIndex,
      sourceName,
      selectedId: null,
      selectedRingArea: null,
    };
    this._notify();
    return true;
  }

  _beginRemoveOpponentRingCardPrompt(player, opponent, playerIndex, sourceName) {
    const maxDamage = player.fortitude;
    const sections = this._buildOpponentRingSelectSections(opponent, maxDamage);
    const hasSelectable = sections.some((section) =>
      section.cards.some((card) => card.selectable)
    );

    if (!hasSelectable) {
      this.actionLog.push({
        message: this._gc().log.noValidOpponentRing(sourceName),
      });
      return false;
    }

    this.cardEffectFlow = {
      type: 'removeOpponentRingCard',
      playerIndex,
      sourceName,
      maxDamage,
      selectedId: null,
      selectedRingArea: null,
    };
    this._notify();
    return true;
  }

  _removeCardFromRing(player, instanceId, ringArea) {
    const area = player.ring?.[ringArea];
    if (!area) return null;

    const idx = area.findIndex((c) => c.instanceId === instanceId);
    if (idx < 0) return null;

    const [card] = area.splice(idx, 1);
    player.ringside.push(card);
    if (ringArea === 'maneuvers' || ringArea === 'reversals') {
      this._syncFortitude(player);
    }
    return card;
  }

  _removeCardFromOpponentRing(opponent, instanceId, ringArea) {
    return this._removeCardFromRing(opponent, instanceId, ringArea);
  }

  toggleRemoveOpponentRingSelect(playerIndex, instanceId, ringArea) {
    const flow = this.cardEffectFlow;
    if (!flow || flow.playerIndex !== playerIndex) {
      return false;
    }

    if (flow.type === 'balanceFortitudeRingRemoval') {
      const target = this.players[flow.playerIndex];
      const card = target.ring?.[ringArea]?.find((c) => c.instanceId === instanceId);
      if (!card) return false;
      if (ringArea !== 'maneuvers' && ringArea !== 'reversals') return false;

      if (flow.selectedId === instanceId) {
        flow.selectedId = null;
        flow.selectedRingArea = null;
      } else {
        flow.selectedId = instanceId;
        flow.selectedRingArea = ringArea;
      }

      this._notify();
      return true;
    }

    if (flow.type !== 'removeOpponentRingCard') {
      return false;
    }

    const opponent = this.players[1 - playerIndex];
    const utils = window.RawDeal.CardUtils;
    const card = opponent.ring?.[ringArea]?.find((c) => c.instanceId === instanceId);
    if (!card) return false;
    if (utils.getRingDamageValue(card, ringArea) > flow.maxDamage) return false;

    if (flow.selectedId === instanceId) {
      flow.selectedId = null;
      flow.selectedRingArea = null;
    } else {
      flow.selectedId = instanceId;
      flow.selectedRingArea = ringArea;
    }

    this._notify();
    return true;
  }

  async confirmRemoveOpponentRingCard(playerIndex) {
    const flow = this.cardEffectFlow;
    if (
      !flow ||
      flow.playerIndex !== playerIndex ||
      !flow.selectedId ||
      !flow.selectedRingArea
    ) {
      return false;
    }

    if (flow.type === 'balanceFortitudeRingRemoval') {
      const target = this.players[flow.playerIndex];
      const card = this._removeCardFromRing(target, flow.selectedId, flow.selectedRingArea);
      if (!card) return false;

      const sourceName = flow.sourceName;
      this.actionLog.push({
        message: this._gc().log.removedFromRing(sourceName, card.name),
      });
      this.cardEffectFlow = null;
      this._notify();

      const paused = await this._continueBalanceFortitudeByRingRemoval(sourceName);
      if (!paused) {
        await this._finishCardEffectResolution();
      }
      return true;
    }

    if (flow.type !== 'removeOpponentRingCard') {
      return false;
    }

    const opponent = this.players[1 - playerIndex];
    const card = this._removeCardFromOpponentRing(
      opponent,
      flow.selectedId,
      flow.selectedRingArea
    );
    if (!card) return false;

    this.actionLog.push({
      message: this._gc().log.removedFromOpponentRing(flow.sourceName, card.name),
    });
    await this._finishCardEffectResolution();
    return true;
  }

  _beginArsenalTopReorderPrompt(
    targetPlayer,
    actingPlayerIndex,
    sourceName,
    count = 5,
    { targetPlayerIndex } = {}
  ) {
    const resolvedTargetIndex =
      targetPlayerIndex ?? this._playerIndex(targetPlayer);
    const n = Math.min(count, targetPlayer.arsenal.length);
    if (n === 0) {
      this.actionLog.push({
        message: this._gc().log.arsenalEmpty(sourceName),
      });
      return false;
    }

    const topSlice = targetPlayer.arsenal.slice(-n);
    const orderedIds = topSlice.map((c) => c.instanceId).reverse();
    const target =
      resolvedTargetIndex === actingPlayerIndex ? 'self' : 'opponent';

    this.cardEffectFlow = {
      type: 'arsenalReorder',
      playerIndex: actingPlayerIndex,
      targetPlayerIndex: resolvedTargetIndex,
      target,
      sourceName,
      count: n,
      orderedIds,
    };
    this.actionLog.push({
      message: this._gc().log.lookAtTopArsenal(sourceName, n, target),
    });
    this._notify();
    return true;
  }

  _targetPlayerForArsenalReorder(flow) {
    return this.players[flow.targetPlayerIndex];
  }

  _validateArsenalReorderIds(targetPlayer, flow, orderedIds) {
    if (!Array.isArray(orderedIds) || orderedIds.length !== flow.count) return false;
    const topSlice = targetPlayer.arsenal.slice(-flow.count);
    const expected = new Set(topSlice.map((c) => c.instanceId));
    return orderedIds.every((id) => expected.has(id));
  }

  _applyArsenalReorder(targetPlayer, orderedIds) {
    const n = orderedIds.length;
    const topSlice = targetPlayer.arsenal.splice(-n, n);
    const byId = new Map(topSlice.map((c) => [c.instanceId, c]));
    for (let i = orderedIds.length - 1; i >= 0; i--) {
      targetPlayer.arsenal.push(byId.get(orderedIds[i]));
    }
  }

  updateArsenalReorderOrder(playerIndex, orderedIds) {
    if (!this.cardEffectFlow || this.cardEffectFlow.playerIndex !== playerIndex) return false;
    if (this.cardEffectFlow.type !== 'arsenalReorder') return false;

    const flow = this.cardEffectFlow;
    const targetPlayer = this._targetPlayerForArsenalReorder(flow);
    if (!this._validateArsenalReorderIds(targetPlayer, flow, orderedIds)) return false;

    flow.orderedIds = [...orderedIds];
    this._notify();
    return true;
  }

  async shuffleArsenalFromPrompt(playerIndex) {
    if (!this.cardEffectFlow || this.cardEffectFlow.playerIndex !== playerIndex) return false;
    if (this.cardEffectFlow.type !== 'arsenalReorder') return false;

    const flow = this.cardEffectFlow;
    const targetPlayer = this._targetPlayerForArsenalReorder(flow);
    this._shuffle(targetPlayer.arsenal);
    this.actionLog.push({
      message: this._gc().log.shuffledArsenal(
        flow.sourceName,
        flow.target === 'opponent'
      ),
    });
    await this._finishCardEffectResolution();
    return true;
  }

  async confirmArsenalReorder(playerIndex, orderedIds) {
    if (!this.cardEffectFlow || this.cardEffectFlow.playerIndex !== playerIndex) return false;
    if (this.cardEffectFlow.type !== 'arsenalReorder') return false;

    const flow = this.cardEffectFlow;
    const targetPlayer = this._targetPlayerForArsenalReorder(flow);
    if (!this._validateArsenalReorderIds(targetPlayer, flow, orderedIds)) return false;

    this._applyArsenalReorder(targetPlayer, orderedIds);
    this.actionLog.push({
      message: this._gc().log.rearrangedTopArsenal(
        flow.sourceName,
        flow.count,
        flow.target
      ),
    });
    await this._finishCardEffectResolution();
    return true;
  }

  async _beginSearchArsenalForCardPrompt(player, playerIndex, sourceName, { cardId = null } = {}) {
    if (player.arsenal.length === 0) {
      this.actionLog.push({
        message: this._gc().log.searchArsenalEmpty(sourceName),
      });
      return false;
    }

    const matches = cardId
      ? player.arsenal.filter((c) => c.id === cardId)
      : player.arsenal;

    if (cardId && matches.length === 0) {
      this.actionLog.push({
        message: this._gc().log.searchArsenalNoMatch(sourceName, cardId),
      });
      this._shuffle(player.arsenal);
      this.actionLog.push({
        message: this._gc().log.shuffledArsenal(sourceName, false),
      });
      return false;
    }

    this.cardEffectFlow = {
      type: 'arsenalSearch',
      playerIndex,
      targetPlayerIndex: playerIndex,
      purpose: 'searchToHand',
      sourceName,
      selectCount: 1,
      selectedIds: [],
      filterCardId: cardId || null,
    };
    this.actionLog.push({
      message: this._gc().log.searchArsenalLook(sourceName, cardId),
    });
    this._notify();
    return true;
  }

  async _completeArsenalSearchToHand(player, playerIndex, sourceName, card) {
    if (card) {
      player.hand.push(card);
      this.actionLog.push({
        message: this._gc().log.pickedFromArsenalToHand(sourceName, card.name),
      });
    }
    this._shuffle(player.arsenal);
    this.actionLog.push({
      message: this._gc().log.shuffledArsenal(sourceName, false),
    });
    this.cardEffectFlow = null;
    this._notify();
    await this._finishCardEffectResolution();
    return true;
  }

  async _beginMarkingOutOwnArsenalPrompt(player, playerIndex, sourceName) {
    if (player.arsenal.length === 0) {
      this.actionLog.push({
        message: this._gc().log.markingOutEmptyOwnArsenal(sourceName),
      });
      return await this._completeMarkingOutToHand(player, playerIndex, sourceName, null);
    }

    this.cardEffectFlow = {
      type: 'arsenalSearch',
      playerIndex,
      targetPlayerIndex: playerIndex,
      purpose: 'toHand',
      sourceName,
      selectCount: 1,
      selectedIds: [],
    };
    this.actionLog.push({
      message: this._gc().log.markingOutLookOwn(sourceName),
    });
    this._notify();
    return true;
  }

  async _beginMarkingOutOpponentArsenalPrompt(player, playerIndex, sourceName) {
    const opponent = this.players[1 - playerIndex];
    const selectCount = Math.min(3, opponent.arsenal.length);

    if (selectCount === 0) {
      this.actionLog.push({
        message: this._gc().log.markingOutEmptyOpponentArsenal(sourceName),
      });
      return await this._completeMarkingOutToRingside(
        opponent,
        playerIndex,
        sourceName,
        []
      );
    }

    this.cardEffectFlow = {
      type: 'arsenalSearch',
      playerIndex,
      targetPlayerIndex: 1 - playerIndex,
      purpose: 'toRingside',
      sourceName,
      selectCount,
      selectedIds: [],
    };
    this.actionLog.push({
      message: this._gc().log.markingOutLookOpponent(sourceName),
    });
    this._notify();
    return true;
  }

  _validateArsenalSearchIds(targetPlayer, selectedIds, selectCount) {
    if (!Array.isArray(selectedIds) || selectedIds.length !== selectCount) return false;
    const valid = new Set(targetPlayer.arsenal.map((c) => c.instanceId));
    return selectedIds.every((id) => valid.has(id));
  }

  async _completeMarkingOutToHand(player, playerIndex, sourceName, card) {
    if (card) {
      player.hand.push(card);
      this.actionLog.push({
        message: this._gc().log.markingOutPutInHand(sourceName, card.name),
      });
    }
    this._shuffle(player.arsenal);
    this.actionLog.push({
      message: this._gc().log.shuffledArsenal(sourceName, false),
    });
    this.cardEffectFlow = null;
    this._notify();
    await this._forceEndTurnFromEffect(playerIndex);
    return true;
  }

  async _completeMarkingOutToRingside(opponent, playerIndex, sourceName, cards) {
    for (const card of cards) {
      opponent.ringside.push(card);
    }
    if (cards.length > 0) {
      const names = cards.map((c) => c.name).join(', ');
      this.actionLog.push({
        message: this._gc().log.markingOutPutOpponentInRingside(sourceName, names),
      });
    }
    this._shuffle(opponent.arsenal);
    this.actionLog.push({
      message: this._gc().log.shuffledArsenal(sourceName, true),
    });
    await this._finishCardEffectResolution();
    return true;
  }

  async toggleArsenalSearchSelection(playerIndex, instanceId) {
    if (!this.cardEffectFlow || this.cardEffectFlow.playerIndex !== playerIndex) return false;
    if (this.cardEffectFlow.type !== 'arsenalSearch') return false;

    const flow = this.cardEffectFlow;
    const targetPlayer = this.players[flow.targetPlayerIndex];
    if (!targetPlayer.arsenal.some((c) => c.instanceId === instanceId)) return false;

    if (flow.purpose === 'toHand' || flow.purpose === 'searchToHand') {
      if (flow.filterCardId) {
        const card = targetPlayer.arsenal.find((c) => c.instanceId === instanceId);
        if (!card || card.id !== flow.filterCardId) return false;
      }
      return await this.confirmArsenalSearch(playerIndex, [instanceId]);
    }

    const idx = flow.selectedIds.indexOf(instanceId);
    if (idx >= 0) {
      flow.selectedIds.splice(idx, 1);
    } else if (flow.selectedIds.length < flow.selectCount) {
      flow.selectedIds.push(instanceId);
    } else {
      return false;
    }

    this._notify();
    return true;
  }

  async confirmArsenalSearch(playerIndex, selectedIds) {
    if (!this.cardEffectFlow || this.cardEffectFlow.playerIndex !== playerIndex) return false;
    if (this.cardEffectFlow.type !== 'arsenalSearch') return false;

    const flow = this.cardEffectFlow;
    const targetPlayer = this.players[flow.targetPlayerIndex];
    const ids = selectedIds || flow.selectedIds;
    if (!this._validateArsenalSearchIds(targetPlayer, ids, flow.selectCount)) return false;

    const idSet = new Set(ids);
    const byId = new Map(targetPlayer.arsenal.map((c) => [c.instanceId, c]));
    const cards = ids.map((id) => byId.get(id)).filter(Boolean);
    targetPlayer.arsenal = targetPlayer.arsenal.filter((c) => !idSet.has(c.instanceId));

    if (flow.purpose === 'toHand') {
      const player = this.players[playerIndex];
      return await this._completeMarkingOutToHand(
        player,
        playerIndex,
        flow.sourceName,
        cards[0] || null
      );
    }

    if (flow.purpose === 'searchToHand') {
      const player = this.players[playerIndex];
      return await this._completeArsenalSearchToHand(
        player,
        playerIndex,
        flow.sourceName,
        cards[0] || null
      );
    }

    const opponent = targetPlayer;
    return await this._completeMarkingOutToRingside(
      opponent,
      playerIndex,
      flow.sourceName,
      cards
    );
  }

  _drawForOpponent(player, sourceName, count) {
    const opponent = this.players[1 - this._playerIndex(player)];
    let drawn = 0;

    for (let i = 0; i < count; i++) {
      if (this._drawCard(opponent)) drawn += 1;
    }

    if (drawn > 0) {
      this.actionLog.push({
        message: this._gc().log.opponentDrew(sourceName, drawn),
      });
    } else {
      this.actionLog.push({
        message: this._gc().log.opponentArsenalEmptyNoDraw(sourceName),
      });
    }
  }

  async _beginOpponentDiscardFromHandEffect(player, opponent, sourceName, count, meta = {}) {
    if (opponent.hand.length === 0) {
      this.actionLog.push({
        message: this._gc().log.opponentNoHandToDiscard(sourceName),
      });
      return false;
    }

    const opponentIndex = this._playerIndex(opponent);
    const effectiveCount = Math.min(count, opponent.hand.length);
    return await this._beginOpponentControlledDiscard(
      opponent,
      opponentIndex,
      sourceName,
      effectiveCount,
      { ...meta, mode: 'prompt' }
    );
  }

  _forceOpponentDiscard(opponent, count) {
    const autoPick = this.engineMode === 'goldfish' || !opponent.isHuman;
    const discardedCards = [];

    for (let i = 0; i < count; i++) {
      if (autoPick && opponent.hand.length > 0) {
        const idx = Math.floor(Math.random() * opponent.hand.length);
        discardedCards.push(opponent.hand.splice(idx, 1)[0]);
        continue;
      }
      if (opponent.arsenal.length === 0) break;
      discardedCards.push(opponent.arsenal.pop());
    }

    for (const card of discardedCards) {
      opponent.ringside.push(card);
    }

    return { count: discardedCards.length, cards: discardedCards };
  }

  _forceOpponentDiscardFromHand(opponent, count) {
    const discardedCards = [];

    for (let i = 0; i < count; i++) {
      if (opponent.hand.length === 0) break;
      const idx = Math.floor(Math.random() * opponent.hand.length);
      discardedCards.push(opponent.hand.splice(idx, 1)[0]);
    }

    for (const card of discardedCards) {
      opponent.ringside.push(card);
    }

    return { count: discardedCards.length, cards: discardedCards };
  }

  _beginOpponentDiscardFromHandPrompt(
    opponent,
    opponentIndex,
    sourceName,
    count,
    meta = {},
    allowedInstanceIds = null
  ) {
    if (opponent.hand.length === 0) {
      this.actionLog.push({
        message: this._gc().log.opponentNoHandToDiscard(sourceName),
      });
      return false;
    }

    this.cardEffectFlow = {
      type: 'opponentDiscardFromHand',
      playerIndex: opponentIndex,
      sourceName,
      count,
      selectedIds: [],
      meta,
      allowedInstanceIds,
      superstarAbilityOwnerIndex: meta.superstarAbilityOwnerIndex,
    };
    this._notify();
    return true;
  }

  async _applyManeuverDamage(player, opponent, played, damage, {
    isMaintainedReapplication = false,
  } = {}) {
    if (damage > 0) {
      const damageResult = await this._resolveDamage(player, opponent, played, damage);
      this._clearNextManeuverReversalTax(player);
      if (played.subtype === 'grapple') {
        this._clearGrappleJockeyingTax(player);
      }
      this.damageLog.push({
        card: played.name,
        damage,
        result: damageResult.result,
        reversedBy: damageResult.reversedBy?.name || null,
        cardsOverturned: damageResult.cardsOverturned,
      });

      if (damageResult.result === 'reversed') {
        if (isMaintainedReapplication) {
          this._disableMaintainHoldAbility('arsenalReversal');
          this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
          this.stateMachine.transition(window.RawDeal.EVENTS.END_TURN);
          this._notify();
          await this._runAutoPhases();
          return true;
        }
        this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
        this.stateMachine.transition(window.RawDeal.EVENTS.END_TURN);
        this._notify();
        await this._runAutoPhases();
        return true;
      }

      if (damageResult.result === 'pinfall') {
        this.winner = this._playerIndex(player);
        this.winReason = window.RawDeal.WIN_REASONS.PINFALL;
        this.stateMachine.phase = window.RawDeal.PHASES.GAME_OVER;
        this._notify();
        return true;
      }

      if (player.turnState) {
        player.turnState.activeManeuverUnreversible = false;
      }
      if (!isMaintainedReapplication) {
        this._markManeuverSuccessfullyPlayed(player, played, damage);
      }
    }

    this._clearNextManeuverReversalTax(player);
    if (played.subtype === 'grapple') {
      this._clearGrappleJockeyingTax(player);
    }
    if (player.turnState) {
      player.turnState.activeManeuverUnreversible = false;
    }
    if (!isMaintainedReapplication) {
      this._markManeuverSuccessfullyPlayed(player, played, damage);
    }
    this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
    this._notify();
    return true;
  }

  async _continueManeuverAfterReversal(player, opponent, played, damage, {
    skipManeuverEffects = false,
    isMaintainedReapplication = false,
  } = {}) {
    if (!skipManeuverEffects && played.maneuverEffects?.length) {
      this.pendingManeuverResolution = {
        player,
        opponent,
        played,
        damage,
        resumeAt: 'maneuver',
        isMaintainedReapplication,
      };
      const paused = await this._startEffectPipeline(player, played.name, played.maneuverEffects, 'maneuver');
      if (paused || this.cardEffectFlow || this.handRevealFlow) {
        return true;
      }
      if (this.pendingManeuverResolution) {
        return await this._continuePendingManeuverDamage();
      }
      return true;
    }

    this.pendingManeuverResolution = null;
    return this._applyManeuverDamage(player, opponent, played, damage, {
      isMaintainedReapplication,
    });
  }

  async _continuePendingManeuverDamage() {
    const pending = this.pendingManeuverResolution;
    this.pendingManeuverResolution = null;
    if (!pending) {
      this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
      this._notify();
      return;
    }

    const { player, opponent, played, damage, isMaintainedReapplication = false } = pending;
    await this._applyManeuverDamage(player, opponent, played, damage, {
      isMaintainedReapplication,
    });
  }

  _openActionReversalWindowOrPlay(player, opponent, played) {
    if (this.engineMode !== 'multiplayer') return false;

    this.stateMachine.transition(window.RawDeal.EVENTS.PLAY_CARD, {
      openReversalWindow: true,
      isAction: true,
    });
    this.reversalWindow = {
      kind: 'action',
      attackerIndex: this._playerIndex(player),
      defenderIndex: this._playerIndex(opponent),
      player,
      opponent,
      played,
      damage: 0,
    };
    this._notify();
    return true;
  }

  async _openReversalWindowOrApplyDamage(player, opponent, played, damage) {
    if (
      this.engineMode !== 'multiplayer' ||
      player.turnState?.activeManeuverUnreversible
    ) {
      return this._continueManeuverAfterReversal(player, opponent, played, damage);
    }

    this.stateMachine.transition(window.RawDeal.EVENTS.PLAY_CARD, { openReversalWindow: true });
    this.reversalWindow = {
      kind: 'maneuver',
      attackerIndex: this._playerIndex(player),
      defenderIndex: this._playerIndex(opponent),
      player,
      opponent,
      played,
      damage,
    };
    this._notify();
    return true;
  }

  canPlayReversalFromHand(playerIndex, instanceId) {
    if (this.stateMachine.phase !== window.RawDeal.PHASES.REVERSAL_PRIORITY) return false;
    if (!this.reversalWindow) return false;

    const { attackerIndex, defenderIndex, kind = 'maneuver' } = this.reversalWindow;
    const responderIndex = this._reversalWindowResponderIndex(
      kind,
      attackerIndex,
      defenderIndex
    );
    if (responderIndex !== playerIndex) return false;

    const player = this.players[playerIndex];
    const card = player.hand.find((c) => c.instanceId === instanceId);
    if (!card) return false;

    const { played } = this.reversalWindow;
    if (kind === 'action') {
      const attacker = this.players[attackerIndex];
      return window.RawDeal.CardUtils.canReverseAction(card, played, player.fortitude, {
        reversalFortitudeTax: this._getActionReversalFortitudeTax(attacker),
      });
    }

    const heelPlayerIndex = this._reversalWindowHeelPlayerIndex(
      kind,
      attackerIndex,
      defenderIndex
    );
    const heelPlayer = this.players[heelPlayerIndex];
    const discardAlreadyDone =
      this.pendingReversalAfterDiscard?.instanceId === instanceId;
    if (
      !discardAlreadyDone &&
      !window.RawDeal.CardUtils.meetsReversalDiscardRequirement(
        player,
        card,
        instanceId
      )
    ) {
      return false;
    }
    return this._reversalStops(card, played, player, {
      attacker: heelPlayer,
      effectiveDamage: this.reversalWindow.damage,
    });
  }

  async playReversalFromHand(playerIndex, instanceId) {
    if (!this.canPlayReversalFromHand(playerIndex, instanceId)) return false;

    const player = this.players[playerIndex];
    const reversalInHand = player.hand.find((c) => c.instanceId === instanceId);
    if (
      reversalInHand?.requiresReversalDiscard &&
      !this.pendingReversalAfterDiscard
    ) {
      this.pendingReversalAfterDiscard = { playerIndex, instanceId };
      const paused = this._beginDiscardFromHandPrompt(
        player,
        playerIndex,
        reversalInHand.name,
        reversalInHand.requiresReversalDiscard,
        { afterReversalDiscard: true }
      );
      return !!paused;
    }

    if (this.pendingReversalAfterDiscard?.instanceId === instanceId) {
      this.pendingReversalAfterDiscard = null;
    }

    const {
      player: attacker,
      played,
      kind = 'maneuver',
      attackerIndex,
      defenderIndex,
    } = this.reversalWindow;
    const handIndex = player.hand.findIndex((c) => c.instanceId === instanceId);
    const reversal = player.hand.splice(handIndex, 1)[0];

    if (kind === 'opponentReversal') {
      player.ring.reversals.push(reversal);
      this._syncFortitude(player);
      this.pendingOpponentReversal = null;
      this.reversalWindow = null;
      this._applyDisqualificationWin(playerIndex, reversal.name);
      return true;
    }

    if (kind === 'action') {
      player.ringside.push(reversal);
      attacker.ringside.push(played);
      const reversalPlayerIndex = this._playerIndex(player);
      const grantIrishWhipSetup =
        reversal.id === 'irish-whip' && played.id === 'irish-whip';
      const grantJockeyingChoice =
        reversal.id === 'jockeying-for-position' && played.id === 'jockeying-for-position';
      const cleanBreakVsJfp =
        reversal.id === 'clean-break' && played.id === 'jockeying-for-position';

      this.actionLog.push({
        message: this._gc().log.actionReversedNoEffect(reversal.name, played.name),
      });
      this.reversalWindow = null;
      this.stateMachine.transition(window.RawDeal.EVENTS.PLAY_REVERSAL);
      this._notify();

      if (cleanBreakVsJfp) {
        const attackerIndex = this._playerIndex(attacker);
        const paused = await this._beginOpponentControlledDiscard(
          attacker,
          attackerIndex,
          reversal.name,
          4,
          {
            afterComplete: 'cleanBreak',
            reversalPlayerIndex: reversalPlayerIndex,
            sourceName: reversal.name,
          }
        );
        if (paused) {
          return true;
        }
      }

      await this._runAutoPhases();

      if (grantIrishWhipSetup) {
        this._applyIrishWhipSetup(player, reversal);
      } else if (grantJockeyingChoice) {
        this._beginJockeyingChoice(player, reversalPlayerIndex, reversal.name);
      }
      this._notify();
      return true;
    }

    if (kind === 'maintained') {
      player.ring.reversals.push(reversal);
      this._syncFortitude(player);
      this.actionLog.push({
        message: this._gc().log.maintainHoldReversedFromHand(reversal.name, played.name),
      });
      this.reversalWindow = null;
      this._disableMaintainHoldAbility('handReversal');
      await this._finishHandReversalTurn();
      return true;
    }

    if (
      kind === 'maneuver' &&
      window.RawDeal.CardUtils.isHeelCard(reversal) &&
      reversal.id !== 'disqualification'
    ) {
      const pendingDamage = this.reversalWindow.damage;
      this.pendingOpponentReversal = {
        reversalPlayer: player,
        reversalPlayerIndex: playerIndex,
        attacker,
        played,
        damage: pendingDamage,
        reversal,
      };
      this.reversalWindow = {
        kind: 'opponentReversal',
        attackerIndex,
        defenderIndex,
        player: attacker,
        opponent: player,
        played: reversal,
        damage: pendingDamage,
      };
      this._notify();
      return true;
    }

    player.ring.reversals.push(reversal);
    this._syncFortitude(player);
    this._sendReversedManeuverToRingside(attacker, played);

    this.actionLog.push({
      message: this._gc().log.reversalFromHand(reversal.name, played.name),
    });

    if (played.subtype === 'grapple') {
      this._clearGrappleJockeyingTax(attacker);
    }
    this._clearNextManeuverReversalTax(attacker);

    this._applyStunValueDraw(attacker, played);
    this.reversedManeuverDamage = this.reversalWindow.damage;
    this.reversedManeuverHandReversalDamageBonus = played.handReversalDamageBonus || 0;
    this.reversalWindow = null;

    if (reversal.disqualifiesOpponent || reversal.id === 'disqualification') {
      this._applyDisqualificationWin(this._playerIndex(player), reversal.name);
      return true;
    }

    if (reversal.reversalEffects?.length) {
      const paused = await this._startEffectPipeline(
        player,
        reversal.name,
        reversal.reversalEffects,
        'reversal',
        reversal
      );
      return true;
    }

    await this._finishHandReversalTurn();
    return true;
  }

  async _finishHandReversalTurn() {
    this.reversedManeuverDamage = null;
    this.reversedManeuverHandReversalDamageBonus = 0;
    this.stateMachine.transition(window.RawDeal.EVENTS.PLAY_REVERSAL);
    this._notify();
    await this._runAutoPhases();
  }

  async _completePendingOpponentReversal() {
    const pending = this.pendingOpponentReversal;
    if (!pending) return;

    const { reversalPlayer, attacker, played, damage, reversal } = pending;
    this.pendingOpponentReversal = null;

    reversalPlayer.ring.reversals.push(reversal);
    this._syncFortitude(reversalPlayer);
    this._sendReversedManeuverToRingside(attacker, played);

    this.actionLog.push({
      message: this._gc().log.reversalFromHand(reversal.name, played.name),
    });

    if (played.subtype === 'grapple') {
      this._clearGrappleJockeyingTax(attacker);
    }
    this._clearNextManeuverReversalTax(attacker);

    this._applyStunValueDraw(attacker, played);
    this.reversedManeuverDamage = damage;
    this.reversedManeuverHandReversalDamageBonus = played.handReversalDamageBonus || 0;

    if (reversal.disqualifiesOpponent || reversal.id === 'disqualification') {
      this._applyDisqualificationWin(this._playerIndex(reversalPlayer), reversal.name);
      return;
    }

    if (reversal.reversalEffects?.length) {
      await this._startEffectPipeline(
        reversalPlayer,
        reversal.name,
        reversal.reversalEffects,
        'reversal',
        reversal
      );
      return;
    }

    await this._finishHandReversalTurn();
  }

  async _applyReversalFromHandDamage(reversalPlayer, attacker, reversal, damage) {
    const bonus = this.reversedManeuverHandReversalDamageBonus || 0;
    const totalDamage = damage + bonus;
    if (totalDamage <= 0) return { gameOver: false };

    const damageResult = await this._resolveDamage(reversalPlayer, attacker, reversal, totalDamage, {
      allowArsenalReversals: false,
    });
    this.damageLog.push({
      card: reversal.name,
      damage: totalDamage,
      result: damageResult.result,
      reversedBy: null,
      cardsOverturned: damageResult.cardsOverturned,
    });

    if (damageResult.result === 'pinfall') {
      this.winner = this._playerIndex(reversalPlayer);
      this.winReason = window.RawDeal.WIN_REASONS.PINFALL;
      this.stateMachine.phase = window.RawDeal.PHASES.GAME_OVER;
      this._notify();
      return { gameOver: true };
    }

    return { gameOver: false };
  }

  async passPriority(playerIndex) {
    if (this.stateMachine.phase !== window.RawDeal.PHASES.REVERSAL_PRIORITY) return false;
    if (!this.reversalWindow) return false;

    const {
      player,
      opponent,
      played,
      damage,
      kind = 'maneuver',
      attackerIndex,
      defenderIndex,
    } = this.reversalWindow;
    const responderIndex = this._reversalWindowResponderIndex(
      kind,
      attackerIndex,
      defenderIndex
    );
    if (responderIndex !== playerIndex) return false;

    if (kind === 'opponentReversal') {
      this.reversalWindow = null;
      await this._completePendingOpponentReversal();
      return true;
    }

    this.reversalWindow = null;

    if (kind === 'action') {
      this.stateMachine.transition(window.RawDeal.EVENTS.PASS_PRIORITY, { isAction: true });
      this._notify();
      await this._playFromHandAsAction(player, played);
      this._notify();
      return true;
    }

    if (kind === 'maintained') {
      this.stateMachine.transition(window.RawDeal.EVENTS.PASS_PRIORITY);
      this._notify();
      return await this._reapplyMaintainedSubmission();
    }

    this.stateMachine.transition(window.RawDeal.EVENTS.PASS_PRIORITY);
    this._placeManeuverInRing(player, played);
    this._notify();
    return await this._continueManeuverAfterReversal(player, opponent, played, damage);
  }

  async _finishCardEffectResolution() {
    this.cardEffectFlow = null;
    if (this.effectPipelineFlow?.paused) {
      await window.RawDeal.EffectPipeline.resumeAfterCardEffect(this);
      return;
    }
    if (this.pendingManeuverResolution) {
      await this._continuePendingManeuverDamage();
      return;
    }

    this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
    this._notify();
  }

  async selectForCardEffect(playerIndex, instanceId) {
    if (!this.cardEffectFlow || this.cardEffectFlow.playerIndex !== playerIndex) return false;

    const player = this.players[playerIndex];
    const flow = this.cardEffectFlow;

    if (flow.type === 'shuffleHandIntoArsenal') {
      if (flow.selectedIds.includes(instanceId)) return false;
      if (!player.hand.some((c) => c.instanceId === instanceId)) return false;

      const card = player.hand.find((c) => c.instanceId === instanceId);
      if (!card) return false;

      player.hand = player.hand.filter((c) => c.instanceId !== instanceId);
      await this._completeShuffleHandIntoArsenal(player, flow, card);
      return true;
    }

    if (flow.type === 'discardFromHand' || flow.type === 'opponentDiscardFromHand') {
      if (flow.selectedIds.includes(instanceId)) return false;
      if (!player.hand.some((c) => c.instanceId === instanceId)) return false;
      if (flow.allowedInstanceIds && !flow.allowedInstanceIds.includes(instanceId)) {
        return false;
      }

      flow.selectedIds.push(instanceId);
      const needed = flow.count || 1;

      if (flow.selectedIds.length < needed) {
        this._notify();
        return true;
      }

      const toDiscard = flow.selectedIds
        .map((id) => player.hand.find((c) => c.instanceId === id))
        .filter(Boolean);
      player.hand = player.hand.filter((c) => !flow.selectedIds.includes(c.instanceId));
      for (const discarded of toDiscard) {
        player.ringside.push(discarded);
      }

      const names = toDiscard.map((c) => c.name).join(', ');
      if (flow.type === 'opponentDiscardFromHand') {
        this.actionLog.push({
          message: this._gc().log.opponentDiscarded(flow.sourceName, names),
        });
        const meta = flow.meta || {};
        if (flow.superstarAbilityOwnerIndex !== undefined) {
          meta.superstarAbilityOwnerIndex = flow.superstarAbilityOwnerIndex;
        }
        this.cardEffectFlow = null;
        this._notify();
        const paused = await this._beginPendingEgoBoostDraws(meta);
        if (paused) return true;
        if (this.effectPipelineFlow?.paused || this.pendingManeuverResolution) {
          if (!meta.resumePipeline) {
            await this._finishCardEffectResolution();
          }
        }
        return true;
      }

      this.actionLog.push({
        message: this._gc().log.discardedToRingside(flow.sourceName, names),
      });
      if (flow.meta?.afterReversalDiscard) {
        const pending = this.pendingReversalAfterDiscard;
        this.cardEffectFlow = null;
        this._notify();
        if (pending) {
          return this.playReversalFromHand(pending.playerIndex, pending.instanceId);
        }
        return true;
      }
      if (flow.meta?.discardAllHands && flow.meta.phase === 'active') {
        this.cardEffectFlow = null;
        this._notify();
        const paused = await this._resumeDiscardAllHandsAfterActiveDiscard();
        return !!paused;
      }
      if (this.effectPipelineFlow) {
        this.effectPipelineFlow.discardedCount = toDiscard.length;
      }
      await this._finishCardEffectResolution();
      return true;
    }

    if (
      flow.type === 'returnFromRingside' ||
      flow.type === 'shuffleRingsideIntoArsenal'
    ) {
      return this.toggleSuperstarAbilitySelection(playerIndex, instanceId);
    }

    if (flow.type === 'arsenalSearch') {
      return this.toggleArsenalSearchSelection(playerIndex, instanceId);
    }

    return false;
  }

  async selectArsenalOrRingsideForCardEffect(playerIndex, instanceId, zone) {
    if (this.cardEffectFlow?.type !== 'pickArsenalOrRingsideToHand') return false;
    return this.selectArsenalOrRingsidePick(playerIndex, instanceId, zone);
  }

  async selectChoice(playerIndex, optionId) {
    if (!this.cardEffectFlow || this.cardEffectFlow.playerIndex !== playerIndex) return false;
    if (this.cardEffectFlow.type !== 'choice') return false;

    const flow = this.cardEffectFlow;
    const player = this.players[playerIndex];
    const opponent = this.players[1 - playerIndex];

    if (flow.choiceId === 'jockeyingForPosition') {
      if (!player.turnState) player.turnState = this._emptyTurnState();
      if (optionId === 'grappleDamage') {
        player.turnState.nextGrappleBonus = 4;
        this.actionLog.push({
          message: this._gc().log.grappleDamageBonus(flow.sourceName),
        });
      } else if (optionId === 'grappleReversalTax') {
        player.turnState.nextGrappleReversalTax = 8;
        this.actionLog.push({
          message: this._gc().log.grappleReversalTax(flow.sourceName),
        });
      } else {
        return false;
      }
      this.cardEffectFlow = null;
      if (this.effectPipelineFlow?.paused) {
        await window.RawDeal.EffectPipeline.resumeAfterCardEffect(this);
        return true;
      }
      this._notify();
      return true;
    }

    if (flow.choiceId === 'markingOut') {
      const sourceName = flow.sourceName;
      this.cardEffectFlow = null;
      if (optionId === 'ownArsenalToHand') {
        return await this._beginMarkingOutOwnArsenalPrompt(player, playerIndex, sourceName);
      }
      if (optionId === 'opponentArsenalToRingside') {
        return await this._beginMarkingOutOpponentArsenalPrompt(
          player,
          playerIndex,
          sourceName
        );
      }
      return false;
    }

    if (flow.choiceId === 'egoBoostOrDiscard') {
      if (optionId === 'egoBoost') {
        return await this._applyEgoBoostReaction(
          player,
          playerIndex,
          flow.sourceName,
          flow.count,
          flow.meta
        );
      }
      if (optionId === 'discardNormally') {
        this.cardEffectFlow = null;
        const paused = await this._executeOpponentControlledDiscard(
          player,
          playerIndex,
          flow.sourceName,
          flow.count,
          flow.meta
        );
        return !!paused;
      }
      return false;
    }

    if (flow.choiceId === 'drawOrOpponentDiscard') {
      const n = flow.count || 2;
      if (optionId === 'draw') {
        for (let i = 0; i < n; i++) {
          this._drawCard(player);
        }
        this.actionLog.push({
          message: this._gc().log.drewNCards(flow.sourceName, n),
        });
        this._notify();
      } else if (optionId === 'opponentDiscard') {
        this.cardEffectFlow = null;
        const opponentIndex = 1 - playerIndex;
        const paused = await this._beginOpponentControlledDiscard(
          opponent,
          opponentIndex,
          flow.sourceName,
          n,
          { resumePipeline: true }
        );
        if (paused) return true;
      } else {
        return false;
      }
    } else if (flow.choiceId === 'drawOrOpponentDiscardUpTo') {
      const max = flow.max || 5;
      const sourceName = flow.sourceName;
      this.cardEffectFlow = null;
      this._notify();
      if (optionId === 'draw') {
        return this._beginDrawUpToPrompt(player, playerIndex, sourceName, max);
      }
      if (optionId === 'opponentDiscard') {
        return this._beginForceOpponentDiscardCountPrompt(player, playerIndex, sourceName, max);
      }
      return false;
    } else {
      return false;
    }

    this._notify();
    await this._finishCardEffectResolution();
    return true;
  }

  async _topArsenalToRingside(player, sourceCard, count = 1) {
    const playerIndex = this._playerIndex(player);
    const moved = [];
    const requested = count;

    for (let i = 0; i < count && player.arsenal.length > 0; i++) {
      const top = player.arsenal.pop();
      this._notify();

      await this.onArsenalToRingside({
        card: top,
        sourceManeuver: sourceCard,
        playerSeat: playerIndex,
        onReveal: () => {
          player.ringside.push(top);
          moved.push(top);
          this._notify();
        },
      });
    }

    if (moved.length === 0) return;

    const names = moved.map((c) => c.name).join(', ');
    const sourceName = sourceCard.name;
    this.actionLog.push({
      message:
        moved.length === 1
          ? this._gc().log.putArsenalInRingside(sourceName, names)
          : moved.length === requested
            ? this._gc().log.topArsenalToRingside(sourceName, moved.length, names)
            : this._gc().log.topArsenalPartial(sourceName, moved.length, requested),
    });
    this._notify();
  }

  async _resolveDamage(attacker, opponent, maneuver, damage, { allowArsenalReversals = true } = {}) {
    let cardsOverturned = 0;

    for (let i = 0; i < damage; i++) {
      if (opponent.arsenal.length === 0) {
        return { result: 'pinfall', cardsOverturned };
      }

      const overturned = opponent.arsenal.pop();
      cardsOverturned += 1;
      this._notify();

      const reversed = allowArsenalReversals
        ? this._reversalStops(overturned, maneuver, opponent, {
            attacker,
            effectiveDamage: damage,
          })
        : false;

      await this.onDamageStep({
        card: overturned,
        step: i + 1,
        total: damage,
        maneuver,
        reversed,
        playerSeat: this._playerIndex(opponent),
        onReveal: () => {
          opponent.ringside.push(overturned);
          this._notify();
        },
      });

      if (overturned.id === 'disqualification') {
        const dqWinner = this._checkDisqualificationRingsideTrigger(
          opponent,
          attacker,
          maneuver
        );
        if (dqWinner != null) {
          this._applyDisqualificationWin(dqWinner, overturned.name);
          return {
            result: 'disqualified',
            reversedBy: overturned,
            cardsOverturned,
          };
        }
      }

      if (reversed) {
        this._applyStunValueDraw(attacker, maneuver);
        return { result: 'reversed', reversedBy: overturned, cardsOverturned };
      }
    }

    return { result: 'hit', cardsOverturned };
  }

  /** Draw for the maneuver's owner when their maneuver is reversed from opponent Arsenal. */
  _applyStunValueDraw(maneuverOwner, maneuver) {
    const sv = window.RawDeal.CardUtils.getStunValue(maneuver);
    if (sv <= 0) return;

    let drawn = 0;
    for (let i = 0; i < sv; i++) {
      if (this._drawCard(maneuverOwner)) drawn += 1;
    }

    if (drawn > 0) {
      this.actionLog.push({
        message: this._gc().log.reversalSvDraw(
          maneuver.name,
          sv,
          this._gc().whoDraws(maneuverOwner.isHuman),
          drawn
        ),
      });
      this._notify();
    }
  }

  _reversalStops(card, maneuver, opponent, options = {}) {
    const {
      attacker = null,
      effectiveDamage = null,
      afterIrishWhip = null,
      reversalFortitudeTax = 0,
    } = options;

    if (attacker?.turnState?.opponentReversalsBlocked) {
      return false;
    }
    if (attacker?.turnState?.activeManeuverUnreversible) {
      return false;
    }
    const damage =
      effectiveDamage ??
      (attacker ? this._peekManeuverDamage(attacker, opponent, maneuver) : (maneuver.damage || 0));
    const playedAfterIrishWhip =
      afterIrishWhip ?? !!attacker?.turnState?.irishWhipPlayed;
    const tax = attacker
      ? this._getManeuverReversalFortitudeTax(attacker, maneuver)
      : reversalFortitudeTax || 0;

    return window.RawDeal.CardUtils.canReverseManeuver(
      card,
      maneuver,
      opponent.fortitude,
      damage,
      {
        afterIrishWhip: playedAfterIrishWhip,
        reversalFortitudeTax: tax,
        attacker,
      }
    );
  }

  _clearGrappleJockeyingTax(player) {
    if (player?.turnState?.nextGrappleReversalTax) {
      player.turnState.nextGrappleReversalTax = 0;
    }
  }

  _shouldPromptRockPreDraw(player) {
    if (!player || player.preDrawSuperstarResolved) return false;
    if (player.superstar.id !== 'the-rock') return false;
    if (player.ringside.length === 0) return false;
    return this.engineMode === 'multiplayer' || player.isHuman;
  }

  _beginRockPreDraw(player, playerIndex) {
    this.abilityFlow = {
      playerIndex,
      superstarId: 'the-rock',
      step: 'rockRingside',
      selectedId: null,
    };
    this._notify();
    return true;
  }

  _shaneOMacCardsInRing(player) {
    return (player.ring?.actions || []).filter((c) => c.id === 'shane-omac');
  }

  async _flipOpponentTopArsenalToRingside(opponent, opponentIndex, sourceCard, { emptyLog, successLog }) {
    if (opponent.arsenal.length === 0) {
      this.actionLog.push({ message: emptyLog() });
      return;
    }

    const top = opponent.arsenal.pop();
    this._notify();

    await this.onArsenalToRingside({
      card: top,
      sourceManeuver: sourceCard,
      playerSeat: opponentIndex,
      onReveal: () => {
        opponent.ringside.push(top);
        this.actionLog.push({ message: successLog(top.name) });
        this._notify();
      },
    });
  }

  async _applyKanePreDrawAbility(kanePlayer, kanePlayerIndex) {
    const opponent = this.players[1 - kanePlayerIndex];
    await this._flipOpponentTopArsenalToRingside(
      opponent,
      1 - kanePlayerIndex,
      kanePlayer.superstar,
      {
        emptyLog: () => this._gc().log.kaneEmptyArsenal(),
        successLog: (topName) => this._gc().log.kaneOverturned(topName),
      }
    );
  }

  async _applyShaneOMacPreDrawRingEffects(player, playerIndex) {
    const shaneCards = this._shaneOMacCardsInRing(player);
    if (shaneCards.length === 0) return;

    const opponent = this.players[1 - playerIndex];
    const opponentIndex = 1 - playerIndex;

    for (const shane of shaneCards) {
      await this._flipOpponentTopArsenalToRingside(opponent, opponentIndex, shane, {
        emptyLog: () => this._gc().log.shaneOMacEmptyArsenal(shane.name),
        successLog: (topName) => this._gc().log.shaneOMacOverturned(shane.name, topName),
      });
    }
  }

  async _resolvePreDrawBeforeDrawEffects(player, playerIndex) {
    if (player.superstar.id === 'kane') {
      await this._applyKanePreDrawAbility(player, playerIndex);
    }
    await this._applyShaneOMacPreDrawRingEffects(player, playerIndex);
  }

  async _handlePreDrawSuperstarAbilities(player, playerIndex) {
    if (player.preDrawSuperstarResolved) {
      return false;
    }

    if (this._shouldPromptRockPreDraw(player)) {
      return this._beginRockPreDraw(player, playerIndex);
    }

    await this._resolvePreDrawBeforeDrawEffects(player, playerIndex);

    player.preDrawSuperstarResolved = true;
    this._notify();
    return false;
  }

  async _finishPreDrawSuperstarAbility(player) {
    const playerIndex = this._playerIndex(player);
    await this._resolvePreDrawBeforeDrawEffects(player, playerIndex);
    player.preDrawSuperstarResolved = true;
    this.abilityFlow = null;
    this._notify();
    await this._runAutoPhases();
  }

  toggleSuperstarAbilitySelection(playerIndex, instanceId) {
    const player = this.players[playerIndex];
    if (!player) return false;

    const ability = this.abilityFlow;
    if (ability?.playerIndex === playerIndex) {
      if (ability.step === 'rockRingside' || ability.step === 'pickRingside') {
        if (!player.ringside.some((c) => c.instanceId === instanceId)) return false;

        ability.selectedId =
          ability.selectedId === instanceId ? null : instanceId;
        this._notify();
        return true;
      }
    }

    const cardFlow = this.cardEffectFlow;
    if (
      cardFlow?.playerIndex === playerIndex &&
      (cardFlow.type === 'returnFromRingside' ||
        cardFlow.type === 'shuffleRingsideIntoArsenal')
    ) {
      if (!player.ringside.some((c) => c.instanceId === instanceId)) return false;
      const maxSelect = cardFlow.maxSelect ?? cardFlow.count ?? 1;
      const upTo = cardFlow.type === 'shuffleRingsideIntoArsenal' && cardFlow.exact === false;

      if (cardFlow.selectedIds.includes(instanceId)) {
        if (upTo) {
          cardFlow.selectedIds = cardFlow.selectedIds.filter((id) => id !== instanceId);
          this._notify();
          return true;
        }
        return false;
      }

      if (cardFlow.selectedIds.length >= maxSelect) {
        if (maxSelect === 1) {
          cardFlow.selectedIds = [instanceId];
          this._notify();
          return true;
        }
        return false;
      }

      cardFlow.selectedIds.push(instanceId);
      this._notify();
      return true;
    }

    return false;
  }

  async passSuperstarAbilityPrompt(playerIndex) {
    if (!this.abilityFlow || this.abilityFlow.playerIndex !== playerIndex) return false;
    if (this.abilityFlow.step !== 'rockRingside') return false;

    const player = this.players[playerIndex];
    this.actionLog.push({
      message: this._gc().log.rockPassed(),
    });
    await this._finishPreDrawSuperstarAbility(player);
    return true;
  }

  async confirmSuperstarAbilityPrompt(playerIndex, selection) {
    const player = this.players[playerIndex];
    if (!player) return false;

    const ability = this.abilityFlow;
    if (ability?.playerIndex === playerIndex && ability.step === 'rockRingside') {
      const instanceId = Array.isArray(selection) ? selection[0] : selection;
      const idx = player.ringside.findIndex((c) => c.instanceId === instanceId);
      if (idx < 0) return false;

      const [card] = player.ringside.splice(idx, 1);
      player.arsenal.unshift(card);
      this.actionLog.push({
        message: this._gc().log.rockMovedToArsenalBottom(card.name),
      });
      await this._finishPreDrawSuperstarAbility(player);
      return true;
    }

    if (ability?.playerIndex === playerIndex && ability.step === 'pickRingside') {
      const instanceId = Array.isArray(selection) ? selection[0] : selection;
      const idx = player.ringside.findIndex((c) => c.instanceId === instanceId);
      if (idx < 0) return false;

      const [card] = player.ringside.splice(idx, 1);
      player.hand.push(card);
      player.superstarAbilityUsed = true;
      const discarded = (ability.discardedNames || []).join(' and ');
      this.actionLog.push({
        message: this._gc().log.undertakerDiscardedRetrieved(discarded, card.name),
      });
      this.abilityFlow = null;
      this._notify();
      return true;
    }

    const cardFlow = this.cardEffectFlow;
    if (
      cardFlow?.playerIndex === playerIndex &&
      cardFlow.type === 'returnFromRingside'
    ) {
      const ids = Array.isArray(selection) ? selection : cardFlow.selectedIds;
      const needed = cardFlow.count || 1;
      if (ids.length !== needed) return false;

      const valid = new Set(player.ringside.map((c) => c.instanceId));
      if (!ids.every((id) => valid.has(id))) return false;

      const toReturn = ids
        .map((id) => player.ringside.find((c) => c.instanceId === id))
        .filter(Boolean);
      for (const id of ids) {
        const idx = player.ringside.findIndex((c) => c.instanceId === id);
        if (idx >= 0) {
          const [card] = player.ringside.splice(idx, 1);
          player.hand.push(card);
        }
      }

      const names = toReturn.map((c) => c.name).join(', ');
      this.actionLog.push({
        message: this._gc().log.returnedFromRingside(cardFlow.sourceName, names),
      });
      await this._finishCardEffectResolution();
      return true;
    }

    if (
      cardFlow?.playerIndex === playerIndex &&
      cardFlow.type === 'shuffleRingsideIntoArsenal'
    ) {
      const ids = Array.isArray(selection) ? selection : cardFlow.selectedIds;
      const maxSelect = cardFlow.maxSelect ?? cardFlow.count ?? 1;
      const upTo = cardFlow.exact === false;

      if (upTo) {
        if (ids.length > maxSelect) return false;
      } else if (ids.length !== maxSelect) {
        return false;
      }

      const valid = new Set(player.ringside.map((c) => c.instanceId));
      if (!ids.every((id) => valid.has(id))) return false;

      const toShuffle = ids
        .map((id) => player.ringside.find((c) => c.instanceId === id))
        .filter(Boolean);
      for (const id of ids) {
        const idx = player.ringside.findIndex((c) => c.instanceId === id);
        if (idx >= 0) {
          const [card] = player.ringside.splice(idx, 1);
          this._shuffleCardIntoArsenal(player, card);
        }
      }

      if (toShuffle.length === 0) {
        this.actionLog.push({
          message: this._gc().log.shuffledZeroRingside(cardFlow.sourceName),
        });
      } else {
        const names = toShuffle.map((c) => c.name).join(', ');
        this.actionLog.push({
          message: this._gc().log.shuffledRingsideIntoArsenal(cardFlow.sourceName, names),
        });
      }
      await this._finishCardEffectResolution();
      return true;
    }

    return false;
  }

  canUseSuperstarAbility(playerIndex) {
    if (
      !this.stateMachine.canPlayCards(playerIndex) ||
      this.abilityFlow ||
      this.cardEffectFlow ||
      this.reversalWindow ||
      this._isMaintainHoldLockActive()
    ) {
      return false;
    }

    const player = this.players[playerIndex];
    if (!player || player.superstarAbilityUsed) return false;

    const id = player.superstar.id;
    if (id === 'stone-cold') return player.arsenal.length > 0;
    if (id === 'undertaker') return player.hand.length >= 2 && player.ringside.length >= 1;
    if (id === 'jericho') return player.hand.length >= 1;
    return false;
  }

  async _finishJerichoOpponentDiscard(jerichoPlayer, jerichoPlayerIndex, discardedCardName) {
    const opponent = this.players[1 - jerichoPlayerIndex];
    const opponentIndex = 1 - jerichoPlayerIndex;

    if (opponent.hand.length === 0) {
      this.actionLog.push({
        message: this._gc().log.jerichoNoOpponentHand(discardedCardName),
      });
      jerichoPlayer.superstarAbilityUsed = true;
      this.abilityFlow = null;
      this._notify();
      return true;
    }

    this.abilityFlow = null;
    this.actionLog.push({
      message: this._gc().log.jerichoForcedDiscard(discardedCardName),
    });
    const paused = await this._beginOpponentControlledDiscard(
      opponent,
      opponentIndex,
      'Chris Jericho',
      1,
      { superstarAbilityOwnerIndex: jerichoPlayerIndex }
    );
    this._notify();
    return true;
  }

  beginSuperstarAbility(playerIndex = 0) {
    if (!this.canUseSuperstarAbility(playerIndex)) return false;

    const player = this.players[playerIndex];
    const id = player.superstar.id;

    if (id === 'stone-cold') {
      const drawn = this._drawCard(player);
      if (!drawn) return false;
      this.abilityFlow = { playerIndex, superstarId: id, step: 'pickBottom' };
      this._notify();
      return true;
    }

    if (id === 'undertaker') {
      this.abilityFlow = { playerIndex, superstarId: id, step: 'pickDiscard', discardSelected: [] };
      this._notify();
      return true;
    }

    if (id === 'jericho') {
      this.abilityFlow = { playerIndex, superstarId: id, step: 'jerichoDiscardSelf' };
      this._notify();
      return true;
    }

    return false;
  }

  async selectForAbility(playerIndex, instanceId) {
    if (!this.abilityFlow || this.abilityFlow.playerIndex !== playerIndex) return false;

    const player = this.players[playerIndex];
    const flow = this.abilityFlow;

    if (flow.step === 'pickBottom') {
      const idx = player.hand.findIndex((c) => c.instanceId === instanceId);
      if (idx < 0) return false;
      const [card] = player.hand.splice(idx, 1);
      player.arsenal.unshift(card);
      player.superstarAbilityUsed = true;
      this.abilityFlow = null;
      this.actionLog.push({
        message: this._gc().log.stoneColdBottomArsenal(card.name),
      });
      this._notify();
      return true;
    }

    if (flow.step === 'pickDiscard') {
      if (flow.discardSelected.includes(instanceId)) return false;
      if (!player.hand.some((c) => c.instanceId === instanceId)) return false;

      flow.discardSelected.push(instanceId);
      if (flow.discardSelected.length < 2) {
        this._notify();
        return true;
      }

      const toDiscard = flow.discardSelected
        .map((id) => player.hand.find((c) => c.instanceId === id))
        .filter(Boolean);
      player.hand = player.hand.filter((c) => !flow.discardSelected.includes(c.instanceId));
      for (const card of toDiscard) {
        player.ringside.push(card);
      }

      flow.step = 'pickRingside';
      flow.discardSelected = [];
      flow.selectedId = null;
      flow.discardedNames = toDiscard.map((c) => c.name);
      this._notify();
      return true;
    }

    if (flow.step === 'pickRingside') {
      return this.toggleSuperstarAbilitySelection(playerIndex, instanceId);
    }

    if (flow.step === 'jerichoDiscardSelf') {
      const idx = player.hand.findIndex((c) => c.instanceId === instanceId);
      if (idx < 0) return false;
      const [card] = player.hand.splice(idx, 1);
      player.ringside.push(card);
      return await this._finishJerichoOpponentDiscard(player, playerIndex, card.name);
    }

    return false;
  }

  async endTurn(playerIndex) {
    if (
      !this.stateMachine.canPlayCards(playerIndex) ||
      this.abilityFlow ||
      this.cardEffectFlow ||
      this.pendingManeuverResolution ||
      this.reversalWindow ||
      window.RawDeal.EffectPipeline.isPaused(this, playerIndex)
    ) {
      return;
    }
    await this._forceEndTurnFromEffect(playerIndex);
  }

  async _forceEndTurnFromEffect(playerIndex) {
    this.abilityFlow = null;
    this.handRevealFlow = null;
    this.cardEffectFlow = null;
    this.effectPipelineFlow = null;
    this.stateMachine.transition(window.RawDeal.EVENTS.END_TURN);
    await this._runAutoPhases();
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _devCloneCard(cardId) {
    const base = window.RawDeal.CARDS[cardId];
    if (!base) return null;
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return { ...base, instanceId: `${cardId}-dev-${suffix}` };
  }

  devGiveCard(playerIndex, cardId) {
    const player = this.players[playerIndex];
    if (!player || this.winner !== null) return false;

    const card = this._devCloneCard(cardId);
    if (!card) return false;

    player.hand.push(card);
    this._notify();
    return true;
  }

  devStackArsenal(playerIndex, cardId, count = 1) {
    const player = this.players[playerIndex];
    if (!player || this.winner !== null) return 0;

    const base = window.RawDeal.CARDS[cardId];
    if (!base) return 0;

    let stacked = 0;
    for (let i = 0; i < count; i++) {
      const card = this._devCloneCard(cardId);
      if (!card) break;
      player.arsenal.push(card);
      stacked++;
    }

    if (stacked > 0) this._notify();
    return stacked;
  }
};