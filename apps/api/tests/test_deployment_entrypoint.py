from fastapi import FastAPI

from app import app


def test_vercel_entrypoint_exports_fastapi_application() -> None:
    assert isinstance(app, FastAPI)
    assert app.title == "MemeDrop API"
