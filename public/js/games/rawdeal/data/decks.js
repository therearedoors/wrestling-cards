window.RawDeal = window.RawDeal || {};

function buildDeck(cardIds) {
  return cardIds.map((id, index) => ({
    ...window.RawDeal.CARDS[id],
    instanceId: `${id}-${index}`,
  }));
}

function repeatCards(id, count) {
  return Array(count).fill(id);
}

window.RawDeal.DECKS = {
  rock: {
    id: 'rock',
    name: 'The Rock',
    superstarId: 'the-rock',
    arsenal: buildDeck([
      ...repeatCards('shoulder-block', 6),
      ...repeatCards('side-buster', 4),
      ...repeatCards('samoan-drop', 4),
      ...repeatCards('corporate-elbow', 4),
      ...repeatCards('spinebuster', 4),
      ...repeatCards('floatover-ddt', 4),
      ...repeatCards('peoples-elbow', 3),
      ...repeatCards('rock-bottom', 2),
      ...repeatCards('know-your-role', 4),
      ...repeatCards('rock-poses', 4),
      ...repeatCards('peoples-champ', 2),
      ...repeatCards('block', 5),
      ...repeatCards('dodge', 5),
      ...repeatCards('escape-move', 4),
      ...repeatCards('athletic-counter', 3),
      ...repeatCards('break-hold', 2),
    ]),
  },
  austin: {
    id: 'austin',
    name: '"Stone Cold" Steve Austin',
    superstarId: 'stone-cold',
    arsenal: buildDeck([
      ...repeatCards('clothesline', 6),
      ...repeatCards('atomic-drop', 5),
      ...repeatCards('mud-hole-stomp', 5),
      ...repeatCards('flying-forearm', 4),
      ...repeatCards('lou-thesz-press', 4),
      ...repeatCards('bulldog', 4),
      ...repeatCards('stone-cold-stunner', 2),
      ...repeatCards('austin-316', 4),
      ...repeatCards('middle-finger', 4),
      ...repeatCards('beer-bash', 2),
      ...repeatCards('block', 5),
      ...repeatCards('dodge', 5),
      ...repeatCards('escape-move', 4),
      ...repeatCards('athletic-counter', 3),
      ...repeatCards('break-hold', 3),
    ]),
  },
};