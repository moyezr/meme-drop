from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from memedrop_api.config import Settings
from memedrop_api.services.image_downloader import (
    assert_hostname_resolves_publicly,
    download_image,
    is_private_or_reserved_ip,
)


@pytest.mark.parametrize(
    "address",
    [
        "0.0.0.0",
        "10.0.0.1",
        "100.64.0.1",
        "127.0.0.1",
        "169.254.1.1",
        "172.16.0.1",
        "192.0.2.1",
        "192.168.1.1",
        "198.18.0.1",
        "224.0.0.1",
        "::",
        "::1",
        "::ffff:127.0.0.1",
        "fc00::1",
        "fe80::1",
        "ff02::1",
        "2001:db8::1",
    ],
)
def test_private_and_reserved_addresses_are_blocked(address: str) -> None:
    assert is_private_or_reserved_ip(address) is True


@pytest.mark.parametrize("address", ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])
def test_public_addresses_are_allowed(address: str) -> None:
    assert is_private_or_reserved_ip(address) is False


async def test_hostname_resolver_rejects_any_private_result() -> None:
    async def mixed(_: str) -> list[str]:
        return ["93.184.216.34", "127.0.0.1"]

    with pytest.raises(ValueError, match="private IP"):
        await assert_hostname_resolves_publicly("example.com", resolver=mixed)


async def test_download_image_validates_content_and_writes_file(tmp_path: Path) -> None:
    settings = Settings(
        database_url="postgresql://localhost/test",
        image_download_path=tmp_path,
        max_image_bytes=100,
    )

    async def public(_: str) -> list[str]:
        return ["93.184.216.34"]

    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200, headers={"content-type": "image/png"}, content=b"png-bytes", request=request
        )
    )
    async with httpx.AsyncClient(transport=transport) as client:
        file_path, file_name = await download_image(
            "https://example.com/meme.png", settings, client=client, resolver=public
        )

    assert file_name.endswith(".png")
    assert file_path.read_bytes() == b"png-bytes"


async def test_download_rejects_non_image_and_oversized_body(tmp_path: Path) -> None:
    settings = Settings(
        database_url="postgresql://localhost/test",
        image_download_path=tmp_path,
        max_image_bytes=4,
    )

    async def public(_: str) -> list[str]:
        return ["93.184.216.34"]

    non_image = httpx.MockTransport(
        lambda request: httpx.Response(
            200, headers={"content-type": "text/html"}, content=b"no", request=request
        )
    )
    oversized = httpx.MockTransport(
        lambda request: httpx.Response(
            200, headers={"content-type": "image/png"}, content=b"12345", request=request
        )
    )
    async with httpx.AsyncClient(transport=non_image) as client:
        with pytest.raises(ValueError, match="non-image"):
            await download_image("https://example.com/a", settings, client=client, resolver=public)
    async with httpx.AsyncClient(transport=oversized) as client:
        with pytest.raises(ValueError, match="too large"):
            await download_image(
                "https://example.com/a.png", settings, client=client, resolver=public
            )
