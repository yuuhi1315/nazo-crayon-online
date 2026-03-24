// ====== Firebase Setup & Replaces WebSocket ======
const roomId = 'main_room';

if (!window.db) {
    console.error("Firebase DB is not initialized! Check firebase_config.js");
}
const roomRef = window.db ? window.db.ref('rooms/' + roomId) : null;

let myPlayerInfo = null;
let roomState = null;
let isHost = false;
let hostInterval = null;
let firstJoin = true; // 初回接続フラグ

const lobbyDiv = document.getElementById('lobby');
const roomInfoP = document.getElementById('room-info');
const playersListDiv = document.getElementById('players-list');
const readyBtn = document.getElementById('ready-btn');
const startBtn = document.getElementById('start-btn');
const gameContainer = document.getElementById('game-container');
const overlayMsg = document.getElementById('overlay-message');
const overlayText = document.getElementById('overlay-text');
const overlayResult = document.getElementById('overlay-result');

roomInfoP.style.display = 'none';

if (startBtn) {
    startBtn.addEventListener('click', () => {
        if (isHost && roomRef) {
            roomRef.update({
                state: 'countdown',
                state_started_at: firebase.database.ServerValue.TIMESTAMP,
                model_line: generateModelLine(),
                traces: {},
                global_start_time: 0,
                review_start_time: 0
            });
        }
    });
}

function generateModelLine() {
    const num_segs = window.gameConfig?.num_segments || 12;
    const types = ['straight', 'curve_up', 'curve_down', 'loop_up', 'loop_down', 'vertical_step_up', 'vertical_step_down'];
    const line = [];
    let currentY = 0; // センター(0)からの相対位置。負が上方向。

    for (let i = 0; i < num_segs; i++) {
        let validTypes = [...types];
        
        // はみ出し防止ガード: Y軸方向に大きくズレすぎた場合、同方向への移動を禁止
        if (currentY <= -120) {
            validTypes = validTypes.filter(t => t !== 'vertical_step_up' && t !== 'loop_up');
        }
        if (currentY >= 120) {
            validTypes = validTypes.filter(t => t !== 'vertical_step_down' && t !== 'loop_down');
        }
        
        const type = validTypes[Math.floor(Math.random() * validTypes.length)];
        line.push(type);
        
        // 段差だけが直後のYベースラインを変更する
        if (type === 'vertical_step_up') currentY -= 60;
        if (type === 'vertical_step_down') currentY += 60;
    }
    return line;
}

let myPlayerId = localStorage.getItem('nazo_uuid');
if (!myPlayerId) {
    myPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('nazo_uuid', myPlayerId);
}

if (roomRef) {
    const myPlayerRef = roomRef.child('players/' + myPlayerId);
    myPlayerRef.onDisconnect().remove();

    // まず接続前にルームの状態をリセット（前回の残りデータ対策）
    roomRef.once('value', (snap) => {
        const data = snap.val();
        const playerCount = data && data.players ? Object.keys(data.players).length : 0;
        // 前回の残りデータがある場合、または誰もいない場合はリセット
        const needsReset = !data || !data.state || data.state === 'result' || data.state === 'scoring' || playerCount === 0;
        
        const afterReset = () => {
            // プレイヤーをトランザクションで追加
            roomRef.child('players').transaction((playersObj) => {
                if (!playersObj) playersObj = {};
                
                let myNum = null;
                if (playersObj[myPlayerId]) {
                    myNum = playersObj[myPlayerId].number;
                } else {
                    if (Object.keys(playersObj).length >= 4) return;
                    let takenNums = Object.values(playersObj).map(p => p.number);
                    myNum = 1;
                    while(takenNums.includes(myNum)) myNum++;
                }
                
                playersObj[myPlayerId] = {
                    number: myNum,
                    name: 'Player ' + myNum,
                    ready: false,
                    goal: false,
                    score: null,
                    rank: null,
                    last_ping: firebase.database.ServerValue.TIMESTAMP
                };
                return playersObj;
                
            }, (error, committed, snapshot) => {
                if (error || !committed) {
                    if (!error) alert('ルームが満員です。');
                    return;
                }
                const allPlayers = snapshot.val();
                if (allPlayers && allPlayers[myPlayerId]) {
                    myPlayerInfo = allPlayers[myPlayerId];
                    myPlayerInfo.id = myPlayerId;
                }
                setupRoomListener();
            });
        };

        if (needsReset) {
            roomRef.update({
                state: 'lobby',
                global_start_time: 0,
                review_start_time: 0,
                model_line: null,
                traces: null,
                state_started_at: firebase.database.ServerValue.TIMESTAMP
            }).then(afterReset);
        } else {
            afterReset();
        }
    });
}

function setupRoomListener() {
    roomRef.on('value', (snap) => {
        const data = snap.val();
        if (!data || !data.state) {
            roomRef.update({
                state: 'lobby',
                global_start_time: 0,
                review_start_time: 0,
                state_started_at: firebase.database.ServerValue.TIMESTAMP
            });
            return;
        }
        
        const oldState = roomState ? roomState.state : null;
        roomState = data;
        
        // ルームに誰もいなくなったら自動リセット
        const currentPlayers = data.players ? Object.keys(data.players) : [];
        if (currentPlayers.length === 0 && data.state !== 'lobby') {
            roomRef.update({
                state: 'lobby',
                global_start_time: 0,
                review_start_time: 0,
                model_line: null,
                traces: null,
                state_started_at: firebase.database.ServerValue.TIMESTAMP
            });
            return;
        }
        
        // pConfigとしてgameConfigをマージ（game.jsが参照するため）
        roomState.config = Object.assign({}, window.gameConfig || {});
        
        // Convert traces format gracefully
        if (roomState.traces) {
            for (let num of Object.keys(roomState.traces)) {
                if (!Array.isArray(roomState.traces[num])) {
                    roomState.traces[num] = Object.values(roomState.traces[num]);
                }
            }
        }
        
        determineHost();
        
        const newState = roomState.state;
        
        // 初回接続時、または状態が変わったときにUIを反映する
        if (firstJoin || oldState !== newState) {
            firstJoin = false;
            handleStateTransition(oldState, newState);
        }
        updatePlayersList(roomState.players || {}, newState);
    });
}

function determineHost() {
    if (!roomState || !roomState.players) {
        isHost = false; return;
    }
    const pIds = Object.keys(roomState.players);
    if (pIds.length === 0) return;
    pIds.sort();
    const newIsHost = (myPlayerId === pIds[0]);
    
    if (newIsHost && !isHost) {
        if (hostInterval) clearInterval(hostInterval);
        hostInterval = setInterval(hostLoop, 500);
    } else if (!newIsHost && isHost) {
        if (hostInterval) clearInterval(hostInterval);
        hostInterval = null;
    }
    isHost = newIsHost;
}

function hostLoop() {
    if (!isHost || !roomState) return;
    
    const players = roomState.players ? Object.values(roomState.players) : [];
    const numPlayers = players.length;
    const now = Date.now();
    const stateStart = roomState.state_started_at || now;
    
    if (roomState.state === 'countdown') {
        // state_started_atはServerValue.TIMESTAMPなのでサーバー側の時刻。
        // 但しクライアントとずれる可能性があるため、3500msの余裕を持たせる
        if (now - stateStart >= 3500) {
            roomRef.update({
                state: 'playing',
                state_started_at: firebase.database.ServerValue.TIMESTAMP,
                global_start_time: firebase.database.ServerValue.TIMESTAMP
            });
        }
    }
    else if (roomState.state === 'playing') {
        const allGoal = (numPlayers > 0) && players.every(p => p.goal === true);
        // global_start_timeがServerValue.TIMESTAMPの場合、msで保持される
        let isTimeout = false;
        if (roomState.global_start_time > 0) {
            const startMs = roomState.global_start_time > 1e12 ? roomState.global_start_time : roomState.global_start_time * 1000;
            if (now - startMs > 30000) isTimeout = true; // 30秒タイムアウトに延長
        }
        if (allGoal || isTimeout) {
            roomRef.update({ 
                state: 'finish_display', 
                state_started_at: firebase.database.ServerValue.TIMESTAMP 
            });
        }
    }
    else if (roomState.state === 'finish_display') {
        if (now - stateStart >= 2000) {
            roomRef.update({
                state: 'review',
                state_started_at: firebase.database.ServerValue.TIMESTAMP,
                review_start_time: now / 1000
            });
        }
    }
    else if (roomState.state === 'review') {
        const segLen = window.gameConfig?.segment_length || 200;
        const totalSegs = window.gameConfig?.num_segments || 12;
        const target_offset = (totalSegs * segLen) - 150;
        const start_offset = -250;
        const rv_speed = window.gameConfig?.review_scroll_speed || 600;
        const review_duration = ((target_offset - start_offset) / rv_speed) + 0.5;
        
        if (now - stateStart >= review_duration * 1000) {
            roomRef.update({ state: 'scoring', state_started_at: firebase.database.ServerValue.TIMESTAMP });
        }
    }
    else if (roomState.state === 'scoring') {
        if (now - stateStart >= 3000) {
            let pList = players.map(p => ({
                id: Object.keys(roomState.players).find(k => roomState.players[k].number === p.number), 
                score: p.score || 0
            }));
            pList.sort((a, b) => b.score - a.score);
            let rank = 1;
            let updates = { state: 'result', state_started_at: firebase.database.ServerValue.TIMESTAMP };
            pList.forEach((p, idx) => {
                if (idx > 0 && p.score < pList[idx-1].score) rank = idx + 1;
                updates[`players/${p.id}/rank`] = rank;
            });
            roomRef.update(updates);
        }
    }
}

function handleStateTransition(oldState, newState) {
    if (typeof updateRoomState === 'function') updateRoomState(roomState);
    
    if (newState === 'lobby') {
        lobbyDiv.style.display = 'block';
        gameContainer.style.display = 'none';
        overlayMsg.style.display = 'none';
        overlayText.textContent = '';
        overlayResult.style.display = 'none';
        if (typeof stopGameplay === 'function') stopGameplay();
        readyBtn.disabled = false;
        readyBtn.textContent = '準備OK';
        
        if (myPlayerInfo) {
            roomRef.child('players/' + myPlayerInfo.id).update({
                ready: false, goal: false, score: null, rank: null
            });
        }
    }
    else if (newState === 'countdown') {
        // ゲーム初期化はcountdown開始の1回だけ行う
        if (typeof initGame === 'function' && roomState) {
            const fullConfig = Object.assign({}, window.gameConfig || {}, roomState.config || {});
            initGame(null, Object.assign({}, roomState), fullConfig, myPlayerInfo);
        }
        
        lobbyDiv.style.display = 'none';
        gameContainer.style.display = 'flex';
        overlayResult.style.display = 'none';
        overlayMsg.style.display = 'flex';
        let count = 3;
        overlayText.textContent = count;
        
        const cInt = setInterval(() => {
            count--;
            if (count > 0) overlayText.textContent = count;
            else if (count === 0) overlayText.textContent = 'START!';
            else { clearInterval(cInt); overlayMsg.style.display = 'none'; }
        }, 1000);
        
        // カウントダウン中はまだ動かさない（startGameplayはplayingで呼ぶ）
    }
    else if (newState === 'playing') {
        lobbyDiv.style.display = 'none';
        gameContainer.style.display = 'flex';
        overlayMsg.style.display = 'none';
        // START後に初めて操作可能にする
        if (typeof startGameplay === 'function') startGameplay();
    }
    else if (newState === 'finish_display') {
        lobbyDiv.style.display = 'none';
        gameContainer.style.display = 'flex';
        if (typeof stopGameplay === 'function') stopGameplay();
        overlayMsg.style.display = 'flex';
        overlayText.textContent = 'FINISH!';
    }
    else if (newState === 'review') {
        lobbyDiv.style.display = 'none';
        gameContainer.style.display = 'flex';
        overlayMsg.style.display = 'none';
        // リプレイ用のスクロールを開始する
        if (typeof reviewGame === 'function') reviewGame();
    }
    else if (newState === 'scoring') {
        lobbyDiv.style.display = 'none';
        gameContainer.style.display = 'flex';
        overlayMsg.style.display = 'flex';
        overlayText.textContent = '採点中...';
        
        if (typeof calculateFinalScore === 'function') {
            calculateFinalScore();
        }
    }
    else if (newState === 'result') {
        lobbyDiv.style.display = 'none';
        gameContainer.style.display = 'flex';
        overlayMsg.style.display = 'none';
        if (typeof showResult === 'function') showResult(roomState.players);
    }
}

function updatePlayersList(playersObj, state) {
    playersListDiv.innerHTML = '';
    const players = Object.values(playersObj);
    players.sort((a,b) => a.number - b.number);
    let allReady = true;
    for (const p of players) {
        const pDiv = document.createElement('div');
        pDiv.className = `player-item ${p.ready ? 'ready' : ''}`;
        pDiv.innerHTML = `<span class="player-color p${p.number}-indicator">●</span> ${p.name} ${p.ready ? '(OK)' : ''}`;
        playersListDiv.appendChild(pDiv);
        if (!p.ready) allReady = false;
    }
    if (isHost && state === 'lobby') startBtn.style.display = (players.length > 0 && allReady) ? 'inline-block' : 'none';
    else startBtn.style.display = 'none';
}

readyBtn.addEventListener('click', () => {
    if (!myPlayerInfo) return;
    roomRef.child('players/' + myPlayerInfo.id).update({ ready: true });
    readyBtn.disabled = true;
    readyBtn.textContent = '準備完了';
});

document.getElementById('restart-btn').addEventListener('click', () => {
    if (isHost && roomRef) {
        roomRef.update({ 
            state: 'lobby',
            model_line: null,
            traces: null,
            global_start_time: 0,
            review_start_time: 0,
            state_started_at: firebase.database.ServerValue.TIMESTAMP
        });
    }
});

function calculateFinalScore() {
    if (!myPlayerInfo || !roomState) return;
    const traces = roomState.traces || {};
    const myTraces = traces[myPlayerInfo.number] || [];
    
    // モデルパスを game.js の関数から取得する
    let mPath = [];
    if (typeof getModelPath === 'function') {
        mPath = getModelPath();
    }
    
    if (!mPath || mPath.length === 0 || myTraces.length === 0) {
        sendGameScore(0);
        return;
    }
    
    let errSum = 0;
    let count = 0;
    
    myTraces.forEach(pt => {
        let minDist = 999999;
        mPath.forEach(mp => {
            const dx = pt.x - mp.x;
            const dy = pt.y - mp.y;
            const d = Math.sqrt(dx*dx + dy*dy);
            if (d < minDist) minDist = d;
        });
        errSum += minDist;
        count++;
    });
    
    const avgErr = count > 0 ? errSum / count : 999999;
    
    // 許容誤差（tolerance）: 20px。ゼロ誤差で100点、20px誤差で0点
    const tolerance = window.gameConfig?.tolerance || 20;
    
    // 線形スコア: avgErr=0→100点, avgErr>=tolerance→0点
    let displayScore = Math.round(Math.max(0, (1 - avgErr / tolerance)) * 100);
    
    // 上限100点を厳守（念のため）
    if (displayScore > 100) displayScore = 100;
    if (displayScore < 0) displayScore = 0;
    
    sendGameScore(displayScore);
}

// ====== Interception points for game.js ======
window.sendGameDraw = function(x, y) {
    if(!myPlayerInfo || !roomRef) return;
    roomRef.child('traces/' + myPlayerInfo.number).push({x, y});
};

window.sendGameGoal = function() {
    if(!myPlayerInfo || !roomRef) return;
    roomRef.child('players/' + myPlayerInfo.id).update({ goal: true });
};

window.sendGameScore = function(score) {
    if(!myPlayerInfo || !roomRef) return;
    roomRef.child('players/' + myPlayerInfo.id).update({ score: score });
};

function showResult(playersObj) {
    if (!overlayResult) return;
    overlayResult.style.display = 'flex';
    const rankList = document.getElementById('rank-list');
    if (!rankList) return;
    rankList.innerHTML = '';
    
    const pList = Object.values(playersObj).sort((a, b) => {
        const rA = a.rank || 99;
        const rB = b.rank || 99;
        return rA - rB;
    });
    
    pList.forEach(p => {
        const div = document.createElement('div');
        div.style.marginBottom = '10px';
        div.style.fontSize = '1.2rem';
        div.innerHTML = `<strong style="color:var(--primary)">${p.rank || '-'}位</strong>: <span style="margin: 0 10px;">${p.name}</span> <span>${p.score || 0}点</span>`;
        rankList.appendChild(div);
    });
}
