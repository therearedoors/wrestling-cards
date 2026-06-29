#!/usr/bin/env python3
"""Generate Premiere Edition cards.js and decks.js from TCO card text."""

import json
import re
import html
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PREMIERE_TXT = Path(__file__).resolve().parent.parent / 'data' / 'premiere.txt'

TAG_TEAM_NUMS = {11, 69, 73, 78, 84, 97}

SUPERSTAR_SLUGS = {
    123: 'stone-cold',
    127: 'undertaker',
    131: 'mankind',
    135: 'hhh',
    139: 'the-rock',
    143: 'kane',
    147: 'jericho',
}
SUPERSTAR_NUMS = set(SUPERSTAR_SLUGS.keys())

DECK_DEFS = {
    'rock': {
        'name': 'The Rock',
        'superstarId': 'the-rock',
        'opponent': 'austin',
        'cards': {
            'smackdown-hotel': 1, 'take-that-move': 1, 'rock-bottom': 1,
            'peoples-elbow': 1, 'peoples-eyebrow': 1,
            'chop': 3, 'punch': 3, 'head-butt': 2,
            'arm-drag': 3, 'hip-toss': 3, 'samoan-drop': 3,
            'russian-leg-sweep': 3, 'snap-mare': 2, 'spinning-heel-kick': 2,
            'superkick': 3, 'roundhouse-punch': 3, 'gut-buster': 2,
            'double-leg-takedown': 3, 'step-aside': 3, 'escape-move': 3,
            'break-the-hold': 2, 'irish-whip': 3, 'whaddya-got': 2,
            'shake-it-off': 2, 'recovery': 2, 'comeback': 1,
            'hmmm': 1, 'ego-boost': 1,
        },
    },
    'austin': {
        'name': '"Stone Cold" Steve Austin',
        'superstarId': 'stone-cold',
        'opponent': 'rock',
        'cards': {
            'austin-elbow-smash': 1, 'lou-thesz-press': 1, 'double-digits': 1,
            'stone-cold-stunner': 1, 'open-up-a-can': 1,
            'chop': 3, 'punch': 3, 'kick': 3, 'haymaker': 3,
            'clothesline': 2, 'spear': 3, 'spinning-heel-kick': 2,
            'atomic-drop': 3, 'headlock-takedown': 3, 'roundhouse-punch': 2,
            'step-aside': 3, 'knee-to-the-gut': 3, 'elbow-to-the-face': 3,
            'irish-whip': 3, 'stagger': 2, 'spit-at-opponent': 2,
            'whaddya-got': 2, 'shake-it-off': 2, 'comeback': 1,
            'running-elbow-smash': 2, 'ensugiri': 2, 'arm-bar-takedown': 2,
            'fireman-s-carry': 1,
        },
    },
    'undertaker': {
        'name': 'The Undertaker',
        'superstarId': 'undertaker',
        'opponent': 'mankind',
        'cards': {
            'undertakers-chokeslam': 1, 'undertakers-flying-clothesline': 1,
            'undertaker-sits-up': 1, 'undertakers-tombstone-piledriver': 1,
            'power-of-darkness': 1,
            'body-slam': 3, 'back-breaker': 2, 'ddt': 2,
            'sleeper': 3, 'choke-hold': 2, 'chin-lock': 3,
            'bear-hug': 2, 'step-over-toe-hold': 2,
            'punch': 3, 'big-boot': 2, 'clothesline': 2,
            'break-the-hold': 3, 'escape-move': 3, 'step-aside': 2,
            'rolling-takedown': 2, 'irish-whip': 2, 'recovery': 2,
            'hellfire-brimstone': 1, 'view-of-villainy': 2,
            'gut-buster': 2, 'headlock-takedown': 2, 'snap-mare': 1,
            'arm-bar': 2, 'collar-elbow-lockup': 2,
            'russian-leg-sweep': 2, 'wrist-lock': 1,
        },
    },
    'mankind': {
        'name': 'Mankind',
        'superstarId': 'mankind',
        'opponent': 'undertaker',
        'cards': {
            'have-a-nice-day': 1, 'double-arm-ddt': 1, 'tree-of-woe': 1,
            'mandible-claw': 1, 'mr-socko': 1,
            'head-butt': 3, 'punch': 3, 'choke-hold': 3,
            'sleeper': 3, 'arm-bar': 3, 'wrist-lock': 3,
            'ddt': 2, 'gut-buster': 3, 'back-breaker': 2,
            'break-the-hold': 3, 'escape-move': 3, 'elbow-to-the-face': 2,
            'knee-to-the-gut': 2, 'irish-whip': 2, 'recovery': 2,
            'stagger': 2, 'roll-out-of-the-ring': 2,
            'double-leg-takedown': 2, 'hip-toss': 2,
            'chin-lock': 2, 'standing-side-headlock': 2,
            'don-t-think-too-hard': 2, 'arm-drag': 2,
        },
    },
    'hhh': {
        'name': 'Triple H',
        'superstarId': 'hhh',
        'opponent': 'kane',
        'cards': {
            'leaping-knee-to-the-face': 1, 'facebuster': 1, 'i-am-the-game': 1,
            'pedigree': 1, 'chyna-interferes': 1,
            'head-butt': 3, 'roundhouse-punch': 3, 'clothesline': 2,
            'back-body-drop': 3,
            'atomic-drop': 3, 'belly-to-belly-suplex': 2,
            'pump-handle-slam': 1, 'body-slam': 2,
            'ddt': 2, 'irish-whip': 3, 'jockeying-for-position': 2,
            'whaddya-got': 3, 'diversion': 1, 'stagger': 2,
            'step-aside': 3, 'knee-to-the-gut': 3, 'escape-move': 2,
            'view-of-villainy': 2, 'spit-at-opponent': 2,
            'distract-the-ref': 2
        },
    },
    'kane': {
        'name': 'Kane',
        'superstarId': 'kane',
        'opponent': 'hhh',
        'cards': {
            'kanes-chokeslam': 1, 'kanes-flying-clothesline': 1,
            'kanes-return': 1, 'kanes-tombstone-piledriver': 1,
            'hellfire-brimstone': 1,
            'big-boot': 3, 'clothesline': 3, 'body-slam': 3,
            'power-slam': 2, 'sit-out-powerbomb': 2,
            'choke-hold': 3, 'bear-hug': 2, 'back-breaker': 2,
            'punch': 3, 'gut-buster': 3, 'headlock-takedown': 2,
            'step-aside': 2, 'break-the-hold': 2, 'escape-move': 2,
            'irish-whip': 2, 'recovery': 2, 'view-of-villainy': 2,
            'chair-shot': 1, 'powerbomb': 1,
            'ddt': 2, 'vertical-suplex': 2, 'belly-to-belly-suplex': 2,
            'atomic-drop': 2, 'discus-punch': 1, 'running-elbow-smash': 1,
            'russian-leg-sweep': 2, 'wrist-lock': 1,
        },
    },
    'jericho': {
        'name': 'Chris Jericho',
        'superstarId': 'jericho',
        'opponent': 'rock',
        'cards': {
            'lionsault': 1, 'y2j': 1, 'dont-you-never-ever': 1,
            'walls-of-jericho': 1, 'ayatollah-of-rock-n-roll-a': 1,
            'ensugiri': 3, 'drop-kick': 2, 'hurricanrana': 1,
            'spinning-heel-kick': 3, 'superkick': 3, 'spear': 2,
            'arm-drag': 3, 'hip-toss': 3, 'snap-mare': 3,
            'atomic-facebuster': 2, 'headlock-takedown': 2,
            'step-aside': 3, 'escape-move': 3, 'elbow-to-the-face': 2,
            'irish-whip': 3, 'whaddya-got': 2, 'flash-in-the-pan': 2,
            'comeback': 1, 'ego-boost': 1,
            'roundhouse-punch': 3, 'fireman-s-carry': 2, 'double-leg-takedown': 2,
            'knee-to-the-gut': 2, 'rolling-takedown': 1, 'hmmm': 1,
        },
    },
}

# Fix HHH deck - remove placeholder and balance to 60
DECK_DEFS['hhh']['cards'].pop('spinebuster-equivalent', None)
DECK_DEFS['hhh']['cards']['vertical-suplex'] = 2
DECK_DEFS['hhh']['cards']['belly-to-back-suplex'] = 1
DECK_DEFS['hhh']['cards']['headlock-takedown'] = 2
DECK_DEFS['hhh']['cards']['snap-mare'] = 2
DECK_DEFS['hhh']['cards']['knee-to-the-gut'] = 1
DECK_DEFS['hhh']['cards']['roundhouse-punch'] = 2
DECK_DEFS['hhh']['cards']['double-leg-takedown'] = 2
DECK_DEFS['hhh']['cards']['chop'] = 3


def slugify(name: str) -> str:
    s = name.lower()
    s = s.replace("'", '').replace('"', '').replace('&', 'and')
    s = re.sub(r'\([^)]*\)', '', s)
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    # shorten long names
    shortcuts = {
        'take-that-move-shine-it-up-real-nice-turn-that-sumb-tch-sideways-and-stick-it-straight-up-your-roody-poo-candy-a': 'take-that-move',
        'stone-cold-steve-austin-logo-and-signature': 'stone-cold',
        'the-rock-logo-and-signature': 'the-rock',
        'the-undertaker-logo-and-signature': 'undertaker',
        'mankind-logo-and-signature': 'mankind',
        'hhh-logo-and-signature': 'hhh',
        'kane-logo-and-signature': 'kane',
        'chris-jericho-logo-and-signature': 'jericho',
        'don-t-you-never-ever': 'dont-you-never-ever',
        'open-up-a-can-of-whoop-a': 'open-up-a-can',
        'undertaker-s-tombstone-piledriver': 'undertakers-tombstone-piledriver',
        'kane-s-tombstone-piledriver': 'kanes-tombstone-piledriver',
        'undertaker-s-chokeslam': 'undertakers-chokeslam',
        'undertaker-s-flying-clothesline': 'undertakers-flying-clothesline',
        'kane-s-chokeslam': 'kanes-chokeslam',
        'kane-s-flying-clothesline': 'kanes-flying-clothesline',
        'kane-s-return': 'kanes-return',
        'the-people-s-elbow': 'peoples-elbow',
        'the-people-s-eyebrow': 'peoples-eyebrow',
        'hellfire-and-brimstone': 'hellfire-brimstone',
        'collar-and-elbow-lockup': 'collar-elbow-lockup',
    }
    return shortcuts.get(s, s)


def parse_cards(text: str):
    text = text.replace('\xa0', ' ').replace('\r', '')
    start = text.find('1/150')
    end = text.find('Promotional Cards')
    if end < 0:
        end = text.find('Text only | Text with Images')
    if start < 0:
        start = text.find('Card List for')
    body = text[start:end] if end > start else text[start:]

    matches = list(re.finditer(r'(\d+)/150\n', body))
    cards = {}

    for i, m in enumerate(matches):
        num = int(m.group(1))
        block = body[m.end(): matches[i + 1].start() if i + 1 < len(matches) else len(body)]
        lines = [ln.strip() for ln in block.split('\n') if ln.strip()]

        name = lines[0]
        idx = 1
        type_lines = []
        rule_starters = (
            'When ', 'As ', 'May ', 'Can ', 'The card', 'To play', 'Reversals',
            'If played', 'Unique', 'You must', 'All ', 'Draw', 'Shuffle', 'Look',
            'Starting', 'Superstar', 'Once', 'At the', 'None,', 'He is', 'Play ',
            'Cannot', 'Reverse ', 'Count ', 'While ', 'Run-in', 'Search ', 'Discard',
            'Choose', 'Put ', 'Take ', 'Your ', 'Opponent', 'Reveal', 'Show ',
        )
        while idx < len(lines):
            line = lines[idx]
            if line.startswith('"') or re.search(r'\bF:\s*\d+', line):
                break
            type_lines.append(line)
            idx += 1
            if idx < len(lines) and lines[idx].startswith(rule_starters):
                break

        rules_lines = []
        while idx < len(lines):
            line = lines[idx]
            if line.startswith('"') or re.search(r'\bF:\s*\d+', line):
                break
            rules_lines.append(line)
            idx += 1

        stats = lines[idx] if idx < len(lines) else ''
        idx += 1
        flavor = lines[idx] if idx < len(lines) and lines[idx].startswith('"') else ''

        fort = dmg = None
        if m := re.search(r'F:\s*(\d+)', stats):
            fort = int(m.group(1))
        if m := re.search(r'D:\s*(\d+)', stats):
            dmg = int(m.group(1))

        types_blob = ' / '.join(type_lines)
        rules = ' '.join(rules_lines)
        if rules and not rules.endswith('.'):
            rules = rules  # keep as-is
        sv = parse_stun_value(stats, rules)

        card_id = SUPERSTAR_SLUGS.get(num, slugify(name))
        if num in SUPERSTAR_NUMS:
            hand_size = sv_val = None
            ability_lines = []
            for line in lines[1:]:
                if m := re.search(r'Starting Hand Size:\s*(\d+)', line):
                    hand_size = int(m.group(1))
                if m := re.search(r'Star Value:\s*(\d+)', line):
                    sv_val = int(m.group(1))
                if line.startswith('Superstar Ability:'):
                    continue
                if hand_size and sv_val and line and 'Starting Hand' not in line and 'Star Value' not in line and not line.startswith('('):
                    if not re.search(r'\bF:\s*\d+', line) and not line.startswith('"'):
                        ability_lines.append(line)
            ability = ' '.join(ability_lines).strip()
            cards[card_id] = {
                'id': card_id,
                'num': num,
                'name': name.split('(')[0].strip().title() if 'logo' in name.lower() else name,
                'types': ['superstar'],
                'handSize': hand_size or 5,
                'superstarValue': sv_val or 3,
                'ability': ability,
                'text': ability,
                'flavor': flavor.strip('"'),
                'set': 'premiere',
            }
            continue

        if num in TAG_TEAM_NUMS:
            continue

        card_text_blob = f'{types_blob} {rules}'.lower()
        if 'tag team only' in card_text_blob:
            continue

        subtype, reverses = classify(types_blob, rules, name, dmg)
        unique = bool(re.search(r'^Unique$', rules, re.M)) or num >= 123

        types_list = parse_types_list(types_blob)
        alignment = parse_alignment(types_blob)
        types_for_text = strip_alignment_from_types(types_blob)

        entry = {
            'id': card_id,
            'num': num,
            'name': name,
            'types': types_list,
            'fortitude': fort if fort is not None else 0,
            'damage': dmg or 0,
            'text': build_text(types_for_text, rules),
            'flavor': flavor.strip('"'),
            'set': 'premiere',
        }
        if alignment:
            entry['alignment'] = alignment
        if subtype:
            entry['subtype'] = subtype
        if sv is not None:
            entry['stunValue'] = sv
        if unique:
            entry['unique'] = True
        if reverses:
            entry['reverses'] = reverses
        if len(types_list) > 1:
            entry['hybrid'] = True

        maneuver_effects = infer_maneuver_effects(types_list, rules)
        if maneuver_effects:
            entry['maneuverEffects'] = maneuver_effects
        action_effects = infer_action_effects(types_list, rules, name)
        if action_effects:
            entry['actionEffects'] = action_effects
        reversal_effects = infer_reversal_effects(types_list, rules, dmg or 0)
        if reversal_effects:
            entry['reversalEffects'] = reversal_effects
        requires = infer_requires_played(rules)
        if requires:
            entry.update(requires)

        cards[card_id] = entry

    for entry in cards.values():
        discount = infer_discount_after_card(entry['text'], cards)
        if discount:
            entry.update(discount)

    return cards


MANEUVER_MARKERS = ('Strike', 'Grapple', 'Submission', 'High Risk', 'Trademark', 'Maneuver')


def _has_standalone_maneuver_segment(types_blob: str) -> bool:
    """True when the card line includes a maneuver type, not only 'Reversal: Strike'."""
    blob = types_blob.strip()
    blob_lower = blob.lower()
    if '/' in blob:
        head = blob.split('/')[0].strip()
        return any(k in head for k in MANEUVER_MARKERS)
    if blob_lower.startswith('reversal') or blob_lower.startswith('action'):
        return False
    return any(k in blob for k in MANEUVER_MARKERS)


def _has_action_segment(types_blob: str) -> bool:
    blob_lower = types_blob.lower().strip()
    return bool(
        re.search(r'(^|/|\s)action', blob_lower) or blob_lower.startswith('action')
    )


def parse_types_list(types_blob: str) -> list:
    """Return ordered play modes for a card, e.g. ['maneuver', 'action']."""
    blob_lower = types_blob.lower().strip()
    types = []

    if _has_standalone_maneuver_segment(types_blob):
        types.append('maneuver')
    if _has_action_segment(types_blob):
        types.append('action')
    if blob_lower.startswith('reversal') or (
        'reversal' in blob_lower and '/' in types_blob
    ):
        types.append('reversal')

    if not types:
        if blob_lower.startswith('action'):
            types = ['action']
        elif 'reversal' in blob_lower:
            types = ['reversal']
        else:
            types = ['maneuver']

    seen = set()
    ordered = []
    for t in types:
        if t not in seen:
            seen.add(t)
            ordered.append(t)
    return ordered


def infer_requires_played(rules):
    blob = rules.lower()
    if (
        'irish whip must be played before' in blob
        or 'must play the card titled irish whip before' in blob
    ):
        return {'requiresPlayed': 'irish-whip'}
    return None


def _resolve_referenced_card_id(title, cards):
    """Map printed card titles (e.g. Kane's Choke Slam) to catalog ids."""
    ref_id = slugify(title)
    if ref_id in cards:
        return ref_id

    title_lower = title.lower().strip()
    for cid, card in cards.items():
        if card.get('name', '').lower() == title_lower:
            return cid

    compact = re.sub(r"[^a-z0-9]+", '', title_lower)
    for cid, card in cards.items():
        name_compact = re.sub(r"[^a-z0-9]+", '', card.get('name', '').lower())
        if name_compact == compact:
            return cid

    return ref_id


def infer_discount_after_card(rules, cards):
    """Fortitude discount when played immediately after a specific card."""
    blob = rules.lower()
    m = re.search(
        r'-(\d+)f on this card if played after the (?:maneuver|card) titled ([^.]+)',
        blob,
    )
    if not m:
        return None

    fortitude = int(m.group(1))
    title = html.unescape(m.group(2).strip())
    ref_id = _resolve_referenced_card_id(title, cards)
    return {'discountAfterCard': {'cardId': ref_id, 'fortitude': fortitude}}


def classify(types_blob, rules, name, damage):
    blob = (types_blob + ' ' + rules).lower()
    reverses = []
    types_lower = types_blob.lower()

    if 'superstar' in types_lower:
        return None, []

    subtype = None
    for st in ('trademark-finisher', 'trademark', 'high-risk', 'submission', 'grapple', 'strike'):
        if st.replace('-', ' ') in blob or st in blob:
            subtype = st
            break

    if 'reversal' in types_blob.lower():
        if 'reverse any strike' in blob or 'reversal: strike' in blob:
            reverses.append('strike')
        if 'reverse any grapple' in blob or 'reversal: grapple' in blob:
            reverses.append('grapple')
        if 'reverse any submission' in blob or 'reversal: submission' in blob:
            reverses.append('submission')
        if 'reverse any strike, grapple or submission' in blob or 'reverse any strike, grapple or submission' in blob:
            reverses = ['strike', 'grapple', 'submission']
        if 'reverse any maneuver' in blob:
            reverses = ['strike', 'grapple', 'submission', 'high-risk', 'trademark', 'trademark-finisher']
        if 'reverse any action' in blob:
            reverses.append('action')
        if '5d or less' in blob or '5 or less damage' in blob:
            reverses.append('low-damage')
        if 'irish whip' in blob:
            reverses.append('after-irish-whip')

    return subtype, reverses


def parse_stun_value(stats, rules):
    """Parse Stun Value from the stats line or rules text (e.g. 'SV: 1', 'Unique SV: 3')."""
    for src in (stats, rules):
        if m := re.search(r'(?:unique\s+)?sv:\s*(\d+)', src, re.I):
            return int(m.group(1))
    return None


def parse_alignment(types_blob: str):
    """Return 'face' or 'heel' when the type line declares alignment, else None."""
    if re.search(r':\s*Heel\b', types_blob):
        return 'heel'
    if re.search(r':\s*Face\b', types_blob):
        return 'face'
    return None


def strip_alignment_from_types(types_blob: str) -> str:
    """Remove ': Face' / ': Heel' suffixes from the type line for display text."""
    stripped = re.sub(r':\s*(Face|Heel)\b', '', types_blob)
    return re.sub(r'\s+', ' ', stripped).strip()


def build_text(types_blob, rules):
    parts = []
    if types_blob:
        parts.append(types_blob.strip())
    if rules:
        parts.append(rules.strip())
    return ' '.join(parts)


def infer_maneuver_effects(types_list, rules):
    if 'maneuver' not in types_list:
        return None
    blob = rules.lower()
    effects = []

    if 'when successfully played' in blob and 'discard 1 card of your choice from your hand' in blob:
        effects.append({'op': 'discardFromHand', 'count': 1})

    for subtype in ('strike', 'grapple', 'submission'):
        if f'next card played this turn is a {subtype} maneuver' in blob:
            m = re.search(r'\+(\d+)d', blob)
            if m:
                effects.append({
                    'op': 'nextCardSubtypeManeuverBonus',
                    'subtype': subtype,
                    'value': int(m.group(1)),
                })
            break

    if 'next card played this turn is a maneuver' in blob and '+2d' in blob:
        effects.append({'op': 'nextCardManeuverBonus', 'value': 2})

    if (
        'draw 2 cards, or force opponent to discard 2' in blob
        or 'either draw 2 cards, or force opponent to discard 2' in blob
    ):
        effects.append({'op': 'drawOrOpponentChoice', 'count': 2})

    if 'take the top card of your arsenal and put it into your ringside pile' in blob:
        effects.append({'op': 'topArsenalToRingside'})
        if 'you may draw 1' in blob:
            effects.append({'op': 'draw', 'count': 1})

    m = re.search(r'when successfully played, opponent must draw (\d+) cards?', blob)
    if m:
        effects.append({'op': 'opponentDraw', 'count': int(m.group(1))})
    elif 'when successfully played, opponent must draw 1 card' in blob:
        effects.append({'op': 'opponentDraw', 'count': 1})

    m = re.search(r'when successfully played, opponent must discard (\d+) cards?', blob)
    if m:
        effects.append({'op': 'opponentDiscardFromHand', 'count': int(m.group(1))})
    elif 'when successfully played, opponent discards 1 card' in blob:
        effects.append({'op': 'opponentDiscardFromHand', 'count': 1})

    for subtype in ('strike', 'grapple', 'submission'):
        m = re.search(
            rf'when successfully played.*all {subtype} maneuvers are \+(\d+)d for the rest of this turn',
            blob,
        )
        if m:
            effects.append({
                'op': 'turnSubtypeDamageBonus',
                'subtype': subtype,
                'value': int(m.group(1)),
            })

    if (
        ('you may look at your opponent' in blob or 'you may look at opponent' in blob)
        and 'choose and discard 1 card from his hand' not in blob
    ):
        effects.append({'op': 'revealOpponentHand', 'optional': True})

    if 'look at opponent' in blob and 'choose and discard 1 card from his hand' in blob:
        effects.append({'op': 'revealOpponentHand', 'selectCount': 1})
        effects.append({'op': 'discardFromOpponentHand', 'mode': 'chosen'})

    return effects or None


def infer_reversal_effects(types_list, rules, damage):
    """Effects when a reversal is played from hand during the reversal window."""
    if 'reversal' not in types_list:
        return None
    blob = rules.lower()
    if damage <= 0:
        return None
    if 'read as 0 when in your ring' in blob:
        return None
    return [{'op': 'dealDamage'}]


def infer_action_effects(types_list, rules, name=''):
    if 'action' not in types_list:
        return None
    blob = rules.lower()
    card_name = name.lower()

    if 'look at the top' in blob and 'opponent' in blob and 'arrange them in any order' in blob:
        m = re.search(r'top (\d+)', blob)
        count = int(m.group(1)) if m else 5
        return [{'op': 'reorderArsenalTop', 'count': count, 'target': 'opponent'}]

    if 'look at the top' in blob and 'your arsenal' in blob and 'arrange them in any order' in blob:
        m = re.search(r'top (\d+)', blob)
        count = int(m.group(1)) if m else 5
        return [{'op': 'reorderArsenalTop', 'count': count}]

    if 'opponent skips his next turn' in blob or 'opponent skips their next turn' in blob:
        return [{'op': 'skipOpponentNextTurn'}]

    if 'as an action' in blob and 'discard this card to draw 1' in blob:
        return [{'op': 'discardSelfToDraw', 'count': 1}]

    if 'irish whip' in card_name or (
        'as an action' in blob
        and 'next card played' in blob
        and 'strike maneuver it is' in blob
    ):
        m = re.search(r'strike maneuver it is \+(\d+)d', blob)
        if m:
            return [{'op': 'setupIrishWhip', 'strikeBonus': int(m.group(1))}]

    if 'jockeying' in card_name and 'as an action' in blob:
        return [{'op': 'jockeyingChoice'}]

    has_look = 'look at opponent' in blob or 'look at your opponent' in blob
    if has_look:
        effects = []
        if 'draw 1' in blob or 'draw a card' in blob:
            effects.append({'op': 'draw', 'count': 1})
        effects.append({'op': 'revealOpponentHand'})

        if 'discard all heel' in blob:
            effects.append({
                'op': 'discardFromOpponentHand',
                'filter': {'alignment': 'heel'},
                'mode': 'all',
            })
        elif 'discard all face' in blob:
            effects.append({
                'op': 'discardFromOpponentHand',
                'filter': {'alignment': 'face'},
                'mode': 'all',
            })
        elif 'disqualification' in blob and 'discard' in blob:
            effects.append({
                'op': 'discardFromOpponentHand',
                'filter': {'cardId': 'disqualification'},
                'mode': 'all',
            })
        elif 'next maneuver' in blob and '+6d' in blob:
            effects.append({'op': 'nextManeuverBonus', 'value': 6})
        elif 'may not reverse your maneuvers' in blob:
            effects.append({'op': 'blockOpponentReversals'})
        return effects

    if 'i am the game' in card_name:
        return [{'op': 'turnDamageBonus', 'value': 3}]

    if 'open up a can' in card_name:
        effects = []
        if '+6d' in blob:
            effects.append({'op': 'nextManeuverBonus', 'value': 6})
        if '+20f' in blob:
            effects.append({'op': 'nextManeuverReversalTax', 'value': 20})
        effects.append({'op': 'draw', 'count': 1})
        return effects

    if 'take a card in your hand' in blob and 'shuffle it into your arsenal' in blob:
        effects = [{'op': 'shuffleHandIntoArsenal'}]
        if 'draw 2' in blob:
            effects[0]['draw'] = 2
        elif 'draw 1' in blob:
            effects[0]['draw'] = 1
        return effects

    if 'draw up to 5' in blob:
        return [{'op': 'draw', 'count': 5}]
    if 'draw 2' in blob or 'draw up to 2' in blob:
        return [{'op': 'draw', 'count': 2}]
    if 'draw 1' in blob or 'draw a card' in blob:
        return [{'op': 'draw', 'count': 1}]
    if 'next maneuver' in blob and '+3d' in blob:
        return [{'op': 'nextManeuverBonus', 'value': 3}]
    if 'next maneuver' in blob and '+2d' in blob:
        return [{'op': 'nextManeuverBonus', 'value': 2}]
    if 'all your maneuvers are +3d' in blob:
        return [{'op': 'turnDamageBonus', 'value': 3}]

    return None

def js_str(s):
    return json.dumps(s, ensure_ascii=False)


def emit_cards(cards):
    lines = ['window.RawDeal = window.RawDeal || {};', '', 'window.RawDeal.CARDS = {']
    items = sorted(cards.values(), key=lambda c: c['num'])
    for i, card in enumerate(items):
        parts = [f"  '{card['id']}': {{"]
        for key in ['id', 'num', 'name', 'types', 'subtype', 'alignment', 'handSize', 'superstarValue',
                    'ability', 'fortitude', 'damage', 'stunValue', 'text', 'flavor',
                    'unique', 'hybrid', 'reverses', 'requiresPlayed', 'discountAfterCard',
                    'actionEffects', 'maneuverEffects', 'reversalEffects', 'set']:
            if key in card and card[key] is not None:
                val = card[key]
                if isinstance(val, bool):
                    parts.append(f'    {key}: {"true" if val else "false"},')
                elif isinstance(val, (int, float)):
                    parts.append(f'    {key}: {val},')
                elif isinstance(val, list):
                    parts.append(f'    {key}: {json.dumps(val)},')
                else:
                    parts.append(f'    {key}: {js_str(val)},')
        parts.append('  },')
        lines.append('\n'.join(parts))
    lines.append('};')
    return '\n'.join(lines)


def validate_deck_alignment(deck_id, counts, cards):
    """Raise if a starter deck mixes Face and Heel aligned cards."""
    seen = set()
    for cid, cnt in counts.items():
        if cnt <= 0:
            continue
        alignment = cards.get(cid, {}).get('alignment')
        if alignment:
            seen.add(alignment)
    if 'face' in seen and 'heel' in seen:
        raise ValueError(f'{deck_id}: deck mixes Face and Heel cards')


def emit_decks(cards, deck_defs):
    lines = [
        'window.RawDeal = window.RawDeal || {};',
        '',
        'function buildDeck(counts) {',
        '  const arsenal = [];',
        '  let i = 0;',
        '  for (const [id, count] of Object.entries(counts)) {',
        '    const base = window.RawDeal.CARDS[id];',
        '    if (!base) { console.warn("Missing card:", id); continue; }',
        '    for (let c = 0; c < count; c++) {',
        '      arsenal.push({ ...base, instanceId: `${id}-${i++}` });',
        '    }',
        '  }',
        '  return arsenal;',
        '}',
        '',
        'window.RawDeal.DECKS = {',
    ]

    for deck_id, deck in deck_defs.items():
        counts = deck['cards']
        total = sum(counts.values())
        if total != 60:
            raise ValueError(f'{deck_id} has {total} cards, expected 60')
        validate_deck_alignment(deck_id, counts, cards)
        for cid, cnt in counts.items():
            if cnt > 3:
                raise ValueError(f'{deck_id}: {cid} has {cnt} copies (max 3)')
            if cid not in cards:
                raise ValueError(f'{deck_id}: unknown card {cid}')
            if cards[cid].get('unique') and cnt > 1:
                raise ValueError(f'{deck_id}: unique card {cid} has {cnt} copies')

        counts_js = ',\n      '.join(f"'{k}': {v}" for k, v in sorted(counts.items()))
        lines.append(f"  {deck_id}: {{")
        lines.append(f"    id: '{deck_id}',")
        lines.append(f"    name: {js_str(deck['name'])},")
        lines.append(f"    superstarId: '{deck['superstarId']}',")
        lines.append(f"    defaultOpponent: '{deck['opponent']}',")
        lines.append(f"    arsenal: buildDeck({{")
        lines.append(f"      {counts_js},")
        lines.append(f"    }}),")
        lines.append(f"  }},")

    lines.append('};')
    lines.append('')
    lines.append('window.RawDeal.OPPONENT_MAP = {')
    for deck_id, deck in deck_defs.items():
        lines.append(f"  {deck_id}: '{deck['opponent']}',")
    lines.append('};')
    return '\n'.join(lines)


def main():
    text = PREMIERE_TXT.read_text(encoding='utf-8', errors='replace')
    cards = parse_cards(text)

    # Manual superstar name cleanup
    rename = {
        'the-rock': 'The Rock',
        'stone-cold': '"Stone Cold" Steve Austin',
        'undertaker': 'The Undertaker',
        'mankind': 'Mankind',
        'hhh': 'Triple H',
        'kane': 'Kane',
        'jericho': 'Chris Jericho',
    }
    # drop duplicate superstar slugs if parser created extras
    for dup in ['stone-cold-steve-austin', 'the-undertaker', 'chris-jericho']:
        cards.pop(dup, None)
    for cid, display in rename.items():
        if cid in cards:
            cards[cid]['name'] = display

    cards_out = ROOT / 'public/js/games/rawdeal/data/cards.js'
    decks_out = ROOT / 'public/js/games/rawdeal/data/decks.js'

    # validate decks before emit
    for deck_id, deck in DECK_DEFS.items():
        total = sum(deck['cards'].values())
        print(f'{deck_id}: {total} cards')

    cards_out.write_text(emit_cards(cards), encoding='utf-8')
    decks_out.write_text(emit_decks(cards, DECK_DEFS), encoding='utf-8')
    catalog_out = ROOT / 'data/rawdeal-card-catalog.json'
    catalog = {}
    for cid, card in cards.items():
        entry = {'unique': bool(card.get('unique'))}
        if card.get('alignment'):
            entry['alignment'] = card['alignment']
        catalog[cid] = entry
    catalog_out.write_text(json.dumps(catalog, indent=2), encoding='utf-8')
    print(f'Wrote {len(cards)} cards -> {cards_out}')
    print(f'Wrote {len(DECK_DEFS)} decks -> {decks_out}')
    print(f'Wrote card catalog -> {catalog_out}')


if __name__ == '__main__':
    main()