(function () {
  const gamesEl = document.getElementById('rd-games');
  const gamesList = document.getElementById('rd-games-list');
  const noGamesMsg = document.getElementById('rd-no-games-message');

  const createBtn = document.getElementById('rd-create-room');
  const joinRandomBtn = document.getElementById('rd-join-random');

  const createFormContainer = document.getElementById('rd-create-form-container');
  const createForm = document.getElementById('rd-create-form');
  const roomIdInput = document.getElementById('rd-room-id');
  const createDeckSelect = document.getElementById('rd-create-deck');
  const addPassword = document.getElementById('rd-add-password');
  const roomPassword = document.getElementById('rd-room-password');

  const joinFormContainer = document.getElementById('rd-join-form-container');
  const joinForm = document.getElementById('rd-join-form');
  const joinDeckSelect = document.getElementById('rd-join-deck');
  const joinPasswordGroup = document.getElementById('rd-join-password-group');
  const joinPasswordInput = document.getElementById('rd-join-password');

  const randomFormContainer = document.getElementById('rd-random-form-container');
  const randomForm = document.getElementById('rd-random-form');
  const randomDeckSelect = document.getElementById('rd-random-deck');

  let user;
  let pendingJoinId = null;
  let pendingJoinPassword = false;

  const devQs = new URLSearchParams(window.location.search).get('dev') === '1' ? '&dev=1' : '';

  const DECK_NAMES = {
    rock: 'The Rock',
    austin: 'Stone Cold',
    undertaker: 'Undertaker',
    mankind: 'Mankind',
    hhh: 'Triple H',
    kane: 'Kane',
    jericho: 'Jericho',
  };

  function hideSpinner() {
    const spinner = document.getElementById('spinner');
    if (spinner) spinner.classList.add('hidden');
  }

  function displayRooms(rooms) {
    gamesList.innerHTML = '';
    if (!rooms.length) {
      gamesList.classList.add('hidden');
      noGamesMsg.classList.remove('hidden');
      return;
    }

    noGamesMsg.classList.add('hidden');
    gamesList.classList.remove('hidden');

    for (const room of rooms) {
      const li = document.createElement('li');
      li.className = 'rd-games-list__item';
      li.dataset.roomId = room.id;
      li.dataset.hasPassword = room.hasPassword ? '1' : '0';

      const deckLabel = DECK_NAMES[room.hostDeckId] || room.hostDeckId;
      li.innerHTML = `
        <div class="rd-games-list__info">
          <strong>${room.id}</strong>
          <span>Host: ${room.hostUsername} · ${deckLabel}</span>
        </div>
        <span class="rd-games-list__count">${room.players} / 2</span>
        <button type="button" class="rd-btn rd-btn--secondary" ${room.players >= 2 ? 'disabled' : ''}>Join</button>
      `;

      const btn = li.querySelector('button');
      if (room.players < 2) {
        btn.addEventListener('click', () => {
          pendingJoinId = room.id;
          pendingJoinPassword = room.hasPassword;
          joinPasswordGroup.classList.toggle('hidden', !room.hasPassword);
          joinFormContainer.classList.remove('hidden');
        });
      }

      gamesList.appendChild(li);
    }
  }

  fetch('/api/user-info', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((data) => {
      user = data;
      socket.emit('rd-get-rooms');
      gamesEl.classList.remove('hidden');
      hideSpinner();
    })
    .catch(() => hideSpinner());

  socket.on('rd-receive-rooms', displayRooms);

  socket.on('rd-room-created', () => {
    const id = roomIdInput.value.trim();
    const password = addPassword.checked ? roomPassword.value : '';
    const qs = password ? `&password=${encodeURIComponent(password)}` : '';
    window.location.href = `/rawdeal/room?id=${encodeURIComponent(id)}${qs}${devQs}`;
  });

  socket.on('rd-room-joined', (roomId, password) => {
    const qs = password ? `&password=${encodeURIComponent(password)}` : '';
    window.location.href = `/rawdeal/room?id=${encodeURIComponent(roomId)}${qs}${devQs}`;
  });

  socket.on('rd-error', (msg) => {
    alert(msg);
  });

  createBtn?.addEventListener('click', () => createFormContainer.classList.remove('hidden'));
  joinRandomBtn?.addEventListener('click', () => randomFormContainer.classList.remove('hidden'));

  document.getElementById('rd-close-create')?.addEventListener('click', () => {
    createFormContainer.classList.add('hidden');
  });
  document.getElementById('rd-close-join')?.addEventListener('click', () => {
    joinFormContainer.classList.add('hidden');
    pendingJoinId = null;
  });
  document.getElementById('rd-close-random')?.addEventListener('click', () => {
    randomFormContainer.classList.add('hidden');
  });

  addPassword?.addEventListener('change', () => {
    roomPassword.disabled = !addPassword.checked;
  });

  createForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = roomIdInput.value.trim();
    const deckId = createDeckSelect.value;
    if (addPassword.checked && roomPassword.value) {
      socket.emit('rd-create-room', id, user, deckId, roomPassword.value);
    } else {
      socket.emit('rd-create-room', id, user, deckId);
    }
    createFormContainer.classList.add('hidden');
  });

  joinForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!pendingJoinId) return;
    const deckId = joinDeckSelect.value;
    if (pendingJoinPassword) {
      socket.emit('rd-join-room', pendingJoinId, user, deckId, joinPasswordInput.value);
    } else {
      socket.emit('rd-join-room', pendingJoinId, user, deckId);
    }
    joinFormContainer.classList.add('hidden');
  });

  randomForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    socket.emit('rd-join-random', user, randomDeckSelect.value);
    randomFormContainer.classList.add('hidden');
  });
})();