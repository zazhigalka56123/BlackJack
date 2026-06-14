from __future__ import annotations

import random
from dataclasses import dataclass

RED: set[int] = {
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
}
BLACK: set[int] = {
    2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35,
}

BET_TYPES = {"RED", "BLACK", "GREEN", "EVEN", "ODD"}

MIN_BET = 10


def spin() -> int:
    return random.randint(0, 36)


def color_of(n: int) -> str:
    if n == 0:
        return "GREEN"
    if n in RED:
        return "RED"
    return "BLACK"


def is_winning(bet_type: str, number: int) -> bool:
    if number == 0:
        return bet_type == "GREEN"
    if bet_type == "RED":
        return number in RED
    if bet_type == "BLACK":
        return number in BLACK
    if bet_type == "EVEN":
        return number % 2 == 0
    if bet_type == "ODD":
        return number % 2 == 1
    return False


def multiplier(bet_type: str) -> int:
    # Множитель полной выплаты (ставка уже списана при принятии).
    # Возврат игроку при выигрыше = amount * multiplier.
    if bet_type == "GREEN":
        return 14
    return 2


@dataclass
class SpinResult:
    number: int
    color: str

    @classmethod
    def random(cls) -> "SpinResult":
        n = spin()
        return cls(number=n, color=color_of(n))
