let isGameRunning = false;
let localStartTime = 0;
let logicWidth = 1600; 
let logicHeight = 400; 
let segmentLen = 200;  
let wsRef = null;
let pConfig = null;
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
    pConfig = config;
    pMe = myInfo;
    myHasGoal = false;
    
    for(let i=1; i<=4; i++) {
        const canvas = document.getElementById(`canvas-${i}`);
        if(canvas) {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight / 4;
        }
    }
    logicHeight = window.innerHeight / 4; 
    buildModelPath();

    myPx = 0;
    myPy = logicHeight / 2;
    myTraces = [];
    allTraces = {1: [], 2: [], 3: [], 4: []};
    isGameRunning = false;
    finalScrollOffset = null;
    
    if (!prevTime) {
        prevTime = performance.now();
        requestAnimationFrame(gameLoop);
    }
}

// main.js から参照するための更新ブリッジ
function updateRoomState(newState) {
    pRoom = newState;
    if (pRoom && (pRoom.state === 'scoring' || pRoom.state === 'result')) {
        if (finalScrollOffset === null) {
            finalScrollOffset = getLogicalScrollOffset();
        }
    } else {
        finalScrollOffset = null;
    }
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

function getLogicalScrollOffset() {
    if (!pRoom || pRoom.state === 'countdown' || pRoom.state === 'lobby') return 0;
    
    if (finalScrollOffset !== null) return finalScrollOffset;

    // localStartが正常に初期化されてない場合のガード（リコネクト時等用）
    if (localStartTime === 0) return 0;

    const elapsedSec = (Date.now() - localStartTime) / 1000;
    
    // スクロール上限
    const maxDur = ((12 * segmentLen) + 800) / pConfig.scroll_speed;
    if (elapsedSec > maxDur) return maxDur * pConfig.scroll_speed;
    
    return elapsedSec * pConfig.scroll_speed;
}

function buildModelPath() {
    let cx = 0;
    let cy = logicHeight / 2;
    modelPath = [{x: cx, y: cy}];
    
    if (!pRoom || !pRoom.model_line) return;
    
    const types = pRoom.model_line;
    for(let t of types) {
        const nextX = cx + segmentLen;
        
        // 頂点数を100に増やし、曲線のカクつき（ポリゴン感）を極限まで無くす
        for(let i=1; i<=100; i++) {
            const tParam = i / 100.0;
            const px = cx + segmentLen * tParam;
            let py = cy;
            
            // 全ての形状の始点と終点の傾きが0になる（C1連続）ような式を用い、接続部の「角(とがり)」を完全に無くす
            if (t === 'straight') { py = cy; }
            else if (t === 'small_curve_up') { py = cy - (1 - Math.cos(tParam * Math.PI * 2)) / 2 * 25; }
            else if (t === 'small_curve_down') { py = cy + (1 - Math.cos(tParam * Math.PI * 2)) / 2 * 25; }
            else if (t === 'large_curve_up') { py = cy - (1 - Math.cos(tParam * Math.PI * 2)) / 2 * 50; }
            else if (t === 'large_curve_down') { py = cy + (1 - Math.cos(tParam * Math.PI * 2)) / 2 * 50; }
            else if (t === 'loop_up' || t === 'loop_down') {
                const centerR = 40; 
                const dir = t === 'loop_up' ? 1 : -1;
                let cX, cY;
                if (tParam <= 0.25) {
                    cX = cx + 100 * (tParam / 0.25);
                    cY = cy;
                } else if (tParam <= 0.75) {
                    const normT = (tParam - 0.25) / 0.5; // 0 to 1
                    const theta = -Math.PI/2 + normT * Math.PI * 2;
                    cX = cx + 100 + centerR * Math.cos(theta);
                    cY = cy - (centerR + centerR * Math.sin(theta)) * dir;
                } else {
                    cX = cx + 100 + 100 * ((tParam - 0.75) / 0.25);
                    cY = cy;
                }
                modelPath.push({x: cX, y: cY});
                continue;
            } else if (t === 'vertical_step_up') {
                const t2 = (Math.cos(Math.PI + tParam * Math.PI) + 1) / 2;
                py = cy - t2 * 60; // 段差も緩やかに
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
    const goalX = pConfig.num_segments * segmentLen;
    
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
    wsRef.send(JSON.stringify({ type: 'score', internal_score: internalScore }));
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
    
    // プレイ領域を右にずらした分の表示クランプ調整
    const viewPaddingLeft = 250;
    if (myPx > offsetLX + logicWidth - viewPaddingLeft) myPx = offsetLX + logicWidth - viewPaddingLeft;
    
    const goalX = pConfig.num_segments * segmentLen;
    if (myPx >= goalX && !myHasGoal) {
        myHasGoal = true;
        wsRef.send(JSON.stringify({ type: 'goal' }));
    }
    
    const pt = { x: myPx, y: myPy };
    const last = myTraces.length > 0 ? myTraces[myTraces.length - 1] : null;
    
    if (!last || Math.hypot(last.x - myPx, last.y - myPy) > 5) {
        myTraces.push(pt);
        allTraces[pMe.number].push(pt);
        wsRef.send(JSON.stringify({ type: 'draw', x: myPx, y: myPy }));
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
        
        const isOccupied = pRoom && pRoom.players && pRoom.players.some(p => p.number === i);
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
        
        const isMe = (pMe && i === pMe.number);

        // スタート/ゴールライン
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(0, logicHeight);
        ctx.stroke();
        
        const goalX = 12 * segmentLen;
        ctx.beginPath();
        ctx.moveTo(goalX, 0); ctx.lineTo(goalX, logicHeight);
        ctx.stroke();
        
        drawLine(ctx, modelPath, 'rgba(255, 255, 255, 0.2)', pConfig.line_width || 20);
        drawLine(ctx, modelPath, 'rgba(255, 255, 255, 0.4)', 4);
        
        const pColor = getPlayerColor(i);
        drawLine(ctx, allTraces[i], pColor, 6);
        
        const targetPt = isMe ? {x: myPx, y: myPy} : othersPointers[i];
        if (targetPt) {
            ctx.beginPath();
            ctx.arc(targetPt.x, targetPt.y, 8, 0, Math.PI*2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = pColor;
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
        case 3: return '#10b981'; 
        case 4: return '#f59e0b'; 
        default: return '#ffffff';
    }
}
