const lobby = document.getElementById('lobby');
const username = document.getElementById('username');
const totalUsers = document.getElementById('total-users');
const totalRooms = document.getElementById('total-rooms');

let user;

const fetchUserCallback = (data) => {
  user = data;
  socket.emit('user-connected', user);
  socket.emit('send-total-rooms-and-users');
  lobby.classList.remove('hidden');
  username.innerText = user.username;
  hideSpinner();
};

fetchData('/api/user-info', fetchUserCallback);

socket.on('receive-number-of-rooms-and-users', (totalR, totalU) => {
  totalRooms.innerText = `Total Rooms: ${totalR}`;
  totalUsers.innerText = `Total Users: ${totalU}`;
});