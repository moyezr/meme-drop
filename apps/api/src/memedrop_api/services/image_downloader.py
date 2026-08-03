from __future__ import annotations

import asyncio
import ipaddress
import mimetypes
import socket
from collections.abc import Awaitable, Callable
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

from memedrop_api.config import Settings

Resolver = Callable[[str], Awaitable[list[str]]]
MIME_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


async def download_image(
    image_url: str,
    settings: Settings,
    *,
    client: httpx.AsyncClient | None = None,
    resolver: Resolver | None = None,
) -> tuple[Path, str]:
    parsed = urlsplit(image_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Only absolute http(s) image URLs are allowed")
    if parsed.username or parsed.password:
        raise ValueError("Image URLs must not contain credentials")
    await assert_hostname_resolves_publicly(parsed.hostname, resolver=resolver)

    owns_client = client is None
    request_client = client or httpx.AsyncClient(
        timeout=settings.image_download_timeout_ms / 1000,
        follow_redirects=False,
    )
    try:
        response = await request_client.get(image_url)
        response.raise_for_status()
    finally:
        if owns_client:
            await request_client.aclose()

    content_type = response.headers.get("content-type", "image/jpeg").split(";", 1)[0].lower()
    if not content_type.startswith("image/"):
        raise ValueError(f"Refusing to save non-image response: {content_type}")
    declared_size = int(response.headers.get("content-length", "0") or 0)
    if declared_size > settings.max_image_bytes or len(response.content) > settings.max_image_bytes:
        raise ValueError("Image is too large")

    extension = MIME_EXTENSIONS.get(content_type)
    if extension is None:
        guessed = Path(parsed.path).suffix.lower()
        extension = (
            guessed
            if guessed in {".jpg", ".jpeg", ".png", ".webp", ".gif"}
            else mimetypes.guess_extension(content_type) or ".jpg"
        )
    file_name = f"{uuid4()}{extension}"
    file_path = settings.meme_storage_path / file_name
    await asyncio.to_thread(file_path.parent.mkdir, parents=True, exist_ok=True)
    await asyncio.to_thread(file_path.write_bytes, response.content)
    return file_path, file_name


async def resolve_hostname(hostname: str) -> list[str]:
    entries = await asyncio.to_thread(
        socket.getaddrinfo, hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM
    )
    return list({str(entry[4][0]) for entry in entries})


async def assert_hostname_resolves_publicly(
    hostname: str, *, resolver: Resolver | None = None
) -> None:
    if hostname.lower() == "localhost":
        raise ValueError("Refusing to fetch local or private image URL")
    try:
        literal = ipaddress.ip_address(hostname)
        addresses = [str(literal)]
    except ValueError:
        addresses = await (resolver or resolve_hostname)(hostname)
    if not addresses:
        raise ValueError("image_url hostname did not resolve")
    for address in addresses:
        if is_private_or_reserved_ip(address):
            raise ValueError(f"Refusing to fetch image URL that resolves to private IP {address}")


def is_private_or_reserved_ip(address: str) -> bool:
    try:
        parsed = ipaddress.ip_address(address)
        return not parsed.is_global or parsed.is_multicast
    except ValueError:
        return True


def stored_image_path(public_path: str, storage_path: Path) -> Path | None:
    prefix = "/memes/"
    if not public_path.startswith(prefix):
        return None
    file_name = public_path.removeprefix(prefix)
    if not file_name or Path(file_name).name != file_name:
        return None
    return storage_path / file_name


async def delete_stored_image(public_path: str, storage_path: Path) -> bool:
    file_path = stored_image_path(public_path, storage_path)
    if file_path is None:
        return False
    try:
        await asyncio.to_thread(file_path.unlink)
        return True
    except FileNotFoundError:
        return False
