import importlib
import json
from functools import lru_cache
from pathlib import Path
from threading import RLock
from app.domain.context import Context

class Analytics:

    def __init__(self, repo, registry=None):
        self.repo = repo
        self.registry = json.loads((Path(__file__).parents[1] / 'components' / 'registry.json').read_text()) if registry is None else registry
        self.lock = RLock()

    @lru_cache(maxsize=16)
    def context(self, snapshot, court, start, end):
        return Context(self.repo, snapshot, court, start, end)

    @lru_cache(maxsize=256)
    def result(self, snapshot, definition_version, component, court, start, end, options):
        with self.lock:
            ctx = self.context(snapshot, court, start, end)
            module = importlib.import_module('app.components.' + self.registry[component]['module'])
            return {**module.calculate(ctx, options), 'meta': ctx.summary()}

    @lru_cache(maxsize=32)
    def compare(self, start, end, court, districts=()):
        from app.compare import build
        with self.lock:
            return build(self, start, end, court, districts)

    @lru_cache(maxsize=128)
    def compare_measure(self, metric, start, end, a, b, side='all', names=(), limit=6):
        from app.compare import measure_pair
        with self.lock:
            return measure_pair(self, metric, start, end, a, b, side, names, limit)
