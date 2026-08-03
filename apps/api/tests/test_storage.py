from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from memedrop_api.config import Settings
from memedrop_api.services.storage import (
    LocalMemeStorage,
    S3MemeStorage,
    object_key_from_public_path,
    public_path_for_key,
    validate_object_key,
)


class FakeBody:
    def __init__(self, content: bytes) -> None:
        self.content = content
        self.closed = False

    def read(self) -> bytes:
        return self.content

    def close(self) -> None:
        self.closed = True


class FakeS3Client:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.head_buckets: list[str] = []

    def head_bucket(self, *, Bucket: str) -> None:
        self.head_buckets.append(Bucket)

    def upload_file(
        self, source: str, bucket: str, key: str, *, ExtraArgs: dict[str, str]
    ) -> None:
        assert ExtraArgs["ContentType"].startswith("image/")
        self.objects[(bucket, key)] = Path(source).read_bytes()

    def put_object(self, **arguments: Any) -> None:
        self.objects[(arguments["Bucket"], arguments["Key"])] = arguments["Body"]

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        content = self.objects[(Bucket, Key)]
        return {
            "Body": FakeBody(content),
            "ContentLength": len(content),
            "ContentType": "image/png",
        }

    def delete_object(self, *, Bucket: str, Key: str) -> None:
        self.objects.pop((Bucket, Key), None)

def s3_settings() -> Settings:
    return Settings(
        database_url="postgresql://localhost/test",
        storage_backend="s3",
        s3_endpoint="https://project.storage.supabase.co/storage/v1/s3",
        s3_region="ap-south-1",
        s3_access_key_id="access-key",
        s3_secret_access_key="secret-key",
    )


@pytest.mark.parametrize(
    "key", ["", "/absolute.png", "../secret", "catalog/../secret", "bad\\key"]
)
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


async def test_s3_latency_check_cleans_up_probe_object() -> None:
    client = FakeS3Client()
    storage = S3MemeStorage(s3_settings(), client=client)

    report = await storage.check(include_write=True)

    assert report["backend"] == "s3"
    assert report["bucket"] == "meme-drop-dev"
    assert all(name in report for name in ("check_ms", "write_ms", "read_ms", "delete_ms"))
    assert client.head_buckets == ["meme-drop-dev"]
    assert client.objects == {}
