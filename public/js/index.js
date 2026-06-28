const socket = io()

const fetchData = (url, callback) => {
    fetch(url)
        .then(res => {
            if (!res.ok) {
                throw Error("something went wrong");
        }
        return res.json();
    }).then(callback)
    .catch(err => {
        console.log(err.message);
    })
}

socket.on('error', (message) => {
    window.location.href = `/games?error=${encodeURIComponent(message)}`;
});