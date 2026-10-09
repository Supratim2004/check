from dataclasses import dataclass
from typing import Any, TypedDict

@dataclass(frozen=True)
class Options:
    types: tuple[str, ...] = ()
    smoothing: str = 'actual'
    side: str = 'all'
    search: str = ''
    page: int = 0

class Result(TypedDict, total=False):
    rows: list[dict[str, Any]]
    labels: list[str]
    series: list[dict[str, Any]]
    observations: list[dict[str, str]]
    units: str
