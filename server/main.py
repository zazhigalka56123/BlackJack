from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

import models as M
from db import DB
from game import GameLoop
from ws_manager import ConnectionManager

# Уровень можно поднять до DEBUG переменной окружения LOG_LEVEL=DEBUG
# (тогда увидишь и сами state broadcasts).
_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

logging.basicConfig(
    level=_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("main")
ws_log = logging.getLogger("ws")


def _short(obj: dict, limit: int = 200) -> str:
    try:
        s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        s = str(obj)
    return s if len(s) <= limit else s[:limit] + "…"

db = DB()
manager = ConnectionManager()
game = GameLoop(db, manager)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    await game.start()
    log.info("Server ready")
    try:
        yield
    finally:
        await game.stop()
        await db.close()


app = FastAPI(title="IoT Roulette", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root() -> dict:
    return {
        "service": "IoT Roulette",
        "ws_endpoint": "/ws",
        "phase": game.state.phase,
        "timer": game.state.timer,
        "round_id": game.state.round_id,
    }


@app.get("/players")
async def list_players() -> list[dict]:
    return await db.list_players()


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await manager.connect(ws)
    client = f"{ws.client.host}:{ws.client.port}" if ws.client else "?"
    ws_log.info("[++] new connection from %s", client)
    try:
        while True:
            raw = await ws.receive_json()
            pid = manager.player_id_of(ws) or "?"
            ws_log.info("[<<] %s : %s", pid, _short(raw))
            await _handle_message(ws, raw)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("WS handler crashed")
    finally:
        player_id = await manager.disconnect(ws)
        ws_log.info("[--] disconnect %s (was: %s)", client, player_id or "no-join")


async def _handle_message(ws: WebSocket, raw: dict) -> None:
    msg_type = raw.get("type")
    try:
        if msg_type == "join":
            msg = M.JoinMsg.model_validate(raw)
            old_ws = await manager.attach_player(ws, msg.player_id)
            if old_ws is not None:
                try:
                    await old_ws.close()
                except Exception:
                    pass
            welcome = await game.on_join(msg.player_id)
            await manager.send_ws(ws, welcome)
            log.info("joined: %s", msg.player_id)

        elif msg_type == "bet":
            msg = M.BetMsg.model_validate(raw)
            pid_on_ws = manager.player_id_of(ws)
            if pid_on_ws != msg.player_id:
                await manager.send_ws(ws, M.ErrorMsg(
                    player_id=msg.player_id,
                    code=M.ERR_UNKNOWN_PLAYER,
                    message="Send join first",
                ).model_dump())
                return
            accepted, error = await game.on_bet(msg.player_id, msg.bet_type, msg.amount)
            if error:
                await manager.send_ws(ws, error)
            elif accepted:
                await manager.send_ws(ws, accepted)

        elif msg_type == "cancel_bet":
            msg = M.CancelBetMsg.model_validate(raw)
            pid_on_ws = manager.player_id_of(ws)
            if pid_on_ws != msg.player_id:
                return
            response = await game.on_cancel_bet(msg.player_id)
            if response:
                await manager.send_ws(ws, response)

        else:
            await manager.send_ws(ws, M.ErrorMsg(
                code=M.ERR_BAD_MESSAGE,
                message=f"Unknown type: {msg_type}",
            ).model_dump())

    except ValidationError as e:
        await manager.send_ws(ws, M.ErrorMsg(
            code=M.ERR_BAD_MESSAGE,
            message=str(e.errors()[:1]),
        ).model_dump())
