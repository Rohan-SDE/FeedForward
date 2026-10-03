from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException, status

from .config import Settings


class SupabaseGateway:
    """Small async gateway for Supabase Auth, PostgREST and RPC."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.base = settings.supabase_url.rstrip("/")
        self._client: httpx.AsyncClient | None = None

    def _http_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(25.0, connect=5.0),
                limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()

    def _headers(self, token: str | None = None, admin: bool = False) -> dict[str, str]:
        key = (
            self.settings.supabase_service_role_key
            if admin
            else self.settings.supabase_publishable_key
        )
        headers = {"apikey": key, "Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        elif key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {key}"
        return headers

    async def user(self, token: str) -> dict[str, Any]:
        try:
            response = await self._http_client().get(
                f"{self.base}/auth/v1/user", headers=self._headers(token=token)
            )
        except httpx.RequestError as error:
            raise HTTPException(status_code=503, detail="Authentication service is unavailable") from error
        if response.status_code == 429 or response.status_code >= 500:
            raise HTTPException(status_code=503, detail="Authentication service is unavailable")
        if response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Your session is invalid or expired. Please sign in again.",
            )
        return response.json()

    async def request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        admin: bool = False,
        params: dict[str, Any] | None = None,
        json: Any = None,
        prefer: str | None = None,
    ) -> Any:
        headers = self._headers(token=token, admin=admin)
        if prefer:
            headers["Prefer"] = prefer
        try:
            response = await self._http_client().request(
                method, f"{self.base}/rest/v1/{path.lstrip('/')}",
                headers=headers, params=params, json=json,
            )
        except httpx.RequestError as error:
            # Never retry mutations: the upstream may already have committed.
            raise HTTPException(status_code=503, detail="Database service is unavailable") from error
        if response.status_code >= 400:
            try:
                payload = response.json()
            except ValueError:
                payload = {}
            code = payload.get("code") if isinstance(payload, dict) else None
            if response.status_code >= 500 or response.status_code == 429:
                raise HTTPException(status_code=503, detail="Database service is unavailable")
            if response.status_code in (401, 403):
                raise HTTPException(status_code=response.status_code, detail="This operation is not permitted")
            if code == "23505":
                raise HTTPException(status_code=409, detail="This record already exists")
            # Only application-defined exceptions can expose their deliberate user message.
            message = payload.get("message") if isinstance(payload, dict) and code == "P0001" else None
            raise HTTPException(status_code=400, detail=message or "The request could not be completed")
        if not response.content:
            return None
        return response.json()

    async def upload_photo(self, path: str, content: bytes) -> str:
        headers = self._headers(admin=True)
        headers["Content-Type"] = "image/jpeg"
        headers["x-upsert"] = "false"
        # Storage accepts the legacy service-role JWT as Authorization, while
        # new sb_secret keys belong only in apikey (they are not bearer JWTs).
        key = self.settings.supabase_service_role_key
        if key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {key}"
        try:
            response = await self._http_client().post(
                f"{self.base}/storage/v1/object/food-photos/{path}",
                headers=headers, content=content,
            )
        except httpx.RequestError as error:
            raise HTTPException(status_code=503, detail="Photo storage is unavailable") from error
        if response.status_code >= 400:
            raise HTTPException(status_code=503, detail="Photo could not be stored")
        return f"{self.base}/storage/v1/object/public/food-photos/{path}"

    async def delete_photo(self, path: str) -> None:
        headers = self._headers(admin=True)
        key = self.settings.supabase_service_role_key
        if key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {key}"
        response = await self._http_client().delete(
            f"{self.base}/storage/v1/object/food-photos/{path}", headers=headers,
        )
        if response.status_code >= 400 and response.status_code != 404:
            raise HTTPException(status_code=503, detail="Photo cleanup failed")

    async def rows(
        self,
        table: str,
        *,
        token: str | None = None,
        admin: bool = False,
        select: str = "*",
        filters: dict[str, str] | None = None,
        order: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"select": select}
        params.update(filters or {})
        if order:
            params["order"] = order
        if limit:
            params["limit"] = str(limit)
        result = await self.request(
            "GET", table, token=token, admin=admin, params=params
        )
        return result or []

    async def rpc(
        self, name: str, body: dict[str, Any], *, token: str
    ) -> Any:
        return await self.request("POST", f"rpc/{name}", token=token, json=body)


def eq(value: Any) -> str:
    return f"eq.{quote(str(value), safe='')}"
