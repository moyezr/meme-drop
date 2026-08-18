from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from botocore.exceptions import ClientError  # type: ignore[import-untyped]

from memedrop_api.config import Settings
from memedrop_api.services.storage import (
    LocalMemeStorage,
    S3MemeStorage,
    StorageObjectNotFoundError,
    StorageObjectTooLargeError,
    object_key_from_public_path,
    public_path_for_key,
    validate_object_key,
)


class FakeBody:
    def __init__(self, content: bytes) -> None:
        self.content = content
        self.closed = False
        self.read_amounts: list[int | None] = []

    def read(self, amount: int | None = None) -> bytes:
        self.read_amounts.append(amount)
        if amount is None:
            return self.content
        return self.content[:amount]

    def close(self) -> None:
        self.closed = True


class FakeS3Client:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.head_buckets: list[str] = []
        self.reported_content_length: int | None = None
        self.last_body: FakeBody | None = None

    def head_bucket(self, *, Bucket: str) -> None:
        self.head_buckets.append(Bucket)

    def upload_file(self, source: str, bucket: str, key: str, *, ExtraArgs: dict[str, str]) -> None:
        assert ExtraArgs["ContentType"].startswith("image/")
        self.objects[(bucket, key)] = Path(source).read_bytes()

    def put_object(self, **arguments: Any) -> None:
        self.objects[(arguments["Bucket"], arguments["Key"])] = arguments["Body"]

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        try:
            content = self.objects[(Bucket, Key)]
        except KeyError as error:
            raise ClientError(
                {"Error": {"Code": "NoSuchKey", "Message": "Not Found"}},
                "GetObject",
            ) from error
        self.last_body = FakeBody(content)
        return {
            "Body": self.last_body,
            "ContentLength": self.reported_content_length or len(content),
            "ContentType": "image/png",
        }

    def delete_object(self, *, Bucket: str, Key: str) -> None:
        self.objects.pop((Bucket, Key), None)


def s3_settings(*, max_image_bytes: int = 8 * 1024 * 1024) -> Settings:
    return Settings(
        database_url="postgresql://localhost/test",
        storage_backend="s3",
        s3_bucket_name="meme-drop-dev",
        s3_endpoint="https://project.storage.supabase.co/storage/v1/s3",
        s3_region="ap-south-1",
        s3_access_key_id="access-key",
        s3_secret_access_key="secret-key",
        max_image_bytes=max_image_bytes,
    )


@pytest.mark.parametrize("key", ["", "/absolute.png", "../secret", "catalog/../secret", "bad\\key"])
def test_storage_keys_reject_unsafe_paths(key: str) -> None:
    with pytest.raises(ValueError, match="Invalid storage object key"):
        validate_object_key(key)


def test_public_path_round_trip() -> None:
    key = "users/11111111-1111-4111-8111-111111111111/reaction.png"

    assert public_path_for_key(key) == f"/memes/{key}"
    assert object_key_from_public_path(f"/memes/{key}") == key
    assert object_key_from_public_path("/memes/../secret") is None
    assert object_key_from_public_path("/other/reaction.png") is None


async def test_local_storage_moves_and_deletes_nested_files(tmp_path: Path) -> None:
    source = tmp_path / "download.png"
    source.write_bytes(b"image")
    storage = LocalMemeStorage(tmp_path / "storage")

    public_path = await storage.put_file(source, "users/test/download.png")

    assert public_path == "/memes/users/test/download.png"
    assert source.exists() is False
    assert (tmp_path / "storage/users/test/download.png").read_bytes() == b"image"
    assert await storage.delete(public_path) is True
    assert await storage.delete(public_path) is False


async def test_local_storage_reads_bytes_with_content_type(tmp_path: Path) -> None:
    storage = LocalMemeStorage(tmp_path / "storage")
    public_path = await storage.put_bytes("catalog/reaction.png", b"image")

    stored_object = await storage.read_bytes(public_path)

    assert stored_object.content == b"image"
    assert stored_object.content_type == "image/png"


@pytest.mark.parametrize("public_path", ["/other/image.png", "/memes/../secret"])
async def test_local_storage_rejects_invalid_public_paths(tmp_path: Path, public_path: str) -> None:
    storage = LocalMemeStorage(tmp_path / "storage")

    with pytest.raises(StorageObjectNotFoundError):
        await storage.read_bytes(public_path)


async def test_local_storage_rejects_missing_and_oversize_objects(tmp_path: Path) -> None:
    storage = LocalMemeStorage(tmp_path / "storage", max_object_bytes=4)

    with pytest.raises(StorageObjectNotFoundError):
        await storage.read_bytes("/memes/catalog/missing.png")

    public_path = await storage.put_bytes("catalog/large.png", b"large")
    with pytest.raises(StorageObjectTooLargeError):
        await storage.read_bytes(public_path)


async def test_s3_storage_uses_environment_bucket_for_all_operations(tmp_path: Path) -> None:
    source = tmp_path / "reaction.png"
    source.write_bytes(b"image")
    client = FakeS3Client()
    storage = S3MemeStorage(s3_settings(), client=client)

    public_path = await storage.put_file(source, "users/test/reaction.png")
    response = await storage.serve(public_path)

    assert storage.bucket == "meme-drop-dev"
    assert client.objects[("meme-drop-dev", "users/test/reaction.png")] == b"image"
    assert response.status_code == 200
    assert response.body == b"image"
    assert response.media_type == "image/png"
    assert "s-maxage=86400" in response.headers["cache-control"]
    assert await storage.delete(public_path) is True
    assert client.objects == {}


async def test_s3_storage_reads_bytes_with_content_type() -> None:
    client = FakeS3Client()
    client.objects[("meme-drop-dev", "catalog/reaction.png")] = b"image"
    storage = S3MemeStorage(s3_settings(), client=client)

    stored_object = await storage.read_bytes("/memes/catalog/reaction.png")

    assert stored_object.content == b"image"
    assert stored_object.content_type == "image/png"
    assert client.last_body is not None
    assert client.last_body.closed is True


async def test_s3_storage_rejects_invalid_and_missing_public_paths() -> None:
    client = FakeS3Client()
    storage = S3MemeStorage(s3_settings(), client=client)

    with pytest.raises(StorageObjectNotFoundError):
        await storage.read_bytes("/other/reaction.png")
    with pytest.raises(StorageObjectNotFoundError):
        await storage.read_bytes("/memes/catalog/missing.png")


async def test_s3_storage_bounds_reads_when_content_length_is_inaccurate() -> None:
    client = FakeS3Client()
    client.objects[("meme-drop-dev", "catalog/large.png")] = b"larger"
    client.reported_content_length = 1
    storage = S3MemeStorage(s3_settings(max_image_bytes=4), client=client)

    with pytest.raises(StorageObjectTooLargeError):
        await storage.read_bytes("/memes/catalog/large.png")

    assert client.last_body is not None
    assert client.last_body.read_amounts == [5]
    assert client.last_body.closed is True


async def test_s3_latency_check_cleans_up_probe_object() -> None:
    client = FakeS3Client()
    storage = S3MemeStorage(s3_settings(), client=client)

    report = await storage.check(include_write=True)

    assert report["backend"] == "s3"
    assert report["bucket"] == "meme-drop-dev"
    assert all(name in report for name in ("check_ms", "write_ms", "read_ms", "delete_ms"))
    assert client.head_buckets == ["meme-drop-dev"]
    assert client.objects == {}
