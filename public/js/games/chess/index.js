// =====================
// DOM Elements
// =====================
const room = document.getElementById("game-room")
const boxes = document.querySelectorAll(".box")
const playerLight = document.getElementById("player-light")
const playerBlack = document.getElementById("player-black")
const waitingMessage = document.getElementById("waiting-message")
const playerLightTimer = playerLight.querySelector(".timer")
const playerBlackTimer = playerBlack.querySelector(".timer")
const lightCapturedPieces = document.getElementById("light-captured-pieces")
const blackCapturedPieces = document.getElementById("black-captured-pieces")
const piecesToPromoteContainer = document.getElementById("pieces-to-promote-container")
const piecesToPromote = document.getElementById("pieces-to-promote")
const gameOverMessageContainer = document.getElementById("game-over-message-container")
const winnerUsername = gameOverMessageContainer.querySelector("p strong")
const myScoreElement = document.getElementById("my-score")
const enemyScoreElement = document.getElementById("enemy-score")

// Game Variables

let user = null;

let search = window.location.search.split('&');

let roomId = null
let password = null;

let gameDetails = null;

let gameHasTimer = false;
let timer = null;
let myTurn = false;
let kingIsAttacked = false;
let pawnToPromotePosition = null;
let castling = null;
let gameOver = false;
let myScore = 0;
let enemyScore = 0;

let gameStartedAtTimestamp = null;

// Total material value per side (used for end-game scoring %).
// Values come from the piece data: pawns=5, rooks=5, knights=3, bishops=3, queen=9, king=10.
const totalPiecesPoints = 81;

if (search.length > 1) {
    roomId = search[0].split('=')[1];
    password = search[1].split('=')[1];
} else {
    roomId = search[0].split('=')[1];
}

// Functions

const fetchUserCallback = (data) => {
    user = data;

    if (password) {
        socket.emit('user-connected', user, roomId, password);
    } else {
        socket.emit('user-connected', user, roomId);
    }
    socket.emit('get-game-details', roomId, user);
}

fetchData('/api/user-info', fetchUserCallback);

// Display chess board logic
const displayChessPieces = () => {
    boxes.forEach(box => {
        box.innerHTML = ""
    })

    lightPieces.forEach(piece => {
        let box = document.getElementById(piece.position)

        box.innerHTML += `
            <div class="piece light" data-piece="${piece.piece}" data-points="${piece.points}">
                <img src="${piece.icon}" alt="Chess Piece" >
            </div>
        `
    })

    blackPieces.forEach(piece => {
        let box = document.getElementById(piece.position)

        box.innerHTML += `
            <div class="piece black" data-piece="${piece.piece}" data-points="${piece.points}">
                <img src="${piece.icon}" alt="Chess Piece ${piece.piece}" >
            </div>
        `
    })

    addPieceListeners()
}

const onClickPiece = (e) => {
    if(!myTurn || gameOver){
        return;
    }

    hidePossibleMoves()

    let element = e.target.closest(".piece");
    let position = element.parentNode.id;
    let piece = element.dataset.piece;

    if(selectedPiece && selectedPiece.piece === piece && selectedPiece.position === position){
        hidePossibleMoves()
        selectedPiece = null
        return;
    }

    selectedPiece = {position, piece}

    let possibleMoves = findPossibleMoves(position, piece);

    showPossibleMoves(possibleMoves)
}


const addPieceListeners = () => {
    document.querySelectorAll(`.piece.${player}`).forEach(piece => {
        piece.addEventListener("click", onClickPiece)
    })

    document.querySelectorAll(`.piece.${enemy}`).forEach(piece => {
        piece.style.cursor = "default"
    })
}

// --------------------------------------

// Possible Moves Logic

const showPossibleMoves = (possibleMoves) => {
    possibleMoves.forEach(box => {
        let possibleMoveBox = document.createElement('div')
        possibleMoveBox.classList.add("possible-move");

        possibleMoveBox.addEventListener("click", move)

        box.appendChild(possibleMoveBox)
    })
}

const hidePossibleMoves = () => {
    document.querySelectorAll('.possible-move').forEach(possibleMoveBox => {
        let parent = possibleMoveBox.parentNode;
        possibleMoveBox.removeEventListener('click', move)
        parent.removeChild(possibleMoveBox)
    })
}


const findPossibleMoves = (position, piece) => {
    let splitPos = position.split("-");
    let yAxisPos = +splitPos[1]
    let xAxisPos = splitPos[0]

    let yAxisIndex = yAxis.findIndex(y => y === yAxisPos)
    let xAxisIndex = xAxis.findIndex(x => x === xAxisPos)

    switch(piece){
        case "pawn":
            return getPawnPossibleMoves(xAxisPos, yAxisPos, xAxisIndex, yAxisIndex);
        case 'rook':
            return getRookPossibleMoves(xAxisPos, yAxisPos, xAxisIndex, yAxisIndex);
        case 'bishop':
            return getBishopPossibleMoves(xAxisIndex, yAxisIndex)
        case 'knight':
            return getKnightPossibleMoves(xAxisIndex, yAxisIndex)
        case 'queen':
            return Array.prototype.concat(
                getRookPossibleMoves(xAxisPos, yAxisPos, xAxisIndex, yAxisIndex),
                getBishopPossibleMoves(xAxisIndex, yAxisIndex)
            )
        case 'king':
            return getKingPossibleMoves(xAxisPos, yAxisPos, xAxisIndex, yAxisIndex)
        default:
            return []
    }
}

// --------------------------------------
// TIMER LOGIC
const updateTimer = (currentPlayer, minutes, seconds) => {
    if(currentPlayer === 'light'){
        playerLightTimer.innerText = 
            `${minutes >= 10 ? minutes : "0" + minutes}:${seconds >= 10 ? seconds : "0" + seconds}`
    }else{
        playerBlackTimer.innerText = 
            `${minutes >= 10 ? minutes : "0" + minutes}:${seconds >= 10 ? seconds : "0" + seconds}` 
    }
}

const timerEndedCallback = () => {
    // Local player ran out of time → they lose. End immediately for this client.
    const enemyUsernameEl = (player === 'light' ? playerBlack : playerLight).querySelector('.username');
    const winner = enemyUsernameEl ? enemyUsernameEl.innerText : 'Opponent';
    endGame(winner, false);
    socket.emit('timer-ended', roomId, user.username, gameStartedAtTimestamp);
}
// --------------------------------------

// Game Logic
const setCursor = (cursor) => {
    document.querySelectorAll(`.piece.${player}`).forEach(piece => {
        piece.style.cursor = cursor;
    })
}

const startGame = (playerTwo) => {
    playerBlack.querySelector(".username").innerText = playerTwo.username;

    waitingMessage.classList.add("hidden")
    playerBlack.classList.remove("hidden")

    displayChessPieces()

    setPiecesToPromote();

    showOfferDrawButton();
}

const setKingIsAttacked = (isAttacked) => {
    kingIsAttacked = isAttacked;

    let myKing = document.getElementById(getKingPosition(player)).children[0];

    if(isAttacked){
        myKing.classList.add('warning-block');
        displayToast("Your king is under attack");
    }else{
        myKing.classList.remove('warning-block');
    }
}

const endMyTurn = (newPieceBox, pawnPromoted = false, castlingPerformed = false, elPassantPerformed = false) => {
    if(kingIsAttacked){
        setKingIsAttacked(false);
    }

    myTurn = false;
    setCursor("default")

    saveMove(newPieceBox, pawnPromoted, castlingPerformed, elPassantPerformed);

    checkIfKingIsAttacked(enemy);
}

// --------------------------------------
// MOVE LOGIC
const move = (e) => {
    socket.emit("update-score", roomId, 10, -10)
    let currentBox = document.getElementById(selectedPiece.position);
    let boxToMove = e.target.parentNode;
    let piece = currentBox.querySelector(".piece");

    hidePossibleMoves();

    let pieceToRemove = null;
    let pieceToRemovePieceImg = null;

    if(boxToMove.children.length > 0){
        if(boxToMove.children[0].classList.contains(player)){
            performCastling(player, currentBox.id, boxToMove.id)
            return;
        }
        pieceToRemove = boxToMove.children[0];
        pieceToRemovePieceImg = pieceToRemove.children[0]
    } else {
        if(!isLeftCastlingPerformed || !isRightCastlingPerformed){
            if(piece.dataset.piece === 'rook'){
                let myKingPosition = getKingPosition(player);

                let pieceXAxisIndex = xAxis.findIndex(x => x === currentBox.id[0]);
                let myKingXAxisIndex = xAxis.findIndex(x => x === myKingPosition[0]);

                if(pieceXAxisIndex < myKingXAxisIndex){
                    isLeftCastlingPerformed = true;
                }else{
                    isRightCastlingPerformed = true;
                }
            }
        }
    }
    currentBox.innerHTML = "";

    if(pieceToRemove){
        capturePiece(pieceToRemove)
        boxToMove.innerHTML = ""
    }

    boxToMove.appendChild(piece)

    let boxesNeededForCheck = {
        currentBox, boxToMove
    }

    let piecesNeededForCheck = {
        piece, pieceToRemove, pieceToRemovePieceImg
    }

    let isMovePossible = canMakeMove(boxesNeededForCheck, piecesNeededForCheck);

    if(!isMovePossible){
        return;
    }

    if(piece.dataset.piece === 'pawn'){
        // Pawn promotion check
        if(
            (player === 'light' && boxToMove.id[2] === '1') ||
            (player === 'black' && boxToMove.id[2] === '8')
        ){
            let canBePromoted = isPawnAtTheEndOfTheBoard(player, boxToMove.id);

            if(canBePromoted){
                pawnToPromotePosition = boxToMove.id;

                piecesToPromoteContainer.classList.remove('hidden');

                return;
            }
        }
    }

        if(elPassantPositions[boxToMove.id]){
            performElPassant(player, currentBox.id, boxToMove.id)
            return
        }

        if (checkForDraw() || isStalemate()) {
            endGame(null, true);
            socket.emit("game-draw", roomId);
            return;
        }

    endMyTurn(boxToMove)
}

const canMakeMove = ({currentBox, boxToMove}, {piece, pieceToRemove, pieceToRemovePieceImg}) => {
    let moveIsNotValid = checkIfKingIsAttacked(player);

    if(moveIsNotValid){
        selectedPiece = null;

        if(pieceToRemove){
            pieceToRemove.appendChild(pieceToRemovePieceImg)

            boxToMove.removeChild(piece);
            boxToMove.appendChild(pieceToRemove);

            if(pieceToRemove.classList.contains("black")){
                blackCapturedPieces.removeChild(blackCapturedPieces.lastChild)
            }else{
                lightCapturedPieces.removeChild(lightCapturedPieces.lastChild)
            }
        }

        currentBox.appendChild(piece);

        displayToast("You can't make this move. Your king is under attack")

        return false
        }

    return true
}

const capturePiece = (pieceToRemove) => {
    let pawnImg = pieceToRemove.children[0];

    let li = document.createElement('li')
    li.appendChild(pawnImg);

    if(pieceToRemove.classList.contains('black')){
        blackCapturedPieces.appendChild(li);

        if(!gameOver){
            if(player === 'light'){
                myScore += parseInt(pieceToRemove.dataset.points)
            }else{
                enemyScore += parseInt(pieceToRemove.dataset.points)
            }
        }
    }else{
        lightCapturedPieces.appendChild(li);

        if(!gameOver){
            if(player === 'black'){
                myScore += parseInt(pieceToRemove.dataset.points)
            }else{
                enemyScore += parseInt(pieceToRemove.dataset.points)
            }
        }
    }
}


const checkIfKingIsAttacked = (playerToCheck) => {
    let kingPosition = getKingPosition(playerToCheck);

    let check = isCheck(kingPosition, playerToCheck === player);

    if(check){
        if(player !== playerToCheck){
            if(isCheckmate(kingPosition)){
                socket.emit('checkmate', roomId, user.username, myScore, gameStartedAtTimestamp)
                endGame(user.username, false)
            }else{
                socket.emit('check', roomId);
            }
        } 
        
        return true;
    }

    return false;
}

const saveMove = (newPieceBox, pawnPromoted, castlingPerformed, elPassantPerformed) => {
    let move = {from: selectedPiece.position, to: newPieceBox.id, piece: selectedPiece.piece, pieceColor: player}
    selectedPiece = null
    pawnToPromotePosition = null;
    if(gameHasTimer){
        let currentTime;

        if(player === 'light'){
            currentTime = playerLightTimer.innerText
        }else{
            currentTime = playerBlackTimer.innerText
        }

        move.time = currentTime

        timer.stop()
    }

    if(pawnPromoted){
        let promotedPiece = newPieceBox.children[0];

        let pawnPromotion = {
            promotedTo: promotedPiece.dataset.piece,
            pieceImg: promotedPiece.children[0].src
        }

        socket.emit('move-made', roomId, move, pawnPromotion)
    }else if(castlingPerformed){
        socket.emit('move-made', roomId, move, null, castling)
    }else if(elPassantPerformed){
        socket.emit('move-made', roomId, move, null, null, true)
    }else{
        socket.emit('move-made', roomId, move)
    }
}

const moveEnemy = (move, pawnPromotion = null, elPassantPerformed = false) => {
    pawnsToPerformElPassant = {}
    elPassantPositions = {}

    const {from , to, piece} = move;

    let boxMovedFrom = document.getElementById(from);
    let boxMovedTo = document.getElementById(to);

    if(boxMovedTo.children.length > 0){
        let pieceToRemove = boxMovedTo.children[0];

        capturePiece(pieceToRemove)
    }

    boxMovedTo.innerHTML = "";

    let enemyPiece = boxMovedFrom.children[0];

    if(pawnPromotion){
        const {promotedTo, pieceImg} = pawnPromotion

        enemyPiece.dataset.piece = promotedTo;
        enemyPiece.children[0].src = pieceImg
    }

    boxMovedFrom.innerHTML = ""
    boxMovedTo.appendChild(enemyPiece);

    if(elPassantPerformed){
        let capturedPieceBox = null
        if(player === 'light'){
            capturedPieceBox = document.getElementById(`${to[0]}-${parseInt(to[2]) - 1}`)
        }else{
            capturedPieceBox = document.getElementById(`${to[0]}-${parseInt(to[2]) + 1}`)
        }

        capturePiece(capturedPieceBox.children[0])

        capturedPieceBox.innerHTML = ""
    }

    if(piece === 'pawn'){
        let canPerformElPassant = checkForElPassant(move)

        if(canPerformElPassant){
            pawnsToPerformElPassant[to] = true
        }
    }

    myTurn = true;
    setCursor('pointer')

    // After opponent moved, check if the position is now a draw (their move may have
    // caused K vs K, insufficient material, or left us with no moves = stalemate).
    if (!gameOver && (checkForDraw() || isStalemate())) {
        endGame(null, true);
        socket.emit("game-draw", roomId);
        return;
    }

    console.log("Game has timer:", gameHasTimer, "Player:", player, "Room ID:", roomId)
    if(gameHasTimer){
        console.log("Starting timer for player:", player)
        timer.start()
    }
}

// --------------------------------------

// Castling Logic
const performCastling = (currentPlayer, rookPosition, kingPosition) => {
    let rookBox = document.getElementById(rookPosition)
    let kingBox = document.getElementById(kingPosition)

    let rook = rookBox.children[0]
    let king = kingBox.children[0]

    let newRookPosition = rookPosition;
    let newKingPosition = kingPosition;

    if(rookPosition[0] === 'A'){
        newRookPosition = 'D' + rookPosition.substr(1);
        newKingPosition = 'C' + kingPosition.substr(1)
    }else{
        newRookPosition = 'F' + rookPosition.substr(1);
        newKingPosition = 'G' + kingPosition.substr(1)
    }

    rookBox.innerHTML = ""
    kingBox.innerHTML = ""

    let newRookBox = document.getElementById(newRookPosition)
    let newKingBox = document.getElementById(newKingPosition)

    newRookBox.appendChild(rook)
    newKingBox.appendChild(king)
     if(currentPlayer === player){
        let check = isCheck(newKingPosition);

        if(check){
            newRookBox.innerHTML = ""
            newKingBox.innerHTML = ""

            rookBox.appendChild(rook)
            kingBox.appendChild(king)

            displayToast("Your king is under attack")
        }else{
            if(rookPosition[0] === 'A'){
                isLeftCastlingPerformed = true;
            }else{
                isRightCastlingPerformed = true
            }

            castling = {
                rookPosition,
                kingPosition
            }

            endMyTurn(document.getElementById(kingPosition), false, true)

            // Rare: castling resulting in draw (e.g. last pieces traded earlier)
            if (!gameOver && (checkForDraw() || isStalemate())) {
                endGame(null, true);
                socket.emit("game-draw", roomId);
            }
        }
            }else{
        castling = null;

        myTurn = true;
        setCursor('pointer');

        if (!gameOver && (checkForDraw() || isStalemate())) {
            endGame(null, true);
            socket.emit("game-draw", roomId);
            return;
        }

        if(gameHasTimer){
            timer.start()
        }
    }
}
// --------------------------------------

// Pawn Promotion Logic
const setPiecesToPromote = () => {
    console.log("Setting pieces to promote for player:", player)
    if(player === 'light'){
        lightPieces.forEach(piece => {
            if(piece.piece !== 'pawn' && piece.piece !== 'king'){
                const li = document.createElement("li");
                li.setAttribute("data-piece", piece.piece);

                const img = document.createElement("img");
                img.src = piece.icon;

                li.appendChild(img);
                piecesToPromote.appendChild(li);
            }
        })
    }else{
        blackPieces.forEach(piece => {
            if(piece.piece !== 'pawn' && piece.piece !== 'king'){
                const li = document.createElement("li");
                li.setAttribute("data-piece", piece.piece);

                const img = document.createElement("img");
                img.src = piece.icon;

                li.appendChild(img);
                piecesToPromote.appendChild(li);
            }
        })
    }

    addListenerToPiecesToPromote();
}

const onChoosePieceToPromote = e => {
    if(!pawnToPromotePosition){
        return;
    }

    const pieceToPromote = e.target.closest("li");
    const pieceToPromoteImg = pieceToPromote.children[0];
    const pieceToPromoteType = pieceToPromote.dataset.piece;

    let pieceToChange = document.getElementById(pawnToPromotePosition).children[0];

    pieceToChange.innerHTML = ""
    pieceToChange.appendChild(pieceToPromoteImg)
    pieceToChange.dataset.piece = pieceToPromoteType;

    piecesToPromoteContainer.classList.add('hidden');

    endMyTurn(document.getElementById(pawnToPromotePosition), true);
}

const addListenerToPiecesToPromote = () => {
    for(let i = 0; i < piecesToPromote.children.length; i++){
        piecesToPromote.children[i].addEventListener("click", onChoosePieceToPromote)
    }
}
// --------------------------------------

// El Passant Logic
const checkForElPassant = (enemyMove) => {
    const {from, to, piece} = enemyMove;

    if(piece !== 'pawn' || (from[2] !== '7' && from[2] !== '2')){
        return false
    }

    let enemyPawn = null

    if(player === 'light'){
        enemyPawn = blackPieces.find(enemyPiece => enemyPiece.piece === 'pawn' && enemyPiece.position === from)
    }else{
        enemyPawn = lightPieces.find(enemyPiece => enemyPiece.piece === 'pawn' && enemyPiece.position === from)
    }

    if(!enemyPawn){
        return false
    }
    if(Math.abs(parseInt(to[2]) - parseInt(from[2])) === 2){
        let splittedPos = to.split("-");
        let xAxisPos = splittedPos[0]
        let yAxisPos = +splittedPos[1]

        let xAxisIndex = xAxis.findIndex(x => x === xAxisPos)

        if(xAxisIndex - 1 >= 0){
            let leftBox = document.getElementById(`${xAxis[xAxisIndex - 1]}-${yAxisPos}`)

            if(
                leftBox.children.length > 0 &&
                leftBox.children[0].classList.contains(player) &&
                leftBox.children[0].dataset.piece === 'pawn'
            ){
                return true
            }
        }

        if(xAxisIndex + 1 < xAxis.length){
            let rightBox = document.getElementById(`${xAxis[xAxisIndex + 1]}-${yAxisPos}`)

            if(
                rightBox.children.length > 0 &&
                rightBox.children[0].classList.contains(player) &&
                rightBox.children[0].dataset.piece === 'pawn'
            ){
                return true
            }
        }
    }

    return false
}

const performElPassant = (currentPlayer, prevPawnPosition, newPawnPosition) => {
    let capturedPawnPos = newPawnPosition[0] + '-' + prevPawnPosition[2]
    let capturedPawnBox = document.getElementById(capturedPawnPos)

    capturePiece(capturedPawnBox.children[0])

    if(currentPlayer === player){
        endMyTurn(document.getElementById(newPawnPosition), false, false, true)

        delete pawnsToPerformElPassant[capturedPawnPos]
        delete elPassantPositions[newPawnPosition]
    }else{
        myTurn = true
        setCursor('pointer')

        if(gameHasTimer){
            timer.start()
        }
    }
}
// --------------------------------------
// Draw Logic
const checkForDraw = () => {
    const myPieces = document.querySelectorAll(`.piece.${player}`);
    const enemyPieces = document.querySelectorAll(`.piece.${enemy}`);

    const myTotal = myPieces.length;
    const enemyTotal = enemyPieces.length;

    // 1. King vs King (bare kings)
    if (myTotal === 1 && enemyTotal === 1) {
        return true;
    }

    // 2. Insufficient material - no pawns/rooks/queens on either side
    const myTypes = Array.from(myPieces).map(p => p.dataset.piece);
    const enemyTypes = Array.from(enemyPieces).map(p => p.dataset.piece);

    const hasMajorOrPawn = (types) => types.some(t => t === 'pawn' || t === 'rook' || t === 'queen');

    if (!hasMajorOrPawn(myTypes) && !hasMajorOrPawn(enemyTypes)) {
        return true;
    }

    return false;
}

// Quick stalemate check (called on our turn). A full legal-move generator
// would simulate every pseudo-move and test !isCheck(ourKing). This version
// is a pragmatic start for the project: if we literally have zero pseudo moves
// listed and are not under attack, treat as stalemate.
const isStalemate = () => {
    if (kingIsAttacked) return false;

    const myPiecesEls = document.querySelectorAll(`.piece.${player}`);
    for (let i = 0; i < myPiecesEls.length; i++) {
        const el = myPiecesEls[i];
        const pos = el.parentNode.id;
        const pieceType = el.dataset.piece;

        let possible = [];
        try {
            if (typeof findPossibleMoves === 'function') {
                possible = findPossibleMoves(pos, pieceType) || [];
            }
        } catch (_) {}

        if (possible.length > 0) {
            return false;
        }
    }
    return true;
}
// --------------------------------------
// Game Over Logic
const endGame = (winner=null, isDraw = false) => {
    gameOver = true
    myTurn = false
    setCursor("default")

    if(gameHasTimer){
        timer.stop()
    }

    const messageP = gameOverMessageContainer.querySelector('p');

    if (isDraw || !winner) {
        messageP.innerHTML = 'The game ended in a <strong>draw</strong>.';
        // Clear any previous score classes for cleanliness on draw
        myScoreElement.classList.remove("positive-score");
        enemyScoreElement.classList.remove("positive-score");
    } else if (winner) {
        messageP.innerHTML = '<strong></strong> won!';  // restore normal template
        winnerUsername.innerText = winner;

        let winningPoints = 0;

        if(winner === user.username){
            winningPoints = ~~((myScore / totalPiecesPoints) * 100)
            myScoreElement.innerText = winningPoints
            enemyScoreElement.innerText = -winningPoints
            myScoreElement.classList.add("positive-score")
            socket.emit("update-score", roomId, winningPoints, -winningPoints)
        }else{
            winningPoints = ~~((enemyScore / totalPiecesPoints) * 100)
            myScoreElement.innerText = -winningPoints
            enemyScoreElement.innerText = +winningPoints
            enemyScoreElement.classList.add("positive-score")
        }
    }

    gameOverMessageContainer.classList.remove("hidden")
    hideOfferDrawButton();
    hideDrawOfferUI();
}
// --------------------------------------

// Socket Listeners

socket.on('receive-game-details', (details) => {
    gameDetails = details;
    let playerOne = gameDetails.players[0];

    gameHasTimer = gameDetails.time > 0;
    if (!gameHasTimer) {
        playerLightTimer.classList.add('hidden');
        playerBlackTimer.classList.add('hidden');
    } else {
        playerLightTimer.innerText = gameDetails.time + ":00";
        playerBlackTimer.innerText = gameDetails.time + ":00";
    }

    playerLight.querySelector(".username").innerText = playerOne.username;

    if (playerOne.username === user.username) {
        player = "light";
        enemy = "black";
        myTurn = true;
    } else {
        gameStartedAtTimestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
        player = "black";
        enemy = "light";
        myTurn = false;
        setCursor("default");
        startGame(user);
    }
    if (gameHasTimer) {
        timer = new Timer(player, roomId, gameDetails.time, 0, updateTimer, timerEndedCallback);
    }

    hideSpinner();
    room.classList.remove("hidden");
});

socket.on('game-started', (playerTwo) => {
    gameStartedAtTimestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    startGame(playerTwo);
    if (gameHasTimer) {
        timer = new Timer(player, roomId, gameDetails.time, 0, updateTimer, timerEndedCallback);
    }
});

socket.on("enemy-moved", (move) => {
    moveEnemy(move)
})


socket.on("enemy-moved_castling", (enemyCastling) => {
    const {rookPosition, kingPosition} = enemyCastling
    performCastling(enemy, rookPosition, kingPosition)
});

socket.on('enemy-moved_pawn-promotion', (move, pawnPromotion) => {
    moveEnemy(move, pawnPromotion)
})

socket.on('enemy-moved_el-passant', (move) => {
    moveEnemy(move, null, true)
})

socket.on("enemy-timer-updated", (minutes, seconds) => {
    updateTimer(enemy, minutes, seconds)
})

socket.on("king-is-attacked", () => {
    setKingIsAttacked(true);
})

// --------------------------------------------------
// Game termination listeners (both players now get notified)
// --------------------------------------------------
socket.on('checkmate', (winner) => {
    if (gameOver) return;
    endGame(winner, false);
});

socket.on('draw', () => {
    if (gameOver) return;
    endGame(null, true);
});

socket.on('game-draw', () => {
    if (gameOver) return;
    endGame(null, true);
});

socket.on('timer-ended', (timedOutUsername) => {
    if (gameOver) return;

    // The user who emitted is the one who ran out.
    // If it was us, we already ended locally in the callback.
    // If it was the opponent, *we* win.
    const myUsername = user && user.username;
    if (timedOutUsername && myUsername && timedOutUsername !== myUsername) {
        endGame(myUsername, false);
    } else if (!timedOutUsername) {
        // Fallback
        endGame(null, false);
    }
});

// --------------------------------------------------
// Draw offer / accept / decline flow (key WS learning piece)
// --------------------------------------------------
let drawOfferPending = false;

socket.on('draw-offered', () => {
    if (gameOver) return;
    showDrawOfferUI();
});

socket.on('draw-accepted', () => {
    if (gameOver) return;
    hideDrawOfferUI();
    endGame(null, true);
});

socket.on('draw-declined', () => {
    drawOfferPending = false;
    hideDrawOfferUI();

    const btn = document.getElementById('offer-draw-btn');
    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Offer Draw';
    }

    if (typeof displayToast === 'function') {
        displayToast("Draw offer declined");
    } else {
        console.log("Draw offer declined");
    }
});

// Helper to show the accept/decline prompt when opponent offers
function showDrawOfferUI() {
    let container = document.getElementById('draw-offer-container');
    if (!container) {
        // Create on the fly if the EJS hasn't been updated yet (fallback)
        container = document.createElement('div');
        container.id = 'draw-offer-container';
        container.className = 'fixed-element-container';
        container.innerHTML = `
            <div class="draw-offer">
                <p>Opponent offers a draw.</p>
                <div class="draw-actions">
                    <button id="accept-draw-btn">Accept</button>
                    <button id="decline-draw-btn">Decline</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);
    }
    container.classList.remove('hidden');

    // Wire buttons (idempotent)
    const acceptBtn = document.getElementById('accept-draw-btn');
    const declineBtn = document.getElementById('decline-draw-btn');

    if (acceptBtn) {
        acceptBtn.onclick = () => {
            socket.emit('accept-draw', roomId);
            container.classList.add('hidden');
            endGame(null, true);
        };
    }
    if (declineBtn) {
        declineBtn.onclick = () => {
            socket.emit('decline-draw', roomId);
            container.classList.add('hidden');
        };
    }
}

function hideDrawOfferUI() {
    const container = document.getElementById('draw-offer-container');
    if (container) container.classList.add('hidden');
}

function showOfferDrawButton() {
    const btn = document.getElementById('offer-draw-btn');
    if (!btn) return;

    btn.classList.remove('hidden');
    btn.disabled = false;
    drawOfferPending = false;

    btn.onclick = () => {
        if (gameOver || drawOfferPending) return;

        drawOfferPending = true;
        btn.disabled = true;
        btn.textContent = 'Draw offered...';

        socket.emit('offer-draw', roomId);

        // The offerer waits for accept/decline. We can timeout the pending state if wanted.
        // For now a simple toast after a delay is enough feedback.
        setTimeout(() => {
            if (drawOfferPending && !gameOver) {
                // still pending - opponent hasn't responded yet (or declined will clear it)
            }
        }, 1500);
    };
}

function hideOfferDrawButton() {
    const btn = document.getElementById('offer-draw-btn');
    if (btn) {
        btn.classList.add('hidden');
        btn.disabled = true;
        btn.onclick = null;
    }
}