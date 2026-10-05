from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from .engine.duel_models import MODEL_INDEX

MAX_SIDE = 40


class Board(BaseModel):
    rows: int = Field(ge=1, le=MAX_SIDE)
    cols: int = Field(ge=1, le=MAX_SIDE)
    active: list[list[bool]]
    adjacency: Literal["orth", "both"] = "orth"

    @model_validator(mode="after")
    def _shape(self):
        if len(self.active) != self.rows or any(len(r) != self.cols for r in self.active):
            raise ValueError("active grid does not match rows x cols")
        return self


class Config(Board):
    p: list[list[float]]
    a: list[list[float]]
    selection: Literal["all", "singles"] = "all"
    prize_every: int = Field(default=8, ge=0)
    small_prize: float = Field(default=10_000, ge=0)
    big_prize: float = Field(default=200_000, ge=0)
    model: str = "power"
    model_param: float = Field(default=1.0, gt=0)
    luck: float = Field(default=0.0, ge=0, le=1)
    n_sims: int = Field(default=10_000, ge=1, le=10_000_000)
    seed: Optional[int] = Field(default=None, ge=0, lt=2**63)

    @model_validator(mode="after")
    def _check(self):
        for name in ("p", "a"):
            grid = getattr(self, name)
            if len(grid) != self.rows or any(len(r) != self.cols for r in grid):
                raise ValueError(f"{name} grid does not match rows x cols")
            if any(not 0.0 <= v <= 1.0 for r in grid for v in r):
                raise ValueError(f"{name} values must be in [0, 1]")
        if self.model not in MODEL_INDEX:
            raise ValueError(f"unknown model {self.model}")
        if self.prize_every == 1:
            raise ValueError("prize_every must be 0 (off) or >= 2")
        return self
