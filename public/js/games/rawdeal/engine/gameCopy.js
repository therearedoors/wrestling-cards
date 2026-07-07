window.RawDeal = window.RawDeal || {};

(function () {
  function cardWord(count) {
    return count === 1 ? 'card' : 'cards';
  }

  function cardSuffix(count) {
    return count === 1 ? '' : 's';
  }

  function maneuverLabel(subtype) {
    return subtype.charAt(0).toUpperCase() + subtype.slice(1);
  }

  function whoseArsenal(target) {
    return target === 'opponent' ? "opponent's" : 'your';
  }

  function whoHas(isHuman) {
    return isHuman ? 'You have' : 'Opponent has';
  }

  function whoDraws(isHuman) {
    return isHuman ? 'You draw' : 'Opponent draws';
  }

  const choiceRegistry = {
    markingOut(ctx) {
      const { sourceName } = ctx;
      return {
        message: `${sourceName}: choose one.`,
        options: [
          {
            id: 'ownArsenalToHand',
            label: 'Look through your Arsenal — put 1 in hand, shuffle, end turn',
          },
          {
            id: 'opponentArsenalToRingside',
            label: "Look through opponent's Arsenal — put up to 3 in Ringside, shuffle",
          },
        ],
      };
    },

    jockeyingForPosition(ctx) {
      const { sourceName } = ctx;
      return {
        message: `${sourceName}: choose an effect for your next Grapple maneuver.`,
        options: [
          { id: 'grappleDamage', label: 'Next Grapple +4D' },
          { id: 'grappleReversalTax', label: "Opponent's reversal to it +8F" },
        ],
      };
    },

    drawOrOpponentDiscard(ctx) {
      const { sourceName, count } = ctx;
      return {
        message: `${sourceName}: choose one.`,
        options: [
          { id: 'draw', label: `Draw ${count} cards` },
          { id: 'opponentDiscard', label: `Opponent discards ${count} cards` },
        ],
      };
    },

    egoBoostOrDiscard(ctx) {
      const { sourceName, count } = ctx;
      return {
        message: `${sourceName} forces you to discard from your hand. Use Ego Boost? (${count} ${cardWord(count)} left to discard)`,
        options: [
          { id: 'egoBoost', label: 'Use Ego Boost (draw up to 2)' },
          { id: 'discardNormally', label: 'Discard normally' },
        ],
      };
    },
  };

  const prompt = {
    drawCountChoice(sourceName, available) {
      return `${sourceName}: draw how many cards? (0–${available})`;
    },

    discardCountChoice(sourceName, available) {
      return `${sourceName}: discard how many cards to Ringside? (0–${available})`;
    },

    shuffleRingsideIntoArsenal(sourceName, n, picked) {
      if (n === 1) {
        return `${sourceName}: choose 1 card from your Ringside to shuffle into your Arsenal.`;
      }
      return `${sourceName}: choose ${n} cards from your Ringside to shuffle into your Arsenal (${picked}/${n}).`;
    },

    shuffleRingsideUpTo(sourceName, maxSelect, picked) {
      if (maxSelect === 1) {
        return `${sourceName}: choose up to 1 card from your Ringside to shuffle into your Arsenal.`;
      }
      return `${sourceName}: choose up to ${maxSelect} cards from your Ringside to shuffle into your Arsenal (${picked}/${maxSelect}).`;
    },

    returnFromRingside(sourceName, n, picked) {
      if (n === 1) {
        return `${sourceName}: choose 1 card from your Ringside to return to your hand.`;
      }
      return `${sourceName}: choose ${n} cards from your Ringside to return to your hand (${picked}/${n}).`;
    },

    discardFromHand(sourceName, n, picked) {
      if (n === 1) {
        return `${sourceName}: discard 1 card from your hand to Ringside before damage is applied.`;
      }
      return `${sourceName}: discard ${n} cards from your hand to Ringside before damage (${picked}/${n}).`;
    },

    opponentDiscardFromHand(sourceName, n, picked) {
      if (n === 1) {
        return `${sourceName}: choose 1 card from your hand to discard to Ringside.`;
      }
      return `${sourceName}: choose ${n} cards from your hand to discard to Ringside (${picked}/${n}).`;
    },

    shuffleHandIntoArsenal(sourceName, drawCount) {
      const drawHint =
        drawCount > 0
          ? ` Then draw ${drawCount} ${cardWord(drawCount)}.`
          : '';
      return `${sourceName}: choose 1 card from your hand to shuffle into your Arsenal.${drawHint}`;
    },

    removeOpponentRingCard(sourceName, maxDamage) {
      return `${sourceName}: choose 1 card in opponent's Ring (D ≤ ${maxDamage}) to put in Ringside.`;
    },

    balanceFortitudeRingRemoval(sourceName, targetFortitude, otherFortitude) {
      return `${sourceName}: remove 1 maneuver or reversal from your Ring (${targetFortitude}F → ≤ ${otherFortitude}F).`;
    },

    arsenalReorder(sourceName, whose, count, target) {
      const shuffleHint =
        target === 'opponent'
          ? "Shuffle to shuffle opponent's entire Arsenal."
          : 'Shuffle to shuffle your entire Arsenal.';
      return `${sourceName}: drag to reorder ${whose} ${count} Arsenal card${count === 1 ? '' : 's'} (left = next to draw). ${shuffleHint}`;
    },

    arsenalOrRingsidePick(sourceName) {
      return `${sourceName}: choose 1 card from your Arsenal or Ringside to put in your hand.`;
    },

    arsenalSearch(sourceName, purpose, n, picked) {
      if (purpose === 'toHand') {
        return `${sourceName}: choose 1 card from your Arsenal to put in your hand.`;
      }
      if (n === 1) {
        return `${sourceName}: choose 1 card from opponent's Arsenal to put in Ringside.`;
      }
      return `${sourceName}: choose ${n} cards from opponent's Arsenal to put in Ringside (${picked}/${n}).`;
    },

    handReveal(engine, flow) {
      const n = flow.cards.length;
      let message = flow.message;
      if (!message) {
        message =
          n === 0
            ? `${flow.sourceName}: opponent has no cards in hand.`
            : `${flow.sourceName}: opponent's hand (${n} ${cardWord(n)}).`;
      }

      if (flow.mode === 'select') {
        const need = flow.selectCount || 1;
        const picked = flow.selectedIds?.length || 0;
        message = `${flow.sourceName}: choose ${need} ${cardWord(need)} from opponent's hand (${picked}/${need}).`;
      }

      return message;
    },

    superstar: {
      rockRingside() {
        return 'The Rock: choose 1 card from your Ringside to put on the bottom of your Arsenal, or Pass.';
      },

      pickBottom() {
        return 'Drew 1 card — choose a card from your hand to put on the bottom of your Arsenal.';
      },

      pickDiscard(picked) {
        return `Choose 2 cards from your hand to discard to Ringside (${picked}/2).`;
      },

      pickRingside() {
        return 'Undertaker: choose 1 card from your Ringside to put into your hand.';
      },

      jerichoDiscardSelf() {
        return 'Chris Jericho: discard 1 card from your hand to force opponent to discard 1 card.';
      },
    },

    superstarAbilityLabel: 'Superstar Ability',
  };

  const log = {
    turnDamageAll(sourceName, all) {
      return `${sourceName}: all maneuvers +${all}D for the rest of this turn.`;
    },

    nextTurnDamageAll(sourceName, all) {
      return `${sourceName}: all maneuvers +${all}D next turn.`;
    },

    nextTurnDamageSubtype(sourceName, subtype, value) {
      const label = maneuverLabel(subtype);
      return `${sourceName}: ${label} maneuvers +${value}D next turn.`;
    },

    turnDamageSubtype(sourceName, subtype, value) {
      const label = maneuverLabel(subtype);
      return `${sourceName}: ${label} maneuvers +${value}D for the rest of this turn.`;
    },

    drewCards(sourceName, drawn) {
      return `${sourceName}: drew ${drawn} card${cardSuffix(drawn)}.`;
    },

    drewZeroOrCards(sourceName, drawn) {
      if (drawn === 0) {
        return `${sourceName}: drew 0 cards.`;
      }
      return `${sourceName}: drew ${drawn} card${cardSuffix(drawn)}.`;
    },

    arsenalEmptyNoDraw(sourceName) {
      return `${sourceName}: Arsenal was empty — could not draw.`;
    },

    shuffledFromHand(sourceName, cardName) {
      return `${sourceName}: shuffled ${cardName} from hand into Arsenal.`;
    },

    noHandToShuffle(sourceName) {
      return `${sourceName}: no cards in hand to shuffle into Arsenal.`;
    },

    endOfTurnDiscardHand(count) {
      return `End of turn: discarded your hand (${count} ${cardWord(count)}) to Ringside.`;
    },

    actionDiscardToDraw(cardName, draws) {
      return `${cardName} (action): discarded to draw ${draws} card${cardSuffix(draws)}.`;
    },

    actionShuffledSelfToArsenal(cardName) {
      return `${cardName} (action): shuffled into Arsenal.`;
    },

    actionPlayed(cardName) {
      return `${cardName} played as an action.`;
    },

    nextStrikeBonus(sourceName, bonus) {
      return `${sourceName}: your next Strike maneuver is +${bonus}D this turn.`;
    },

    noHandToDiscard(sourceName) {
      return `${sourceName}: no cards in hand to discard.`;
    },

    shuffledZeroRingside(sourceName) {
      return `${sourceName}: shuffled 0 cards from Ringside into Arsenal.`;
    },

    discardedZero(sourceName) {
      return `${sourceName}: discarded 0 cards to Ringside.`;
    },

    egoBoostForcedDiscard(sourceName, count) {
      return `${sourceName} forces you to discard from your hand. Use Ego Boost? (${count} ${cardWord(count)} left to discard)`;
    },

    opponentNoHandToDiscard(sourceName) {
      return `${sourceName}: opponent had no cards in hand to discard.`;
    },

    egoBoostReplacedDiscard(sourceName) {
      return `Ego Boost: discarded in place of 1 forced discard (${sourceName}).`;
    },

    opponentDiscarded(sourceName, names) {
      return `${sourceName}: opponent discarded ${names} to Ringside.`;
    },

    discardedEntireHand(sourceName, who, names) {
      return `${sourceName}: ${who} discarded entire hand (${names}) to Ringside.`;
    },

    opponentTopArsenalToRingside(sourceName, count, names) {
      return `${sourceName}: opponent placed top ${count} Arsenal card${cardSuffix(count)} in Ringside (${names}).`;
    },

    opponentTopArsenalPartial(sourceName, moved, requested) {
      return `${sourceName}: opponent placed ${moved} of top ${requested} Arsenal cards in Ringside.`;
    },

    drewOneCard(sourceName) {
      return `${sourceName}: drew 1 card.`;
    },

    noOpponentHandToDiscard(sourceName) {
      return `${sourceName}: no cards to discard from opponent's hand.`;
    },

    noMatchingOpponentHand(sourceName) {
      return `${sourceName}: no matching cards in opponent's hand to discard.`;
    },

    comebackNoCardsToRemove(sourceName, who) {
      return `${sourceName}: ${who} no maneuver/reversal cards to remove.`;
    },

    removedFromRing(sourceName, cardName) {
      return `${sourceName}: removed ${cardName} from Ring to Ringside.`;
    },

    noValidOpponentRing(sourceName) {
      return `${sourceName}: no valid cards in opponent's Ring to remove.`;
    },

    removedFromOpponentRing(sourceName, cardName) {
      return `${sourceName}: removed ${cardName} from opponent's Ring to Ringside.`;
    },

    arsenalEmpty(sourceName) {
      return `${sourceName}: Arsenal is empty.`;
    },

    lookAtTopArsenal(sourceName, n, target) {
      const lookTarget = whoseArsenal(target);
      return `${sourceName}: look at top ${n} card${cardSuffix(n)} of ${lookTarget} Arsenal.`;
    },

    shuffledArsenal(sourceName, isOpponent) {
      return isOpponent
        ? `${sourceName}: shuffled opponent's Arsenal.`
        : `${sourceName}: shuffled your Arsenal.`;
    },

    rearrangedTopArsenal(sourceName, count, target) {
      const whose = whoseArsenal(target);
      return `${sourceName}: rearranged top ${count} card${cardSuffix(count)} of ${whose} Arsenal.`;
    },

    pickedFromArsenalToHand(sourceName, cardName) {
      return `${sourceName}: put ${cardName} from your Arsenal into your hand.`;
    },

    pickedFromRingsideToHand(sourceName, cardName) {
      return `${sourceName}: put ${cardName} from Ringside into your hand.`;
    },

    noArsenalOrRingsideToPick(sourceName) {
      return `${sourceName}: no cards in Arsenal or Ringside to take.`;
    },

    markingOutEmptyOwnArsenal(sourceName) {
      return `${sourceName}: your Arsenal is empty — no card to put in hand.`;
    },

    markingOutLookOwn(sourceName) {
      return `${sourceName}: look through your Arsenal.`;
    },

    markingOutEmptyOpponentArsenal(sourceName) {
      return `${sourceName}: opponent's Arsenal is empty — no cards to put in Ringside.`;
    },

    markingOutLookOpponent(sourceName) {
      return `${sourceName}: look through opponent's Arsenal.`;
    },

    markingOutPutInHand(sourceName, cardName) {
      return `${sourceName}: put ${cardName} from your Arsenal into your hand.`;
    },

    markingOutPutOpponentInRingside(sourceName, names) {
      return `${sourceName}: put ${names} from opponent's Arsenal into Ringside.`;
    },

    opponentDrew(sourceName, drawn) {
      return `${sourceName}: opponent drew ${drawn} card${cardSuffix(drawn)}.`;
    },

    opponentArsenalEmptyNoDraw(sourceName) {
      return `${sourceName}: opponent had no cards in Arsenal to draw.`;
    },

    opponentNoHandDiscard(sourceName) {
      return `${sourceName}: opponent had no cards in hand to discard.`;
    },

    actionReversedNoEffect(reversalName, playedName) {
      return `${reversalName} reversed ${playedName} — action has no effect.`;
    },

    reversalFromHand(reversalName, playedName) {
      return `${reversalName} reversed ${playedName} from hand!`;
    },

    maintainHoldPlayed(submissionName) {
      return `Maintain Hold: maintaining ${submissionName}.`;
    },

    maintainHoldReapplied(submissionName, damage) {
      return `Maintain Hold: ${submissionName} applies again (${damage}D).`;
    },

    maintainHoldReversedFromHand(reversalName, submissionName) {
      return `${reversalName} reversed maintained ${submissionName} from hand — Maintain Hold disabled.`;
    },

    maintainHoldDisabled(reason) {
      if (reason === 'handReversal') {
        return 'Maintain Hold ability disabled (reversed from hand).';
      }
      if (reason === 'arsenalReversal') {
        return 'Maintain Hold ability disabled (reversed from Arsenal).';
      }
      return 'Maintain Hold ability disabled.';
    },

    grappleDamageBonus(sourceName) {
      return `${sourceName}: your next Grapple maneuver is +4D.`;
    },

    grappleReversalTax(sourceName) {
      return `${sourceName}: opponent's reversal to your next Grapple is +8F.`;
    },

    drewNCards(sourceName, n) {
      return `${sourceName}: drew ${n} cards.`;
    },

    putArsenalInRingside(sourceCardName, topName) {
      return `${sourceCardName}: put ${topName} from Arsenal into Ringside.`;
    },

    topArsenalToRingside(sourceName, count, names) {
      return `${sourceName}: placed top ${count} Arsenal card${cardSuffix(count)} in Ringside (${names}).`;
    },

    topArsenalPartial(sourceName, moved, requested) {
      return `${sourceName}: placed ${moved} of top ${requested} Arsenal cards in Ringside.`;
    },

    reversalSvDraw(maneuverName, sv, who, drawn) {
      return `${maneuverName} reversed (SV ${sv}): ${who} ${drawn} card${cardSuffix(drawn)}.`;
    },

    kaneEmptyArsenal() {
      return "Kane: opponent's Arsenal is empty — no card to overturn.";
    },

    kaneOverturned(topName) {
      return `Kane overturned ${topName} from opponent's Arsenal to Ringside.`;
    },

    shaneOMacEmptyArsenal(sourceName) {
      return `${sourceName}: opponent's Arsenal is empty — no card to overturn.`;
    },

    shaneOMacOverturned(sourceName, topName) {
      return `${sourceName}: opponent's top Arsenal card (${topName}) moved to Ringside.`;
    },

    rockPassed() {
      return 'The Rock passed on moving a card from Ringside to Arsenal.';
    },

    rockMovedToArsenalBottom(cardName) {
      return `The Rock put ${cardName} from Ringside on the bottom of your Arsenal.`;
    },

    undertakerDiscardedRetrieved(discarded, cardName) {
      return `Undertaker discarded ${discarded} and retrieved ${cardName} from Ringside.`;
    },

    returnedFromRingside(sourceName, names) {
      return `${sourceName}: returned ${names} from Ringside to hand.`;
    },

    shuffledRingsideIntoArsenal(sourceName, names) {
      return `${sourceName}: shuffled ${names} from Ringside into Arsenal.`;
    },

    jerichoNoOpponentHand(discardedCardName) {
      return `Chris Jericho discarded ${discardedCardName}; opponent had no cards in hand to discard.`;
    },

    jerichoForcedDiscard(discardedCardName) {
      return `Chris Jericho discarded ${discardedCardName}; opponent must discard 1 card.`;
    },

    stoneColdBottomArsenal(cardName) {
      return `Stone Cold drew 1 card and put ${cardName} on the bottom of your Arsenal.`;
    },

    skippedHandReveal(sourceName) {
      return `${sourceName}: skipped looking at opponent's hand.`;
    },

    viewingOpponentHand(sourceName, n) {
      return `${sourceName}: viewing opponent's hand (${n} ${cardWord(n)}).`;
    },

    opponentNoHand(sourceName) {
      return `${sourceName}: opponent has no cards in hand.`;
    },

    pipelineDrew(sourceName, count) {
      return `${sourceName}: drew ${count} card${cardSuffix(count)}.`;
    },

    nextManeuverBonus(sourceName, value) {
      return `${sourceName}: next maneuver +${value}D.`;
    },

    nextCardManeuverBonus(sourceName, value) {
      return `${sourceName}: if your next card played this turn is a maneuver, it is +${value}D.`;
    },

    nextSubtypeManeuverBonus(sourceName, subtype, value) {
      const label = maneuverLabel(subtype);
      return `${sourceName}: if your next card played this turn is a ${label} maneuver, it is +${value}D.`;
    },

    nextCardFortitudeReduction(sourceName, value) {
      return `${sourceName}: your next card played is -${value}F.`;
    },

    nextManeuverReversalTax(sourceName, value) {
      return `${sourceName}: opponent's reversal to your next maneuver is +${value}F.`;
    },

    turnOpponentReversalTax(sourceName, value) {
      return `${sourceName}: opponent's reversals are +${value}F for the rest of this turn.`;
    },

    nextTurnOpponentReversalTax(sourceName, value) {
      return `${sourceName}: opponent's reversals are +${value}F next turn.`;
    },

    blockOpponentReversals(sourceName) {
      return `${sourceName}: opponent's Arsenal reversals cannot reverse your maneuvers this turn.`;
    },

    skipOpponentTurn(sourceName) {
      return `${sourceName}: opponent skips their next turn.`;
    },

    discardHandAtEndOfTurn(sourceName) {
      return `${sourceName}: at end of turn, discard your hand.`;
    },

    nextManeuverUnreversible(sourceName, maxDamage) {
      const capLabel =
        maxDamage == null
          ? 'your next maneuver'
          : `your next maneuver of ${maxDamage}D or less`;
      return `${sourceName}: if ${capLabel} is played next, opponent cannot reverse it.`;
    },

    noRingsideToReturn(sourceName) {
      return `${sourceName}: no cards in Ringside to return.`;
    },

    discardedToRingside(sourceName, names) {
      return `${sourceName}: discarded ${names} to Ringside.`;
    },
  };

  function choice(choiceId, ctx) {
    const factory = choiceRegistry[choiceId];
    if (!factory) return null;
    return factory(ctx || {});
  }

  window.RawDeal.GameCopy = {
    cardWord,
    maneuverLabel,
    whoseArsenal,
    whoHas,
    whoDraws,
    choice,
    prompt,
    log,
  };
})();