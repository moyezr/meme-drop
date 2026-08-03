from __future__ import annotations

import asyncio
import mimetypes
import shutil
from pathlib import Path, PurePosixPath
from time import perf_counter
from typing import Any, Protocol
from uuid import uuid4

import boto3  # type: ignore[import-untyped]
from botocore.config import Config as BotoConfig  # type: ignore[import-untyped]
from botocore.exceptions import ClientError  # type: ignore[import-untyped]
from fastapi import HTTPException
from starlette.responses import FileResponse, Response

from memedrop_api.config import Settings

PUBLIC_PREFIX = "/memes/"


class MemeStorage(Protocol):
    async def put_file(self, source: Path, object_key: str) -> str: ...

    async def put_bytes(
        self, object_key: str, content: bytes, *, content_type: str | None = None
    ) -> str: ...

    async def delete(self, public_path: str) -> bool: ...

    async def serve(self, public_path: str) -> Response: ...

    async def check(self, *, include_write: bool = False) -> dict[str, float | str]: ...


def public_path_for_key(object_key: str) -> str:
    return f"{PUBLIC_PREFIX}{validate_object_key(object_key)}"


def object_key_from_public_path(public_path: str) -> str | None:
    if not public_path.startswith(PUBLIC_PREFIX):
        return None
    try:
        return validate_object_key(public_path.removeprefix(PUBLIC_PREFIX))
    except ValueError:
        return None


def validate_object_key(object_key: str) -> str:
    key = object_key.strip("/")
    path = PurePosixPath(key)
    if (
        not key
        or key != object_key
        or "\\" in key
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise ValueError("Invalid storage object key")
    return key


class LocalMemeStorage:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    async def put_file(self, source: Path, object_key: str) -> str:
        destination = self._path(object_key)
        await asyncio.to_thread(destination.parent.mkdir, parents=True, exist_ok=True)
        source_path = await asyncio.to_thread(source.resolve)
        if source_path != destination:
            await asyncio.to_thread(shutil.move, str(source), str(destination))
        return public_path_for_key(object_key)

    async def put_bytes(
        self, object_key: str, content: bytes, *, content_type: str | None = None
    ) -> str:
        del content_type
        destination = self._path(object_key)
        await asyncio.to_thread(destination.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(destination.write_bytes, content)
        return public_path_for_key(object_key)

    async def delete(self, public_path: str) -> bool:
        object_key = object_key_from_public_path(public_path)
        if object_key is None:
            return False
        try:
            await asyncio.to_thread(self._path(object_key).unlink)
            return True
        except FileNotFoundError:
            return False

    async def serve(self, public_path: str) -> Response:
        object_key = object_key_from_public_path(public_path)
        if object_key is None:
            raise HTTPException(status_code=404, detail="Not Found")
        file_path = self._path(object_key)
        if not file_path.is_file():
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(file_path)

    async def check(self, *, include_write: bool = False) -> dict[str, float | str]:
        started = perf_counter()
        await asyncio.to_thread(self.root.mkdir, parents=True, exist_ok=True)
        result: dict[str, float | str] = {
            "backend": "local",
            "check_ms": _elapsed_ms(started),
        }
        if include_write:
            object_key = f"_health/{uuid4()}.txt"
            write_started = perf_counter()
            public_path = await self.put_bytes(object_key, b"memedrop-storage-check")
            result["write_ms"] = _elapsed_ms(write_started)
            read_started = perf_counter()
            await asyncio.to_thread(self._path(object_key).read_bytes)
            result["read_ms"] = _elapsed_ms(read_started)
            delete_started = perf_counter()
            await self.delete(public_path)
            result["delete_ms"] = _elapsed_ms(delete_started)
        return result

    def _path(self, object_key: str) -> Path:
        candidate = (self.root / validate_object_key(object_key)).resolve()
        if not candidate.is_relative_to(self.root):
            raise ValueError("Storage path escaped its root")
        return candidate


class S3MemeStorage:
    def __init__(self, settings: Settings, *, client: Any | None = None) -> None:
        self.bucket = settings.storage_bucket
        self.max_object_bytes = settings.max_image_bytes
        self.client = client or boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            config=BotoConfig(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )

    async def put_file(self, source: Path, object_key: str) -> str:
        key = validate_object_key(object_key)
        content_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
        await asyncio.to_thread(
            self.client.upload_file,
            str(source),
            self.bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )
        return public_path_for_key(key)

    async def put_bytes(
        self, object_key: str, content: bytes, *, content_type: str | None = None
    ) -> str:
        key = validate_object_key(object_key)
        arguments: dict[str, Any] = {"Bucket": self.bucket, "Key": key, "Body": content}
        if content_type:
            arguments["ContentType"] = content_type
        await asyncio.to_thread(self.client.put_object, **arguments)
        return public_path_for_key(key)

    async def delete(self, public_path: str) -> bool:
        object_key = object_key_from_public_path(public_path)
        if object_key is None:
            return False
        await asyncio.to_thread(
            self.client.delete_object, Bucket=self.bucket, Key=object_key
        )
        return True

    async def serve(self, public_path: str) -> Response:
        object_key = object_key_from_public_path(public_path)
        if object_key is None:
            raise HTTPException(status_code=404, detail="Not Found")
        try:
            result = await asyncio.to_thread(
                self.client.get_object, Bucket=self.bucket, Key=object_key
            )
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in {"404", "NoSuchKey"}:
                raise HTTPException(status_code=404, detail="Not Found") from error
            raise
        if int(result.get("ContentLength", 0)) > self.max_object_bytes:
            raise HTTPException(status_code=502, detail="Stored image is too large")
        body = result["Body"]
        content = await asyncio.to_thread(body.read)
        body.close()
        if len(content) > self.max_object_bytes:
            raise HTTPException(status_code=502, detail="Stored image is too large")
        return Response(
            content=content,
            media_type=result.get("ContentType", "application/octet-stream"),
            headers={
                "Cache-Control": (
                    "public, max-age=3600, s-maxage=86400, "
                    "stale-while-revalidate=604800"
                )
            },
        )

    async def check(self, *, include_write: bool = False) -> dict[str, float | str]:
        started = perf_counter()
        await asyncio.to_thread(self.client.head_bucket, Bucket=self.bucket)
        result: dict[str, float | str] = {
            "backend": "s3",
            "bucket": self.bucket,
            "check_ms": _elapsed_ms(started),
        }
        if not include_write:
            return result

        object_key = f"_health/{uuid4()}.txt"
        try:
            write_started = perf_counter()
            await self.put_bytes(object_key, b"memedrop-storage-check", content_type="text/plain")
            result["write_ms"] = _elapsed_ms(write_started)

            read_started = perf_counter()
            response = await asyncio.to_thread(
                self.client.get_object, Bucket=self.bucket, Key=object_key
            )
            body = response["Body"]
            await asyncio.to_thread(body.read)
            body.close()
            result["read_ms"] = _elapsed_ms(read_started)
        finally:
            delete_started = perf_counter()
            await asyncio.to_thread(
                self.client.delete_object, Bucket=self.bucket, Key=object_key
            )
            result["delete_ms"] = _elapsed_ms(delete_started)
        return result


def create_meme_storage(settings: Settings) -> MemeStorage:
    if settings.storage_backend == "s3":
        return S3MemeStorage(settings)
    return LocalMemeStorage(settings.meme_storage_path)


def _elapsed_ms(started: float) -> float:
    return round((perf_counter() - started) * 1000, 2)
