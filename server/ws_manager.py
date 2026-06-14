from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import WebSocket

log = logging.getLogger(__name__)
ws_log = logging.getLogger("ws")  # отдельный логгер для всего WS-трафика


def _short(obj: dict, limit: int = 200) -> str:
    """Компактное представление dict для лога."""
    try:
        s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        s = str(obj)
    return s if len(s) <= limit else s[:limit] + "…"


class ConnectionManager:
    """Хранит активные WS-соединения и player_id → WS."""

    def __init__(self) -> None:
        # WebSocket -> player_id (None пока не пришёл join)
        self._connections: dict[WebSocket, Optional[str]] = {}
        # player_id -> WebSocket (для адресной отправки)
        self._by_player: dict[str, WebSocket] = {}

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._connections[ws] = None

    async def disconnect(self, ws: WebSocket) -> Optional[str]:
        player_id = self._connections.pop(ws, None)
        if player_id and self._by_player.get(player_id) is ws:
            del self._by_player[player_id]
        return player_id

    async def attach_player(self, ws: WebSocket, player_id: str) -> Optional[WebSocket]:
        """Привязывает player_id к WS. Если этот player_id уже был — возвращает старый WS."""
        old_ws = self._by_player.get(player_id)
        if old_ws is not None and old_ws is not ws:
            # Старое соединение того же игрока — закроем его наружу (вернём в main)
            self._connections.pop(old_ws, None)
        self._connections[ws] = player_id
        self._by_player[player_id] = ws
        return old_ws if old_ws is not ws else None

    def player_id_of(self, ws: WebSocket) -> Optional[str]:
        return self._connections.get(ws)

    def online_players(self) -> list[str]:
        return list(self._by_player.keys())

    async def send_to(self, player_id: str, message: dict) -> None:
        ws = self._by_player.get(player_id)
        if ws is None:
            ws_log.warning("[>>] %s — not connected, drop: %s", player_id, _short(message))
            return
        try:
            await ws.send_json(message)
            ws_log.info("[>>] %s : %s", player_id, _short(message))
        except Exception as e:
            log.warning("send_to(%s) failed: %s", player_id, e)

    async def send_ws(self, ws: WebSocket, message: dict) -> None:
        try:
            await ws.send_json(message)
            pid = self._connections.get(ws) or "?"
            ws_log.info("[>>] %s : %s", pid, _short(message))
        except Exception as e:
            log.warning("send_ws failed: %s", e)

    async def broadcast(self, message: dict) -> None:
        dead: list[WebSocket] = []
        for ws in list(self._connections.keys()):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        # broadcast обычно — state каждую секунду. Идёт на DEBUG чтобы не шумел в INFO.
        ws_log.debug(
            "[>>BCAST x%d] %s",
            len(self._connections) - len(dead),
            _short(message),
        )
        for ws in dead:
            await self.disconnect(ws)
