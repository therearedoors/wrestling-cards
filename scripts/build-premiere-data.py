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
            'chop': 3, 'punch': 3, 'head-butt': 3,
            'arm-drag': 3, 'hip-toss': 3, 'samoan-drop': 3,
            'russian-leg-sweep': 3, 'snap-mare': 2, 'spinning-heel-kick': 2,
            'superkick': 2, 'roundhouse-punch': 3, 'gut-buster': 2,
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
            'punch': 3, 'roundhouse-punch': 3, 'clothesline': 2,
            'spinebuster-equivalent': 0,  # placeholder remove
            'atomic-drop': 3, 'belly-to-belly-suplex': 2,
            'pump-handle-slam': 1, 'body-slam': 2,
            'ddt': 2, 'irish-whip': 3, 'jockeying-for-position': 2,
            'whaddya-got': 3, 'diversion': 1, 'stagger': 2,
            'step-aside': 3, 'knee-to-the-gut': 3, 'escape-move': 2,
            'view-of-villainy': 2, 'spit-at-opponent': 2,
            'distract-the-ref': 2, 'gut-buster': 3,
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

        sv = fort = dmg = None
        if m := re.search(r'SV:\s*(\d+)', stats):
            sv = int(m.group(1))
        if m := re.search(r'F:\s*(\d+)', stats):
            fort = int(m.group(1))
        if m := re.search(r'D:\s*(\d+)', stats):
            dmg = int(m.group(1))

        types_blob = ' / '.join(type_lines)
        rules = ' '.join(rules_lines)
        if rules and not rules.endswith('.'):
            rules = rules  # keep as-is

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

        entry = {
            'id': card_id,
            'num': num,
            'name': name,
            'types': types_list,
            'fortitude': fort if fort is not None else 0,
            'damage': dmg or 0,
            'text': build_text(types_blob, rules),
            'flavor': flavor.strip('"'),
            'set': 'premiere',
        }
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

        # goldfish effect hints
        effect = infer_effect(types_list, rules, name)
        if effect:
            entry.update(effect)
        action_effect = infer_action_effect(rules)
        if action_effect:
            entry.update(action_effect)

        cards[card_id] = entry

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


def infer_action_effect(rules):
    blob = rules.lower()
    if 'as an action' in blob and 'discard this card to draw 1' in blob:
        return {'actionEffect': 'discardToDraw', 'actionEffectValue': 1}
    return None


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


def build_text(types_blob, rules):
    parts = []
    if types_blob:
        parts.append(types_blob.strip())
    if rules:
        parts.append(rules.strip())
    return ' '.join(parts)


def infer_effect(types_list, rules, name):
    blob = rules.lower()
    if 'take the top card of your arsenal and put it into your ringside pile' in blob:
        effect = {'effect': 'topArsenalToRingside'}
        if 'you may draw 1' in blob:
            effect['alsoDraw'] = 1
        return effect
    if 'action' in types_list:
        if 'draw 2' in blob or 'draw up to 2' in blob:
            return {'effect': 'draw', 'effectValue': 2}
        if 'draw 1' in blob or 'draw a card' in blob:
            return {'effect': 'draw', 'effectValue': 1}
        if 'draw up to 5' in blob:
            return {'effect': 'draw', 'effectValue': 5}
        if 'next maneuver' in blob and '+6d' in blob:
            return {'effect': 'nextManeuverBonus', 'effectValue': 6}
        if 'next maneuver' in blob and '+3d' in blob:
            return {'effect': 'nextManeuverBonus', 'effectValue': 3}
        if 'next maneuver' in blob and '+2d' in blob:
            return {'effect': 'nextManeuverBonus', 'effectValue': 2}
        if 'all your maneuvers are +3d' in blob:
            return {'effect': 'turnManeuverBonus', 'effectValue': 3}
    if 'open up a can' in name.lower():
        return {'effect': 'nextManeuverBonus', 'effectValue': 5}
    if 'smackdown hotel' in name.lower():
        return {'effect': 'smackdownHotel'}
    if 'i am the game' in name.lower():
        return {'effect': 'iAmTheGame'}
    return None


def js_str(s):
    return json.dumps(s, ensure_ascii=False)


def emit_cards(cards):
    lines = ['window.RawDeal = window.RawDeal || {};', '', 'window.RawDeal.CARDS = {']
    items = sorted(cards.values(), key=lambda c: c['num'])
    for i, card in enumerate(items):
        parts = [f"  '{card['id']}': {{"]
        for key in ['id', 'num', 'name', 'types', 'subtype', 'handSize', 'superstarValue',
                    'ability', 'fortitude', 'damage', 'stunValue', 'text', 'flavor',
                    'unique', 'hybrid', 'reverses', 'effect', 'effectValue', 'actionEffect',
                    'actionEffectValue', 'alsoDraw', 'set']:
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
    print(f'Wrote {len(cards)} cards -> {cards_out}')
    print(f'Wrote {len(DECK_DEFS)} decks -> {decks_out}')


if __name__ == '__main__':
    main()