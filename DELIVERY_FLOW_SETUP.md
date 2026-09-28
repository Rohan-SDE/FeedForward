# FeedForward nearby-delivery and NGO PIN flow

## Deploy

From the project root:

```powershell
npx supabase db push
npm run check
npm run dev
```

The migration creates the delivery-verification table and three protected database
functions. Existing active pickups are given NGO-only PINs automatically.

## Review demo

1. **Donor:** Post food with a pickup address, latitude, longitude and a future
   best-before time.
2. **NGO:** The post appears automatically within ten seconds. Claim it, open
   **Pickups**, choose a collection time and click **Request delivery**. Record the
   six-digit PIN shown under **Delivery PINs**.
3. **Volunteer/delivery partner:** Set latitude, longitude and service radius in
   **Profile**. Open **My deliveries**, accept the nearby request, mark it
   **en route**, then **picked up**.
4. **Handover:** After the NGO physically receives the food, it tells the PIN to
   the delivery partner. The delivery partner enters it and clicks
   **Verify & complete**.
5. A correct PIN completes the pickup, claim and impact record together. Five
   incorrect attempts cancel the order and return the food quantity to the
   available pool.

## Security properties

- The PIN table is readable only by the ordering NGO (and admins).
- Volunteers never receive the PIN in their delivery-request or pickup query.
- Delivery acceptance is atomic; only the first nearby volunteer succeeds.
- A volunteer must be within their configured service radius (maximum 50 km).
- Exact pickup details become available to the volunteer only after acceptance.
