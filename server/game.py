from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional

from db import DB
from roulette import (
    MIN_BET,
    SpinResult,
    color_of,
    is_winning,
    multiplier,
)
from ws_manager import ConnectionManager
import models as M

log = logging.getLogger(__name__)

PHASE_BETTING = "BETTING"
PHASE_SPINNING = "SPINNING"
PHASE_RESULT = "RESULT"

DURATIONS = {
    PHASE_BETTING: 20,
    PHASE_SPINNING: 4,
    PHASE_RESULT: 6,
}

# Браузерные клиенты — наблюдатели, не имеют баланса и не играют.
def is_observer(player_id: str) -> bool:
    return player_id.startswith("browser-")


@dataclass
class Bet:
    bet_type: str
    amount: int


@dataclass
class GameState:
    phase: str = PHASE_BETTING
    timer: int = DURATIONS[PHASE_BETTING]
    round_id: int = 0
    bets: dict[str, Bet] = field(default_factory=dict)
    last_result: Optional[SpinResult] = None
    # Балансы игроков в памяти, синхронизируется с БД при изменениях
    balances: dict[str, int] = field(default_factory=dict)
    # Сумма выигрыша за последний раунд по каждому игроку (для RESULT-стейта)
    last_won: dict[str, int] = field(default_factory=dict)


class GameLoop:
    def __init__(self, db: DB, manager: ConnectionManager) -> None:
        self.db = db
        self.manager = manager
        self.state = GameState()
        self._task: Optional[asyncio.Task] = None
        self._stopped = asyncio.Event()

    # ---- lifecycle ----

    async def start(self) -> None:
        if self._task is None or self._task.done():
            self._stopped.clear()
            self._task = asyncio.create_task(self._run(), name="game-loop")
            log.info("GameLoop started")

    async def stop(self) -> None:
        self._stopped.set()
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=2)
            except asyncio.TimeoutError:
                self._task.cancel()

    # ---- main loop ----

    async def _run(self) -> None:
        # стартовая рассылка
        await self._broadcast_state()
        while not self._stopped.is_set():
            try:
                await asyncio.sleep(1)
                self.state.timer -= 1
                if self.state.timer <= 0:
                    await self._advance_phase()
                await self._broadcast_state()
            except Exception:
                log.exception("game tick failed")

    async def _advance_phase(self) -> None:
        if self.state.phase == PHASE_BETTING:
            await self._enter_spinning()
        elif self.state.phase == PHASE_SPINNING:
            await self._enter_result()
        elif self.state.phase == PHASE_RESULT:
            await self._enter_betting()

    async def _enter_spinning(self) -> None:
        self.state.phase = PHASE_SPINNING
        self.state.timer = DURATIONS[PHASE_SPINNING]
        # Заранее определяем результат — фронт получит его в первом state SPINNING
        # и сможет докрутить колесо в нужный сектор.
        self.state.last_result = SpinResult.random()
        log.info(
            "round %d -> SPINNING, result will be %d (%s), bets=%d",
            self.state.round_id,
            self.state.last_result.number,
            self.state.last_result.color,
            len(self.state.bets),
        )

    async def _enter_result(self) -> None:
        self.state.phase = PHASE_RESULT
        self.state.timer = DURATIONS[PHASE_RESULT]
        result = self.state.last_result
        assert result is not None
        # Записываем раунд в БД и считаем выплаты
        db_round_id = await self.db.record_round(result.number, result.color)
        self.state.last_won = {}
        for player_id, bet in self.state.bets.items():
            won_amount = 0
            if is_winning(bet.bet_type, result.number):
                payout = bet.amount * multiplier(bet.bet_type)
                new_balance = await self.db.update_balance(player_id, payout)
                self.state.balances[player_id] = new_balance
                won_amount = payout
            await self.db.record_bet(
                db_round_id, player_id, bet.bet_type, bet.amount, won_amount
            )
            self.state.last_won[player_id] = won_amount
        log.info(
            "round %d RESULT %d: payouts=%s",
            self.state.round_id,
            result.number,
            self.state.last_won,
        )

    async def _enter_betting(self) -> None:
        self.state.phase = PHASE_BETTING
        self.state.timer = DURATIONS[PHASE_BETTING]
        self.state.bets.clear()
        self.state.last_won.clear()
        self.state.last_result = None
        self.state.round_id += 1

    # ---- broadcasting ----

    def _build_state_message(self) -> dict:
        players = []
        # В списке игроков — только реальные железные клиенты (ESP по MAC).
        # Браузеры-наблюдатели подключены, но в game state не показываются.
        for pid in self.manager.online_players():
            if is_observer(pid):
                continue
            entry = {
                "id": pid,
                "balance": self.state.balances.get(pid),
            }
            bet = self.state.bets.get(pid)
            if bet is not None:
                entry["bet"] = {"type": bet.bet_type, "amount": bet.amount}
            if self.state.phase == PHASE_RESULT and pid in self.state.last_won:
                entry["won"] = self.state.last_won[pid]
            players.append(entry)

        msg: dict = {
            "type": "state",
            "phase": self.state.phase,
            "timer": max(0, self.state.timer),
            "round_id": self.state.round_id,
            "players": players,
        }
        if self.state.phase in (PHASE_SPINNING, PHASE_RESULT) and self.state.last_result:
            msg["result"] = {
                "number": self.state.last_result.number,
                "color": self.state.last_result.color,
            }
        return msg

    async def _broadcast_state(self) -> None:
        await self.manager.broadcast(self._build_state_message())

    # ---- player actions ----

    async def on_join(self, player_id: str) -> dict:
        """Возвращает welcome-сообщение для игрока. Наблюдатели получают balance=None."""
        if is_observer(player_id):
            return M.WelcomeMsg(player_id=player_id, balance=None).model_dump()
        balance = await self.db.get_or_create_player(player_id)
        self.state.balances[player_id] = balance
        return M.WelcomeMsg(player_id=player_id, balance=balance).model_dump()

    async def on_bet(
        self, player_id: str, bet_type: str, amount: int
    ) -> tuple[Optional[dict], Optional[dict]]:
        """Возвращает (bet_accepted, error). Один из двух — None."""
        if is_observer(player_id):
            return None, M.ErrorMsg(
                player_id=player_id,
                code=M.ERR_UNKNOWN_PLAYER,
                message="Observers cannot bet",
            ).model_dump()
        if self.state.phase != PHASE_BETTING:
            return None, M.ErrorMsg(
                player_id=player_id,
                code=M.ERR_WRONG_PHASE,
                message="Bets are closed",
            ).model_dump()
        if amount < MIN_BET:
            return None, M.ErrorMsg(
                player_id=player_id,
                code=M.ERR_BET_TOO_SMALL,
                message=f"Min bet is {MIN_BET}",
            ).model_dump()

        current_balance = self.state.balances.get(player_id)
        if current_balance is None:
            current_balance = await self.db.get_or_create_player(player_id)
            self.state.balances[player_id] = current_balance

        # Если игрок переставляет — возвращаем старую сумму
        prev_bet = self.state.bets.get(player_id)
        effective_balance = current_balance + (prev_bet.amount if prev_bet else 0)

        if effective_balance <= 0:
            return None, M.ErrorMsg(
                player_id=player_id,
                code=M.ERR_INSUFFICIENT_FUNDS,
                message="Balance is 0",
            ).model_dump()
        if amount > effective_balance:
            return None, M.ErrorMsg(
                player_id=player_id,
                code=M.ERR_BET_TOO_LARGE,
                message=f"Max bet {effective_balance}",
            ).model_dump()

        # Возврат предыдущей ставки + списание новой
        delta = -(amount - (prev_bet.amount if prev_bet else 0))
        new_balance = await self.db.update_balance(player_id, delta)
        self.state.balances[player_id] = new_balance
        self.state.bets[player_id] = Bet(bet_type=bet_type, amount=amount)

        return (
            M.BetAcceptedMsg(
                player_id=player_id,
                bet_type=bet_type,
                amount=amount,
                balance=new_balance,
            ).model_dump(),
            None,
        )

    async def on_cancel_bet(self, player_id: str) -> Optional[dict]:
        """Возвращает bet_accepted с amount=0 (отмена) или None если нечего отменять."""
        if self.state.phase != PHASE_BETTING:
            return M.ErrorMsg(
                player_id=player_id,
                code=M.ERR_WRONG_PHASE,
                message="Cannot cancel now",
            ).model_dump()
        prev_bet = self.state.bets.pop(player_id, None)
        if prev_bet is None:
            return None
        new_balance = await self.db.update_balance(player_id, prev_bet.amount)
        self.state.balances[player_id] = new_balance
        return M.BetAcceptedMsg(
            player_id=player_id,
            bet_type=prev_bet.bet_type,
            amount=0,
            balance=new_balance,
        ).model_dump()
