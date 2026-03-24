import asyncio
import json
import os
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

from core.line_generator import generate_model_line
from core.game_config import CONFIG

app = FastAPI()

os.makedirs("static/css", exist_ok=True)
os.makedirs("static/js", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

rooms = {}

class GameState:
    LOBBY = "lobby"
    COUNTDOWN = "countdown"
    PLAYING = "playing"
    FINISH_DISPLAY = "finish_display"
    SCORING = "scoring"
    RESULT = "result"

def get_available_player_number(room):
    used_numbers = [p["number"] for p in room["players"].values()]
    for i in range(1, 5):
        if i not in used_numbers:
            return i
    return None

async def safe_send(ws: WebSocket, msg: str):
    """送信エラー（ソケット切断等）を伝播させずに安全に送信する"""
    try:
        await ws.send_text(msg)
    except Exception:
        pass

async def broadcast_room_state(room_id):
    room = rooms.get(room_id)
    if not room:
        return
    
    state = {
        "type": "roomState",
        "state": room["state"],
        "start_time": room.get("start_time", 0),
        "players": [{"id": p["id"], "number": p["number"], "ready": p["ready"], "display_score": p.get("display_score", 0), "internal_score": p.get("internal_score", 0)} for p in room["players"].values()],
        "model_line": room["model_line"],
        "config": CONFIG
    }
    msg = json.dumps(state)
    for ws in list(room["players"].keys()):
        await safe_send(ws, msg)

async def run_game_flow(room_id):
    room = rooms.get(room_id)
    if not room: return
    
    room["state"] = GameState.COUNTDOWN
    await broadcast_room_state(room_id)
    
    await asyncio.sleep(3.0)
    
    if room_id not in rooms: return
    room = rooms[room_id]
    room["state"] = GameState.PLAYING
    room["start_time"] = time.time()
    for p in room["players"].values():
        p["goal"] = False
        
    goal_event = asyncio.Event()
    room["goal_event"] = goal_event
    await broadcast_room_state(room_id)
    
    total_distance = CONFIG["num_segments"] * 200
    margin = 800
    max_duration = (total_distance + margin) / CONFIG["scroll_speed"] + 10.0
    
    try:
        await asyncio.wait_for(goal_event.wait(), timeout=max_duration)
    except asyncio.TimeoutError:
        pass
        
    await asyncio.sleep(1.0)
    
    if room_id not in rooms: return
    room = rooms[room_id]
    room["state"] = GameState.FINISH_DISPLAY
    await broadcast_room_state(room_id)
    
    await asyncio.sleep(2.0)
    
    if room_id not in rooms: return
    room = rooms[room_id]
    room["state"] = GameState.SCORING
    await broadcast_room_state(room_id)
    
    await asyncio.sleep(2.0)
    
    if room_id not in rooms: return
    room = rooms[room_id]
    room["state"] = GameState.RESULT
    await broadcast_room_state(room_id)

@app.get("/")
async def get_index():
    index_path = os.path.join("static", "index.html")
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Loading...</h1>")

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept()
    
    if room_id not in rooms:
        rooms[room_id] = {
            "state": GameState.LOBBY,
            "players": {},
            "model_line": generate_model_line(),
            "start_time": 0
        }
        
    room = rooms[room_id]
    
    if len(room["players"]) >= 4 or room["state"] != GameState.LOBBY:
        await safe_send(websocket, json.dumps({"type": "error", "message": "入室できません（満員または進行中）。"}))
        try:
            await websocket.close()
        except Exception:
            pass
        return

    player_num = get_available_player_number(room)
    player_id = f"player_{player_num}_{id(websocket)}"
    
    room["players"][websocket] = {
        "id": player_id,
        "number": player_num,
        "ready": False,
        "internal_score": 0,
        "display_score": 0
    }
    
    try:
        await safe_send(websocket, json.dumps({
            "type": "welcome",
            "you": room["players"][websocket]
        }))
        
        await broadcast_room_state(room_id)
        
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message["type"] == "ready":
                if room["state"] != GameState.LOBBY: continue
                room["players"][websocket]["ready"] = True
                await broadcast_room_state(room_id)
                
            elif message["type"] == "start_game":
                if room["state"] != GameState.LOBBY: continue
                if player_num != 1: continue # 1Pのみ開始可能
                all_ready = all(p["ready"] for p in room["players"].values())
                if all_ready and len(room["players"]) > 0:
                    asyncio.create_task(run_game_flow(room_id))
                    
            elif message["type"] == "draw":
                draw_msg = json.dumps({
                    "type": "draw",
                    "player": player_num,
                    "x": message.get("x"),
                    "y": message.get("y")
                })
                for ws in list(room["players"].keys()):
                    if ws != websocket:
                        await safe_send(ws, draw_msg)
                        
            elif message["type"] == "goal":
                if room["state"] != GameState.PLAYING: continue
                room["players"][websocket]["goal"] = True
                
                all_goal = all(p.get("goal") for p in room["players"].values())
                if all_goal and "goal_event" in room:
                    room["goal_event"].set()
                    
            elif message["type"] == "score":
                internal_score = int(message.get("internal_score", 0))
                
                # 表示スコアは単に内部スコアが100を超えた場合に100にするのみ
                display_score = min(internal_score, 100)
                
                room["players"][websocket]["internal_score"] = internal_score
                room["players"][websocket]["display_score"] = display_score
                
            elif message["type"] == "restart":
                room["state"] = GameState.LOBBY
                room["model_line"] = generate_model_line()
                for p in room["players"].values():
                    p["ready"] = False
                    p["internal_score"] = 0
                    p["display_score"] = 0
                await broadcast_room_state(room_id)

    except Exception:
        # 意図しない切断・エラー全てをキャッチ
        pass
    finally:
        # 確実にプレイヤー削除を行う（ゾンビ化防止）
        if websocket in room["players"]:
            del room["players"][websocket]
            
        if len(room["players"]) == 0:
            if room_id in rooms:
                del rooms[room_id]
        else:
            if room["state"] == GameState.PLAYING:
                all_goal = all(p.get("goal") for p in room["players"].values())
                if all_goal and "goal_event" in room:
                    room["goal_event"].set()
                    
            if room["state"] == GameState.LOBBY:
                await broadcast_room_state(room_id)
