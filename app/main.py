from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from app.api.routes import router
from app.bootstrap import ensure_loaded
from app.config import ROOT, DB_PATH, SOURCE_DATA_DIR
from app.repository import Repository
from app.processing.service import Analytics

def create_app(db_path=DB_PATH, registry=None, source_dir=SOURCE_DATA_DIR):

    @asynccontextmanager
    async def lifespan(app):
        repo = Repository(db_path)
        # In-memory mode: build the database from the CSVs before the first request is served.
        # File mode: unchanged; data comes from an explicit `python -m app.cli` import.
        ensure_loaded(repo, source_dir)
        app.state.analytics = Analytics(repo, registry)
        yield
    app = FastAPI(title='Docket Intelligence · Raw CSV Analytics', version='2.0.0', lifespan=lifespan)
    app.include_router(router)
    app.mount('/static', StaticFiles(directory=ROOT / 'app' / 'static'), name='static')

    @app.get('/', include_in_schema=False)
    def index():
        return FileResponse(ROOT / 'app' / 'static' / 'index.html')
    return app
app = create_app()
