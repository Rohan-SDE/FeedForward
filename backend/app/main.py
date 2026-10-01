import asyncio
import math
import logging
import time
from uuid import uuid4
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import AwareDatetime, BaseModel, Field, HttpUrl, model_validator

from .maintenance import run_loop
from .request_limits import BodyLimitMiddleware
from .photos import MAX_UPLOAD_BYTES, normalize_photo
from .config import Settings, get_settings
from .supabase import SupabaseGateway, eq


class CurrentUser(BaseModel):
    id: UUID
    token: str


class ProfilePatch(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    org_name: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=32)
    address: str | None = Field(default=None, max_length=300)
    city: str | None = Field(default=None, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    service_radius_km: float = Field(default=10, ge=1, le=200)
    food_preferences: list[str] | None = None


class RoleInput(BaseModel):
    role: Literal["donor", "ngo", "volunteer"]


class ListingInput(BaseModel):
    title: str = Field(min_length=3, max_length=140)
    food_type: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=1000)
    quantity: float = Field(gt=0, le=100000)
    unit: Literal["servings", "kg"]
    diet: Literal["veg", "non_veg", "vegan", "mixed"]
    allergens: str | None = Field(default=None, max_length=300)
    storage: Literal["hot", "refrigerated", "frozen", "room_temp"]
    photo_url: HttpUrl | None = None
    prepared_at: AwareDatetime
    best_before: AwareDatetime
    pickup_address: str = Field(min_length=4, max_length=300)
    city: str | None = Field(default=None, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def validate_dates(self) -> "ListingInput":
        if self.best_before <= self.prepared_at:
            raise ValueError("Best-before must be later than the preparation time")
        if self.best_before <= datetime.now(timezone.utc):
            raise ValueError("Food must have a future best-before time")
        if self.prepared_at > datetime.now(timezone.utc):
            raise ValueError("Preparation time cannot be in the future")
        return self


class IdInput(BaseModel):
    id: UUID


class ClaimInput(BaseModel):
    listing_id: UUID
    claimed_quantity: float = Field(gt=0, le=100000)
    note: str | None = Field(default=None, max_length=400)


class ScheduleInput(BaseModel):
    claim_id: UUID
    scheduled_time: AwareDatetime


class PickupInput(BaseModel):
    pickup_id: UUID


class PinInput(BaseModel):
    pickup_id: UUID
    pin: str = Field(pattern=r"^\d{6}$")


class AdvanceInput(BaseModel):
    id: UUID
    status: Literal["en_route", "picked_up", "delivered", "completed", "cancelled"]


class FeedbackInput(BaseModel):
    pickup_id: UUID
    category: Literal["delivery_partner", "food", "food_receiver", "restaurant"]
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=3, max_length=1000)


class VerifyProfileInput(BaseModel):
    id: UUID
    verified: bool


class Point(BaseModel):
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lng: float = Field(ge=-180, le=180, allow_inf_nan=False)


class Stop(Point):
    id: str
    label: str = Field(max_length=200)


class RouteInput(BaseModel):
    origin: Point
    stops: list[Stop] = Field(min_length=1, max_length=9)


settings = get_settings()
gateway = SupabaseGateway(settings)
photo_decode_slots = asyncio.Semaphore(2)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Also run on single-service hosts without a separate maintenance worker.
    # The database uses row locks + SKIP LOCKED for multiple API workers.
    maintenance_task = asyncio.create_task(run_loop(gateway))
    try:
        yield
    finally:
        maintenance_task.cancel()
        with suppress(asyncio.CancelledError):
            await maintenance_task
        await gateway.close()


production = settings.environment.lower() == "production"
app = FastAPI(
    title=settings.app_name,
    version="1.1.0",
    lifespan=lifespan,
    docs_url=None if production else "/docs",
    redoc_url=None if production else "/redoc",
    openapi_url=None if production else "/openapi.json",
)
app.add_middleware(BodyLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    request_id = str(uuid4())
    started = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        logging.getLogger("feedforward").error("request_failed request_id=%s", request_id)
        response = JSONResponse(status_code=500, content={"detail": "An unexpected error occurred", "requestId": request_id})
    logging.getLogger("uvicorn.error").info(
        "request_id=%s method=%s status=%s duration_ms=%.1f",
        request_id, request.method, response.status_code, (time.monotonic() - started) * 1000,
    )
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


async def current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in is required")
    token = authorization.removeprefix("Bearer ").strip()
    auth_user = await gateway.user(token)
    return CurrentUser(id=auth_user["id"], token=token)


async def roles_for(user: CurrentUser) -> list[str]:
    rows = await gateway.rows(
        "user_roles", token=user.token, select="role", filters={"user_id": eq(user.id)}
    )
    return [str(item["role"]) for item in rows]


async def require_role(user: CurrentUser, *allowed: str) -> list[str]:
    roles = await roles_for(user)
    if not any(role in allowed for role in roles):
        raise HTTPException(status_code=403, detail=f"Requires role: {' or '.join(allowed)}")
    return roles


def haversine(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    radius = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lng - a_lng)
    value = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}


@app.get("/health/ready")
async def readiness() -> dict[str, str]:
    try:
        await gateway.rows("food_photos", admin=True, select="id", limit=1)
    except Exception as error:
        logging.getLogger("uvicorn.error").warning(
            "readiness_failed dependency=supabase error_type=%s gateway_status=%s",
            type(error).__name__,
            error.status_code if isinstance(error, HTTPException) else "unknown",
        )
        raise HTTPException(status_code=503, detail="Database is unavailable") from error
    return {"status": "ready", "service": settings.app_name}


@app.get("/api/me")
async def get_me(user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    profiles = await gateway.rows("profiles", token=user.token, filters={"id": eq(user.id)})
    return {"userId": str(user.id), "profile": profiles[0] if profiles else None, "roles": await roles_for(user)}


@app.get("/api/ngos/nearby")
async def nearby_ngos(user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    await require_role(user, "donor", "admin")
    profiles = await gateway.rows(
        "profiles", token=user.token, select="latitude,longitude,service_radius_km",
        filters={"id": eq(user.id)}, limit=1,
    )
    profile = profiles[0] if profiles else {}
    if profile.get("latitude") is None or profile.get("longitude") is None:
        return {"requiresLocation": True, "ngos": [], "searchLimited": False}
    radius = min(200, max(1, float(profile.get("service_radius_km") or 10)))
    roles = await gateway.rows("user_roles", admin=True, select="user_id",
                               filters={"role": "eq.ngo"}, order="user_id", limit=1000)
    ids = sorted({str(row["user_id"]) for row in roles})
    matches = []
    for start in range(0, len(ids), 100):
        candidates = await gateway.rows(
            "profiles", admin=True,
            select="id,org_name,city,verified,latitude,longitude",
            filters={"id": f"in.({','.join(ids[start:start + 100])})"},
        )
        for candidate in candidates:
            if candidate.get("latitude") is None or candidate.get("longitude") is None:
                continue
            distance = haversine(float(profile["latitude"]), float(profile["longitude"]),
                                 float(candidate["latitude"]), float(candidate["longitude"]))
            if distance <= radius:
                matches.append({"id": candidate["id"], "name": candidate.get("org_name") or "NGO",
                                "city": candidate.get("city"), "verified": bool(candidate.get("verified")),
                                "distanceKm": distance})
    matches.sort(key=lambda item: (item["distanceKm"], str(item["id"])))
    return {"requiresLocation": False, "radiusKm": radius, "ngos": matches[:50],
            "searchLimited": len(roles) >= 1000 or len(matches) > 50}


@app.patch("/api/profile")
async def save_profile(body: ProfilePatch, user: CurrentUser = Depends(current_user)) -> dict[str, bool]:
    # Omitted fields must preserve their stored values. Explicit null is
    # allowed for nullable fields (for example, clearing an address).
    payload = body.model_dump(exclude_unset=True)
    if payload.get("food_preferences") is None:
        payload.pop("food_preferences", None)

    updated = await gateway.request(
        "PATCH", "profiles", token=user.token,
        params={"id": eq(user.id), "select": "id"},
        json=payload, prefer="return=representation"
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Your profile could not be updated. Please sign in again.")
    return {"ok": True}


@app.post("/api/roles")
async def set_role(body: RoleInput, user: CurrentUser = Depends(current_user)) -> dict[str, bool]:
    existing = await roles_for(user)
    if existing:
        if body.role in existing:
            return {"ok": True}
        raise HTTPException(status_code=409, detail=f"Account is already registered as {existing[0]}")
    await gateway.request(
        "POST", "user_roles", token=user.token,
        json={"user_id": str(user.id), "role": body.role}, prefer="return=minimal"
    )
    return {"ok": True}


@app.post("/api/photos", status_code=201)
async def upload_food_photo(request: Request, user: CurrentUser = Depends(current_user)) -> dict[str, str]:
    await require_role(user, "donor", "admin")
    permitted = await gateway.request("POST", "rpc/reserve_photo_upload", admin=True, json={"_user": str(user.id)})
    if not permitted:
        raise HTTPException(status_code=429, detail="Photo upload limit reached. Try again later", headers={"Retry-After": "3600"})
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Choose a photo under 5 MB")
        data.extend(chunk)
    # CPU-bound decoding stays off the event loop.
    try:
        await asyncio.wait_for(photo_decode_slots.acquire(), timeout=1)
    except asyncio.TimeoutError as error:
        raise HTTPException(status_code=503, detail="Photo processing is busy. Try again shortly", headers={"Retry-After": "5"}) from error
    try:
        content = await asyncio.to_thread(normalize_photo, bytes(data))
    finally:
        photo_decode_slots.release()
    photo_id = uuid4()
    path = f"{user.id}/{photo_id}.jpg"
    url = await gateway.upload_photo(path, content)
    try:
        await gateway.request("POST", "food_photos", admin=True, json={
            "id": str(photo_id), "owner_id": str(user.id), "object_path": path, "public_url": url,
        })
    except Exception:
        try:
            await gateway.delete_photo(path)
        except Exception:
            logging.getLogger("feedforward").error("photo_cleanup_required photo_id=%s", photo_id)
        raise
    return {"url": url}


@app.post("/api/listings")
async def create_listing(body: ListingInput, user: CurrentUser = Depends(current_user)) -> dict[str, str]:
    await require_role(user, "donor", "admin")
    payload = body.model_dump(mode="json")
    payload["photo_url"] = str(body.photo_url) if body.photo_url else None
    payload["donor_id"] = str(user.id)
    rows = await gateway.request(
        "POST", "food_listings", token=user.token, params={"select": "id"},
        json=payload, prefer="return=representation"
    )
    return {"id": rows[0]["id"]}


@app.post("/api/listings/cancel")
async def cancel_listing(body: IdInput, user: CurrentUser = Depends(current_user)) -> dict[str, bool]:
    await require_role(user, "donor", "admin")
    await gateway.rpc("cancel_food_listing", {"_listing_id": str(body.id)}, token=user.token)
    return {"ok": True}


@app.get("/api/listings")
async def browse_listings(user: CurrentUser = Depends(current_user)) -> list[dict[str, Any]]:
    rows = await gateway.rows(
        "food_listings", admin=True,
        select="id,donor_id,title,food_type,description,quantity,unit,claimed_quantity,diet,allergens,storage,photo_url,prepared_at,best_before,city,status,created_at,latitude,longitude",
        filters={"status": "in.(posted,claimed,scheduled)", "best_before": f"gt.{datetime.now(timezone.utc).isoformat()}"}, order="best_before.asc", limit=200
    )
    donor_ids = sorted({row["donor_id"] for row in rows})
    donors = await gateway.rows(
        "profiles", admin=True, select="id,org_name,full_name,verified",
        filters={"id": f"in.({','.join(donor_ids)})"}
    ) if donor_ids else []
    by_id = {item["id"]: item for item in donors}
    for row in rows:
        for key in ("latitude", "longitude"):
            row[key] = round(float(row[key]), 2) if row.get(key) is not None else None
        row["area"] = row.get("city") or "Approximate area shown until claimed"
        row["donor"] = by_id.get(row["donor_id"])
    return rows


@app.get("/api/listings/mine")
async def my_listings(user: CurrentUser = Depends(current_user)) -> list[dict[str, Any]]:
    return await gateway.rows(
        "food_listings", token=user.token, select="*,claims(*)",
        filters={"donor_id": eq(user.id)}, order="created_at.desc"
    )


@app.post("/api/claims")
async def claim_listing(body: ClaimInput, user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    await require_role(user, "ngo")
    claim_id = await gateway.rpc("claim_food_listing", {
        "_listing_id": str(body.listing_id), "_claimed_quantity": body.claimed_quantity,
        "_note": body.note
    }, token=user.token)
    return {"id": claim_id}


class PresenceInput(BaseModel):
    available: bool
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class DeliveryLocationInput(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy: float = Field(ge=0, le=10000)


@app.post("/api/claims/with-delivery")
async def claim_with_delivery(body: ClaimInput, user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    await require_role(user, "ngo")
    result = await gateway.rpc("claim_with_delivery", {"_listing_id": str(body.listing_id),
        "_claimed_quantity": body.claimed_quantity, "_note": body.note}, token=user.token)
    return {"id": result}


@app.post("/api/riders/presence")
async def rider_presence(body: PresenceInput, user: CurrentUser = Depends(current_user)) -> dict[str, bool]:
    await require_role(user, "volunteer")
    await gateway.rpc("set_rider_presence", {"_available": body.available, "_latitude": body.latitude,
        "_longitude": body.longitude}, token=user.token)
    return {"ok": True}


@app.get("/api/pickups/{pickup_id}/location")
async def read_location(pickup_id: UUID, user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    result = await gateway.rpc("read_delivery_location", {"_pickup_id": str(pickup_id)}, token=user.token)
    return {"location": result[0] if result else None}


@app.post("/api/pickups/{pickup_id}/location")
async def share_location(pickup_id: UUID, body: DeliveryLocationInput, user: CurrentUser = Depends(current_user)) -> dict[str, bool]:
    await require_role(user, "volunteer")
    await gateway.rpc("share_delivery_location", {"_pickup_id": str(pickup_id), "_latitude": body.latitude,
        "_longitude": body.longitude, "_accuracy": body.accuracy}, token=user.token)
    return {"ok": True}


@app.post("/api/pickups/{pickup_id}/location/stop")
async def stop_location(pickup_id: UUID, user: CurrentUser = Depends(current_user)) -> dict[str, bool]:
    await gateway.rpc("stop_delivery_location", {"_pickup_id": str(pickup_id)}, token=user.token)
    return {"ok": True}


@app.get("/api/claims/mine")
async def my_claims(user: CurrentUser = Depends(current_user)) -> list[dict[str, Any]]:
    return await gateway.rows(
        "claims", token=user.token, select="*,food_listings(*),pickups(*)",
        filters={"ngo_id": eq(user.id)}, order="created_at.desc"
    )


@app.post("/api/claims/cancel")
async def cancel_claim(body: IdInput, user: CurrentUser = Depends(current_user)) -> dict[str, bool]:
    await require_role(user, "ngo", "admin")
    await gateway.rpc("cancel_food_claim", {"_claim_id": str(body.id)}, token=user.token)
    return {"ok": True}


@app.post("/api/pickups/request")
async def schedule_pickup(body: ScheduleInput, user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    await require_role(user, "ngo", "admin")
    result = await gateway.rpc("create_delivery_request", {"_claim_id": str(body.claim_id), "_scheduled_time": body.scheduled_time.isoformat()}, token=user.token)
    created = result[0] if isinstance(result, list) and result else None
    if not created:
        raise HTTPException(status_code=400, detail="Delivery request could not be created")
    try:
        await gateway.rpc("dispatch_my_request", {"_pickup_id": str(created["pickup_id"])}, token=user.token)
    except HTTPException:
        logging.getLogger("uvicorn.error").warning("dispatch_deferred")
    return {"ok": True, "pickupId": created["pickup_id"], "deliveryPin": created["delivery_pin"]}


@app.get("/api/delivery-requests/nearby")
async def nearby_requests(user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    await require_role(user, "volunteer")
    profiles = await gateway.rows("profiles", admin=True, select="latitude,longitude,service_radius_km,city", filters={"id": eq(user.id)})
    if not profiles or profiles[0].get("latitude") is None or profiles[0].get("longitude") is None:
        return {"requiresLocation": True, "requests": []}
    profile = profiles[0]
    pickups = await gateway.rows(
        "pickups", admin=True,
        select="id,scheduled_time,status,created_at,claims(id,claimed_quantity,food_listings(id,title,unit,food_type,city,latitude,longitude,best_before,photo_url))",
        filters={"volunteer_id": "is.null", "status": "eq.scheduled"}, order="created_at.desc", limit=100
    )
    radius = min(max(float(profile.get("service_radius_km") or 10), 1), 50)
    now = datetime.now(timezone.utc)
    result: list[dict[str, Any]] = []
    for pickup in pickups:
        claim = pickup.get("claims")
        listing = claim.get("food_listings") if claim else None
        if not listing or listing.get("latitude") is None or listing.get("longitude") is None:
            continue
        best_before = datetime.fromisoformat(listing["best_before"].replace("Z", "+00:00"))
        if best_before <= now:
            continue
        km = haversine(float(profile["latitude"]), float(profile["longitude"]), float(listing["latitude"]), float(listing["longitude"]))
        if km <= radius:
            result.append({
                "id": pickup["id"], "scheduled_time": pickup["scheduled_time"],
                "title": listing["title"], "food_type": listing["food_type"],
                "city": listing.get("city") or profile.get("city") or "Nearby area",
                "quantity": claim["claimed_quantity"], "unit": listing["unit"],
                "best_before": listing["best_before"], "photo_url": listing.get("photo_url"),
                "distance_km": round(km, 1)
            })
    result.sort(key=lambda item: item["distance_km"])
    return {"requiresLocation": False, "requests": result}


@app.post("/api/delivery-requests/accept")
async def accept_request(body: PickupInput, user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    await require_role(user, "volunteer")
    accepted = await gateway.rpc("accept_delivery_request", {"_pickup_id": str(body.pickup_id)}, token=user.token)
    if not accepted:
        raise HTTPException(status_code=409, detail="This delivery request is no longer available")
    return {"ok": True, "pickupId": str(body.pickup_id)}


@app.get("/api/notifications")
async def list_notifications(user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    items = await gateway.rows(
        "notifications",
        token=user.token,
        select="id,notification_type,title,message,action_url,entity_id,read_at,created_at",
        filters={"recipient_id": eq(user.id)},
        order="created_at.desc",
        limit=50,
    )
    return {
        "items": items,
        "unreadCount": sum(item.get("read_at") is None for item in items),
    }


@app.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: UUID,
    user: CurrentUser = Depends(current_user),
) -> dict[str, bool]:
    updated = await gateway.request(
        "PATCH",
        "notifications",
        token=user.token,
        params={
            "id": eq(notification_id),
            "recipient_id": eq(user.id),
            "select": "id",
        },
        json={"read_at": datetime.now(timezone.utc).isoformat()},
        prefer="return=representation",
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@app.post("/api/notifications/read-all")
async def mark_all_notifications_read(
    user: CurrentUser = Depends(current_user),
) -> dict[str, bool]:
    await gateway.request(
        "PATCH",
        "notifications",
        token=user.token,
        params={"recipient_id": eq(user.id), "read_at": "is.null"},
        json={"read_at": datetime.now(timezone.utc).isoformat()},
        prefer="return=minimal",
    )
    return {"ok": True}


@app.get("/api/delivery-pins")
async def delivery_pins(user: CurrentUser = Depends(current_user)) -> list[dict[str, Any]]:
    await require_role(user, "ngo", "admin")
    return await gateway.rows(
        "delivery_verifications", token=user.token,
        select="pickup_id,pin_code,failed_attempts,expires_at,verified_at,pickups(status,scheduled_time,volunteer_id,claims(food_listings(title,photo_url)))",
        filters={"ngo_id": eq(user.id)}, order="created_at.desc"
    )


@app.get("/api/pickups")
async def list_pickups(user: CurrentUser = Depends(current_user)) -> list[dict[str, Any]]:
    pickups = await gateway.rows(
        "pickups",
        token=user.token,
        select="*,claims(*,food_listings(*))",
        order="scheduled_time.asc",
    )
    roles = await roles_for(user)
    may_view_parties = any(role in {"ngo", "volunteer", "admin"} for role in roles)
    assigned = [pickup for pickup in pickups if pickup.get("volunteer_id")]

    if not may_view_parties or not assigned:
        return pickups

    profile_ids = {
        str(profile_id)
        for pickup in assigned
        for profile_id in (
            pickup.get("volunteer_id"),
            (pickup.get("claims") or {}).get("ngo_id"),
        )
        if profile_id
    }
    profiles = await gateway.rows(
        "profiles",
        token=user.token,
        select="id,full_name,org_name,phone,email,address,city,latitude,longitude",
        filters={"id": f"in.({','.join(sorted(profile_ids))})"},
    )
    profiles_by_id = {str(profile["id"]): profile for profile in profiles}

    for pickup in assigned:
        claim = pickup.get("claims") or {}
        ngo_id = str(claim.get("ngo_id") or "")
        volunteer_id = str(pickup.get("volunteer_id") or "")
        user_is_party = str(user.id) in {ngo_id, volunteer_id}
        if user_is_party or "admin" in roles:
            pickup["ngo_profile"] = profiles_by_id.get(ngo_id)
            pickup["volunteer_profile"] = profiles_by_id.get(volunteer_id)

    return pickups


@app.get("/api/pickups/{pickup_id}/delivery-details")
async def delivery_details(
    pickup_id: UUID,
    user: CurrentUser = Depends(current_user),
) -> dict[str, Any]:
    roles = await require_role(user, "ngo", "volunteer", "admin")
    pickups = await gateway.rows(
        "pickups",
        token=user.token,
        select="*,claims(*,food_listings(*))",
        filters={"id": eq(pickup_id)},
        limit=1,
    )
    if not pickups:
        raise HTTPException(status_code=404, detail="Delivery was not found")

    pickup = pickups[0]
    claim = pickup.get("claims") or {}
    ngo_id = str(claim.get("ngo_id") or "")
    volunteer_id = str(pickup.get("volunteer_id") or "")
    if not volunteer_id:
        raise HTTPException(
            status_code=409,
            detail="Delivery partner details are available after the request is accepted",
        )
    if "admin" not in roles and str(user.id) not in {ngo_id, volunteer_id}:
        raise HTTPException(status_code=403, detail="You are not assigned to this delivery")

    profile_ids = sorted({ngo_id, volunteer_id})
    profiles = await gateway.rows(
        "profiles",
        token=user.token,
        select="id,full_name,org_name,phone,email,address,city,latitude,longitude",
        filters={"id": f"in.({','.join(profile_ids)})"},
    )
    profiles_by_id = {str(profile["id"]): profile for profile in profiles}

    return {
        "pickup": pickup,
        "ngo": profiles_by_id.get(ngo_id),
        "volunteer": profiles_by_id.get(volunteer_id),
    }


@app.post("/api/pickups/verify-pin")
async def verify_pin(body: PinInput, user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    await require_role(user, "volunteer")
    verified = await gateway.rpc("verify_delivery_pin", {"_pickup_id": str(body.pickup_id), "_pin": body.pin}, token=user.token)
    if not verified:
        raise HTTPException(status_code=400, detail="Incorrect PIN. The order fails after 5 incorrect attempts")
    return {"ok": True}


@app.post("/api/pickups/advance")
async def advance_pickup(body: AdvanceInput, user: CurrentUser = Depends(current_user)) -> dict[str, bool]:
    await require_role(user, "volunteer", "ngo", "admin")
    advanced = await gateway.rpc(
        "advance_delivery_pickup",
        {"_pickup_id": str(body.id), "_next_status": body.status},
        token=user.token,
    )
    if not advanced:
        raise HTTPException(status_code=409, detail="Delivery status could not be updated")
    return {"ok": True}


@app.get("/api/feedback/status")
async def feedback_status(user: CurrentUser = Depends(current_user)) -> Any:
    return await gateway.rpc("my_submitted_feedback_keys", {}, token=user.token) or []


@app.post("/api/feedback")
async def submit_feedback(body: FeedbackInput, user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    feedback_id = await gateway.rpc("submit_delivery_feedback", {
        "_pickup_id": str(body.pickup_id), "_category": body.category,
        "_rating": body.rating, "_comment": body.comment
    }, token=user.token)
    return {"id": feedback_id}


@app.get("/api/admin/feedback")
async def admin_feedback(user: CurrentUser = Depends(current_user)) -> list[dict[str, Any]]:
    await require_role(user, "admin")
    rows = await gateway.rows("delivery_feedback", admin=True, select="*,pickups(claims(food_listings(title)))", order="created_at.desc", limit=500)
    ids = sorted({value for row in rows for value in (row["reviewer_id"], row["subject_id"])})
    profiles = await gateway.rows("profiles", admin=True, select="id,full_name,org_name", filters={"id": f"in.({','.join(ids)})"}) if ids else []
    by_id = {item["id"]: item for item in profiles}
    return [{**row, "reviewer": by_id.get(row["reviewer_id"]), "subject": by_id.get(row["subject_id"])} for row in rows]


@app.get("/api/impact")
async def impact(user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    # Impact is intentionally platform-wide, but only anonymised aggregate fields
    # are returned. Never include profile/contact details in this endpoint.
    records = await gateway.rows("impact_records", admin=True, select="id,city,food_type,meals_saved,weight_kg,co2_avoided_kg,completed_at", order="completed_at.asc", limit=2000)
    return {"records": records}


@app.get("/api/admin/overview")
async def admin_overview(user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    await require_role(user, "admin")
    return {
        "profiles": await gateway.rows("profiles", token=user.token, order="created_at.desc"),
        "roles": await gateway.rows("user_roles", token=user.token, select="user_id,role"),
        "listings": await gateway.rows("food_listings", token=user.token, select="id,status,donor_id,created_at"),
    }


@app.post("/api/admin/verified")
async def set_verified(body: VerifyProfileInput, user: CurrentUser = Depends(current_user)) -> dict[str, bool]:
    await require_role(user, "admin")
    await gateway.request("PATCH", "profiles", token=user.token, params={"id": eq(body.id)}, json={"verified": body.verified})
    return {"ok": True}


@app.post("/api/routes/optimize")
async def optimize_route(body: RouteInput, user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    await require_role(user, "ngo", "volunteer", "admin")
    remaining = list(body.stops)
    current = body.origin
    order: list[dict[str, Any]] = []
    total_km = 0.0
    while remaining:
        closest = min(remaining, key=lambda item: haversine(current.lat, current.lng, item.lat, item.lng))
        km = haversine(current.lat, current.lng, closest.lat, closest.lng)
        total_km += km
        order.append({**closest.model_dump(), "legKm": round(km, 1), "legMinutes": round(km / 25 * 60)})
        current = closest
        remaining.remove(closest)
    return {"order": order, "totalKm": round(total_km, 1), "totalMinutes": round(total_km / 25 * 60)}
