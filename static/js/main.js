const urlParams = new URLSearchParams(window.location.search);
let roomId = urlParams.get('room');

if (!roomId) {
    roomId = Math.random().toString(36).substring(2, 8);
    window.location.search = `?room=${roomId}`;
}

const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}/ws/${roomId}`;
const ws = new WebSocket(wsUrl);

let myPlayerInfo = null;
let roomState = null;
let gameConfig = null;

const lobbyDiv = document.getElementById('lobby');
const roomInfoP = document.getElementById('room-info');
const playersListDiv = document.getElementById('players-list');
const readyBtn = document.getElementById('ready-btn');
const startBtn = document.getElementById('start-btn');
const gameContainer = document.getElementById('game-container');
const overlayMsg = document.getElementById('overlay-message');
const overlayText = document.getElementById('overlay-text');
const overlayResult = document.getElementById('overlay-result');

if (startBtn) {
    startBtn.addEventListener('click', () => {
        ws.send(JSON.stringify({ type: 'start_game' }));
    });
}

roomInfoP.textContent = `Room ID: ${roomId} (このURLを共有して対戦)`;

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'error') {
        alert(data.message);
        return;
    }
    
    if (data.type === 'welcome') {
        myPlayerInfo = data.you;
        readyBtn.disabled = false;
        readyBtn.textContent = '準備OK';
    }
    
    if (data.type === 'roomState') {
        const oldState = roomState ? roomState.state : null;
        roomState = data;
        gameConfig = data.config;
        
        // game.jsの状態参照も更新
        if (typeof updateRoomState === 'function') updateRoomState(data);
        
        handleStateTransition(oldState, roomState.state);
        if (roomState.state === 'lobby') {
            updateLobby();
        }
        
        const allReady = roomState.players.length > 0 && roomState.players.every(p => p.ready);
        const is1P = myPlayerInfo && myPlayerInfo.number === 1;
        if (startBtn) {
            if (allReady && is1P && roomState.state === 'lobby') {
                startBtn.style.display = 'inline-block';
            } else {
                startBtn.style.display = 'none';
            }
        }
    }
    
    if (data.type === 'draw') {
        if (typeof onReceiveDraw === 'function') onReceiveDraw(data);
    }
};

readyBtn.addEventListener('click', () => {
    ws.send(JSON.stringify({ type: 'ready' }));
    readyBtn.disabled = true;
    readyBtn.textContent = '待機中...';
});

function updateLobby() {
    if(!playersListDiv) return;
    playersListDiv.innerHTML = '';
    
    roomState.players.forEach(p => {
        const div = document.createElement('div');
        const isMe = myPlayerInfo && p.id === myPlayerInfo.id;
        div.textContent = `${p.number}P: ${isMe ? 'あなた 🟢' : '参加者'} ${p.ready ? '✅' : '⏳'}`;
        div.style.color = `var(--color-${p.number}p)`;
        playersListDiv.appendChild(div);
    });
}

function handleStateTransition(oldState, newState) {
    if (newState === 'lobby') {
        lobbyDiv.style.display = 'block';
        gameContainer.style.display = 'none';
        overlayMsg.style.display = 'none';
        overlayResult.style.display = 'none';
        readyBtn.disabled = false;
        readyBtn.textContent = '準備OK';
    }
    else if (newState === 'countdown') {
        lobbyDiv.style.display = 'none';
        gameContainer.style.display = 'flex';
        overlayMsg.style.display = 'flex';
        overlayText.textContent = '3';
        
        if (typeof initGame === 'function') {
            initGame(ws, roomState, gameConfig, myPlayerInfo);
        }
        
        // 3-2-1演出
        let count = 2; // 3 is already shown
        const iv = setInterval(() => {
            if(count > 0) overlayText.textContent = count;
            else clearInterval(iv);
            count--;
        }, 1000);
    }
    else if (newState === 'playing') {
        overlayMsg.style.display = 'flex';
        overlayText.textContent = 'START!';
        
        if (typeof startGameplay === 'function') startGameplay();
        
        setTimeout(() => {
            overlayMsg.style.display = 'none';
        }, 1000);
    }
    else if (newState === 'finish_display') {
        if (typeof stopGameplay === 'function') stopGameplay();
        overlayMsg.style.display = 'flex';
        overlayText.textContent = 'FINISH!';
    }
    else if (newState === 'scoring') {
        overlayText.textContent = '採点中...';
        if (typeof calculateFinalScore === 'function') calculateFinalScore();
    }
    else if (newState === 'result') {
        overlayMsg.style.display = 'none';
        showResult();
    }
}

function restartRoom() {
    ws.send(JSON.stringify({ type: 'restart' }));
}

function showResult() {
    const ranks = [];
    roomState.players.forEach(p => {
        ranks.push({name: `${p.number}P`, display: p.display_score, internal: p.internal_score || 0});
    });
    
    // 勝敗の決定は表示スコアで行う（同率順位あり）
    ranks.sort((a,b) => b.display - a.display);
    
    const rankListEl = document.getElementById('rank-list');
    if(rankListEl) {
        rankListEl.innerHTML = '';
        let currentRank = 1;
        let previousScore = -1;
        
        ranks.forEach((r, idx) => {
            if (r.display !== previousScore) {
                currentRank = idx + 1;
                previousScore = r.display;
            }
            
            const div = document.createElement('div');
            div.className = 'rank-item';
            div.innerHTML = `<span>${currentRank}位 ${r.name}</span> <span>${r.display}点 <span style="font-size:0.6em;color:#94a3b8;font-weight:normal;">(内部スコア:${r.internal})</span></span>`;
            if (currentRank === 1) {
                div.style.color = '#fbbf24'; // Winner gold
            }
            rankListEl.appendChild(div);
        });
    }
    
    overlayResult.style.display = 'flex';
}
