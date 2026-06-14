from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

# ---- Клиент -> Сервер ----

class JoinMsg(BaseModel):
    type: Literal["join"]
    player_id: str


class BetMsg(BaseModel):
    type: Literal["bet"]
    player_id: str
    bet_type: Literal["RED", "BLACK", "GREEN", "EVEN", "ODD"]
    amount: int = Field(gt=0)


class CancelBetMsg(BaseModel):
    type: Literal["cancel_bet"]
    player_id: str


# ---- Сервер -> Клиент ----

class WelcomeMsg(BaseModel):
    type: Literal["welcome"] = "welcome"
    player_id: str
    balance: Optional[int] = None  # None для наблюдателей


class BetAcceptedMsg(BaseModel):
    type: Literal["bet_accepted"] = "bet_accepted"
    player_id: str
    bet_type: str
    amount: int
    balance: int


class ErrorMsg(BaseModel):
    type: Literal["error"] = "error"
    player_id: Optional[str] = None
    code: str
    message: str


# Коды ошибок
ERR_BET_TOO_LARGE = "BET_TOO_LARGE"
ERR_BET_TOO_SMALL = "BET_TOO_SMALL"
ERR_WRONG_PHASE = "WRONG_PHASE"
ERR_INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS"
ERR_UNKNOWN_PLAYER = "UNKNOWN_PLAYER"
ERR_BAD_MESSAGE = "BAD_MESSAGE"
