let isGameRunning = false;
let localStartTime = 0;
let logicWidth = 1600; 
let logicHeight = 400; 
let segmentLen = 200;  // game_config.jsのsegment_lengthに合わせた既定値
let wsRef = null;
let pConfig = window.gameConfig || { segment_length: 200, num_segments: 12, scroll_speed: 100, review_scroll_speed: 600, tolerance: 50, player_speed: 150, max_internal_score: 105 };
let pRoom = null;
let pMe = null; 

let othersPointers = {}; 
let myTraces = [];
let allTraces = {1: [], 2: [], 3: [], 4: []};
let modelPath = [];

// WASD入力を管理
const keys = { w: false, a: false, s: false, d: false };
let myPx = 0;
let myPy = 0;
let prevTime = 0;
let myHasGoal = false;
let finalScrollOffset = null;
let reviewStartTime = 0;

window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = true;
});
window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = false;
});

function initGame(websocket, roomState, config, myInfo) {
    wsRef = websocket;
    pRoom = roomState;
    pConfig = Object.assign({}, window.gameConfig || {}, config || {});
    pMe = myInfo;
    myHasGoal = false;
    segmentLen = pConfig.segment_length || 200;
    
    for(let i=1; i<=4; i++) {
        const canvas = document.getElementById(`canvas-${i}`);
        if(canvas) {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight / 4;
        }
    }
    // logicHeightは400固定とし、スケーリングで行うためここでの上書きを削除
    buildModelPath();

    myPx = 0;
    myPy = logicHeight / 2;
    myTraces = [];
    allTraces = {1: [], 2: [], 3: [], 4: []};
    isGameRunning = false;
    finalScrollOffset = null;
    reviewStartTime = 0;
    
    if (!prevTime) {
        prevTime = performance.now();
        requestAnimationFrame(gameLoop);
    }
}

// main.js から参照するための更新ブリッジ
function updateRoomState(newState) {
    pRoom = newState;
    if (!pConfig || !pConfig.num_segments) pConfig = window.gameConfig || {};
    if (pRoom && (pRoom.state === 'scoring' || pRoom.state === 'result')) {
        if (finalScrollOffset === null) {
            const goalX = (pConfig.num_segments || 12) * segmentLen;
            finalScrollOffset = goalX - 150;
        }
    }
    // reviewやfinish_display中はfinalScrollOffsetをリセットしない
    // lobbyやcountdownの時だけリセットする
    if (pRoom && (pRoom.state === 'lobby' || pRoom.state === 'countdown')) {
        finalScrollOffset = null;
    }
}

function getModelPath() {
    return modelPath ? [...modelPath] : [];
}

function startGameplay() {
    isGameRunning = true;
    localStartTime = Date.now();
    prevTime = performance.now();
}

function stopGameplay() {
    isGameRunning = false;
    keys.w = keys.a = keys.s = keys.d = false; 
}

function reviewGame() {
    isGameRunning = false;
    keys.w = keys.a = keys.s = keys.d = false;
    reviewStartTime = Date.now();
    finalScrollOffset = null; // review中はgetLogicalScrollOffsetのreviewブランチを使う
}

function getLogicalScrollOffset() {
    const wallStartOffset = -250; // スタート時、プレイヤーよりも後方に境界壁を置く

    if (!pRoom || pRoom.state === 'countdown' || pRoom.state === 'lobby') return wallStartOffset;
    
    if (pRoom.state === 'review') {
        if (reviewStartTime === 0) return wallStartOffset;
        const reviewElapsed = (Date.now() - reviewStartTime) / 1000;
        const speed = pConfig.review_scroll_speed || 375;
        const offset = wallStartOffset + (reviewElapsed * speed);
        
        // ゴールラインが画面横左側1/4(400px)に来るようにストップさせる
        const goalX = (pConfig.num_segments || 12) * segmentLen;
        const maxOffset = goalX - 150; // logicWidth/4(400) と viewPadding(250) の相殺
        if (offset > maxOffset) return maxOffset;
        return offset;
    }
    
    if (finalScrollOffset !== null) return finalScrollOffset;

    if (localStartTime === 0) return wallStartOffset;

    const elapsedSec = (Date.now() - localStartTime) / 1000;
    const currentOffset = wallStartOffset + (elapsedSec * (pConfig.scroll_speed || 100));
    
    const goalX = (pConfig.num_segments || 12) * segmentLen;
    // ゴールより先へ進みすぎないための安全上限
    const absoluteMax = goalX + 1600;
    if (currentOffset > absoluteMax) return absoluteMax;
    
    return currentOffset;
}

function buildModelPath() {
    let cx = 0;
    let cy = logicHeight / 2;
    modelPath = [{x: cx, y: cy}];
    
    if (!pRoom || !pRoom.model_line) return;
    
    const types = pRoom.model_line;
    for(let t of types) {
        const nextX = cx + segmentLen;
        
        for(let i=1; i<=100; i++) {
            const tParam = i / 100.0;
            const px = cx + segmentLen * tParam;
            let py = cy;
            
            if (t === 'straight') { py = cy; }
            else if (t === 'curve_up' || t === 'small_curve_up') { py = cy - (1 - Math.cos(tParam * Math.PI * 2)) / 2 * 25; }
            else if (t === 'curve_down' || t === 'small_curve_down') { py = cy + (1 - Math.cos(tParam * Math.PI * 2)) / 2 * 25; }
            else if (t === 'large_curve_up') { py = cy - (1 - Math.cos(tParam * Math.PI * 2)) / 2 * 50; }
            else if (t === 'large_curve_down') { py = cy + (1 - Math.cos(tParam * Math.PI * 2)) / 2 * 50; }
            else if (t === 'loop_up' || t === 'loop_down') {
                // セグメント全幅にスケールしたループ描画
                const centerR = 40;
                const dir = t === 'loop_up' ? 1 : -1;
                // 前後の直線区間とループ部分を全長segmentLenに収まるよう配分
                const leadIn = segmentLen * 0.25;  // 前方直線区間
                const loopSection = segmentLen * 0.5; // ループ区間
                const leadOut = segmentLen * 0.25; // 後方直線区間
                const absX = tParam * segmentLen; // セグメント内の絶対進行距離
                let cX, cY;
                if (absX <= leadIn) {
                    // 前方直線（始点→ループ入口）
                    cX = cx + absX;
                    cY = cy;
                } else if (absX <= leadIn + loopSection) {
                    // ループ区間
                    const normT = (absX - leadIn) / loopSection;
                    const theta = -Math.PI/2 + normT * Math.PI * 2;
                    cX = cx + leadIn + (loopSection/2) + centerR * Math.cos(theta);
                    cY = cy - (centerR + centerR * Math.sin(theta)) * dir;
                } else {
                    // 後方直線（ループ出口→終点）
                    cX = cx + absX;
                    cY = cy;
                }
                modelPath.push({x: cX, y: cY});
                continue;
            } else if (t === 'vertical_step_up') {
                const t2 = (Math.cos(Math.PI + tParam * Math.PI) + 1) / 2;
                py = cy - t2 * 60;
            } else if (t === 'vertical_step_down') {
                const t2 = (Math.cos(Math.PI + tParam * Math.PI) + 1) / 2;
                py = cy + t2 * 60;
            }
            modelPath.push({x: px, y: py});
        }
        cx = nextX;
        if (t === 'vertical_step_up') cy -= 60;
        if (t === 'vertical_step_down') cy += 60;
    }
}

function onReceiveDraw(data) {
    if (data.x === null) return;
    allTraces[data.player].push({x: data.x, y: data.y});
    othersPointers[data.player] = {x: data.x, y: data.y};
}

let lastReportedScore = 0;

function calculateFinalScore() {
    const tol = pConfig.tolerance || 50;
    const goalX = (pConfig.num_segments || 12) * segmentLen;
    
    let validPoints = 0;
    let evaluatedPoints = 0;
    
    for (let pt of myTraces) {
        if (pt.x > goalX) continue;
        evaluatedPoints++;
        
        let minDist = 999999;
        for (let m of modelPath) {
            if (Math.abs(m.x - pt.x) > 300) continue; 
            const d = Math.pow(pt.x-m.x, 2) + Math.pow(pt.y-m.y, 2);
            if (d < minDist) minDist = d;
        }
        
        const dist = Math.sqrt(minDist);
        if (dist <= tol) {
            validPoints++; // 許容範囲内なら有効ポイントとしてカウント
        }
    }
    
    // はみ出さずに塗れた割合 (0.0 ~ 1.0)
    let ratio = evaluatedPoints > 0 ? (validPoints / evaluatedPoints) : 0;
    
    // 割合をもとに内部スコアを計算
    let internalScore = Math.floor(ratio * (pConfig.max_internal_score || 5000));
    
    if (pConfig.max_internal_score) {
        internalScore = Math.min(internalScore, pConfig.max_internal_score);
    }
    
    lastReportedScore = internalScore;
    if (window.sendGameScore) window.sendGameScore(internalScore);
}

function updateMovement(dt) {
    if (!isGameRunning) return;
    
    const speed = pConfig.player_speed || 350;
    let dx = 0; let dy = 0;
    if (keys.w) dy -= speed * dt;
    if (keys.s) dy += speed * dt;
    if (keys.a) dx -= speed * dt;
    if (keys.d) dx += speed * dt;
    
    myPx += dx;
    myPy += dy;
    
    if (myPy < 0) myPy = 0;
    if (myPy > logicHeight) myPy = logicHeight;
    
    const offsetLX = getLogicalScrollOffset();
    if (myPx < offsetLX) myPx = offsetLX; 
    
    // プレイ領域を右にずらした分の表示クランプ調整（250に原状復帰）
    const viewPaddingLeft = 250;
    if (myPx > offsetLX + logicWidth - viewPaddingLeft) myPx = offsetLX + logicWidth - viewPaddingLeft;
    
    const goalX = (pConfig.num_segments || 12) * segmentLen;
    if (myPx >= goalX && !myHasGoal) {
        myHasGoal = true;
        if (window.sendGameGoal) window.sendGameGoal();
    }
    
    const pt = { x: myPx, y: myPy };
    const last = myTraces.length > 0 ? myTraces[myTraces.length - 1] : null;
    
    if (!last || Math.hypot(last.x - myPx, last.y - myPy) > 5) {
        myTraces.push(pt);
        allTraces[pMe.number].push(pt);
        if (window.sendGameDraw) window.sendGameDraw(myPx, myPy);
    }
}

function gameLoop(time) {
    const dt = (time - prevTime) / 1000;
    prevTime = time;
    
    if (isGameRunning) {
        updateMovement(dt);
    }
    
    const offsetLX = getLogicalScrollOffset();
    
    for(let i=1; i<=4; i++) {
        const canvas = document.getElementById(`canvas-${i}`);
        if (!canvas) continue;
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        
        const playersArr = pRoom && pRoom.players ? (Array.isArray(pRoom.players) ? pRoom.players : Object.values(pRoom.players)) : [];
        const isOccupied = playersArr.some(p => p.number === i);
        if(!isOccupied) {
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0,0,W,H);
            continue;
        }
        
        ctx.save();
        const scaleX = W / logicWidth;
        const scaleY = H / logicHeight;
        ctx.scale(scaleX, scaleY);
        // プレイヤー表示と被らないように描画の原点を右にずらす
        const viewPaddingLeft = 250;
        ctx.translate(viewPaddingLeft - offsetLX, 0);
        
        // 1. 最背面に押し出しスクロール壁を描画する
        if (pRoom && (pRoom.state === 'playing' || pRoom.state === 'countdown')) {
            ctx.beginPath();
            ctx.strokeStyle = '#000000'; // 黒色の実線
            ctx.lineWidth = 12;
            ctx.moveTo(offsetLX, 0);
            ctx.lineTo(offsetLX, logicHeight);
            ctx.stroke();
        }

        const isMe = (pMe && i === pMe.number);

        // 2. スタート/ゴールラインをその上に描画
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(0, logicHeight);
        ctx.stroke();
        
        const goalX = (pConfig.num_segments || 12) * segmentLen;
        ctx.beginPath();
        ctx.moveTo(goalX, 0); ctx.lineTo(goalX, logicHeight);
        ctx.stroke();
        
        // お手本線の描画色を白から灰色系に変更（白背景での視認性確保）
        const baseWidth = pConfig.line_width || 40;
        const modelColor = '100, 116, 139'; // Slate 500
        drawLine(ctx, modelPath, `rgba(${modelColor}, 0.15)`, baseWidth * 1.5);
        drawLine(ctx, modelPath, `rgba(${modelColor}, 0.4)`, 8);
        
        // トレース線の太さは以前の2倍 (6 -> 12)
        const pColor = getPlayerColor(i);
        drawLine(ctx, allTraces[i], pColor, 12);
        
        const targetPt = isMe ? {x: myPx, y: myPy} : othersPointers[i];
        if (targetPt) {
            // プレイヤーの円のサイズを直近の2/3に (半径16 -> 11, 枠線6 -> 4)
            const pX = targetPt.x;
            const pY = targetPt.y;

            ctx.fillStyle = '#ffffff'; // Fill color is white
            ctx.beginPath();
            // 縦横のスケール比率相違により丸が楕円にならないよう逆スケーリングを行う
            if (ctx.ellipse) {
                ctx.ellipse(pX, pY, 15 * (scaleY / scaleX), 15, 0, 0, Math.PI * 2);
            } else {
                ctx.arc(pX, pY, 15, 0, Math.PI * 2);
            }
            ctx.fill();

            ctx.lineWidth = 3; // Stroke width is 3
            ctx.strokeStyle = pColor; // Stroke color is player color
            ctx.beginPath();
            if (ctx.ellipse) {
                ctx.ellipse(pX, pY, 15 * (scaleY / scaleX), 15, 0, 0, Math.PI * 2);
            } else {
                ctx.arc(pX, pY, 15, 0, Math.PI * 2);
            }
            ctx.stroke();
        }
        
        ctx.restore();
    }
    
    requestAnimationFrame(gameLoop);
}

function drawLine(ctx, points, color, width) {
    if (!points || points.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.moveTo(points[0].x, points[0].y);
    for(let i=1; i<points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
}

function getPlayerColor(num) {
    switch(num) {
        case 1: return '#ef4444'; 
        case 2: return '#3b82f6'; 
        case 3: return '#f59e0b'; 
        case 4: return '#10b981'; 
        default: return '#ffffff';
    }
}
