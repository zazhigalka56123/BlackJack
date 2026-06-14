from __future__ import annotations

from pathlib import Path
from typing import Optional

import aiosqlite

DB_PATH = Path(__file__).parent / "casino.db"
STARTING_BALANCE = 1000

SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
    mac TEXT PRIMARY KEY,
    balance INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER NOT NULL,
    color TEXT NOT NULL,
    played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bets_history (
    round_id INTEGER NOT NULL,
    player_mac TEXT NOT NULL,
    bet_type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    won INTEGER NOT NULL,
    FOREIGN KEY (round_id) REFERENCES rounds(id),
    FOREIGN KEY (player_mac) REFERENCES players(mac)
);
"""


class DB:
    def __init__(self, path: Path = DB_PATH):
        self.path = path
        self._conn: Optional[aiosqlite.Connection] = None

    async def connect(self) -> None:
        self._conn = await aiosqlite.connect(self.path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.executescript(SCHEMA)
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    @property
    def conn(self) -> aiosqlite.Connection:
        assert self._conn is not None, "DB not connected"
        return self._conn

    async def get_or_create_player(self, mac: str) -> int:
        async with self.conn.execute(
            "SELECT balance FROM players WHERE mac = ?", (mac,)
        ) as cur:
            row = await cur.fetchone()
        if row is not None:
            return int(row["balance"])
        await self.conn.execute(
            "INSERT INTO players (mac, balance) VALUES (?, ?)",
            (mac, STARTING_BALANCE),
        )
        await self.conn.commit()
        return STARTING_BALANCE

    async def get_balance(self, mac: str) -> Optional[int]:
        async with self.conn.execute(
            "SELECT balance FROM players WHERE mac = ?", (mac,)
        ) as cur:
            row = await cur.fetchone()
        return int(row["balance"]) if row else None

    async def update_balance(self, mac: str, delta: int) -> int:
        await self.conn.execute(
            "UPDATE players SET balance = balance + ? WHERE mac = ?",
            (delta, mac),
        )
        await self.conn.commit()
        balance = await self.get_balance(mac)
        assert balance is not None
        return balance

    async def record_round(self, number: int, color: str) -> int:
        cur = await self.conn.execute(
            "INSERT INTO rounds (number, color) VALUES (?, ?)",
            (number, color),
        )
        await self.conn.commit()
        return int(cur.lastrowid)

    async def record_bet(
        self,
        round_id: int,
        mac: str,
        bet_type: str,
        amount: int,
        won: int,
    ) -> None:
        await self.conn.execute(
            "INSERT INTO bets_history (round_id, player_mac, bet_type, amount, won) "
            "VALUES (?, ?, ?, ?, ?)",
            (round_id, mac, bet_type, amount, won),
        )
        await self.conn.commit()

    async def list_players(self) -> list[dict]:
        async with self.conn.execute(
            "SELECT mac, balance, created_at FROM players ORDER BY created_at"
        ) as cur:
            rows = await cur.fetchall()
        return [dict(r) for r in rows]
