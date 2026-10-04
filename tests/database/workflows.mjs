import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../../", import.meta.url));
let db;
const realDatabase = process.env.TEST_DATABASE_URL;
if (realDatabase) {
  if (!new URL(realDatabase).pathname.endsWith("/feedforward_test"))
    throw Error("Only a disposable feedforward_test database is allowed");
  const client = new pg.Client({ connectionString: realDatabase });
  await client.connect();
  db = {
    exec: (sql) => client.query(sql),
    query: (sql, params) => client.query(sql, params),
    close: () => client.end(),
  };
} else {
  db = new PGlite({ extensions: { pgcrypto } });
}
await db.exec(fs.readFileSync(`${root}/tests/database/bootstrap.sql`, "utf8"));
for (const file of fs.readdirSync(`${root}/supabase/migrations`).sort())
  await db.exec(fs.readFileSync(`${root}/supabase/migrations/${file}`, "utf8"));
const ids = Object.fromEntries(
  ["donor", "ngo", "ngo2", "volunteer", "other", "admin"].map((r, i) => [
    r,
    `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
  ]),
);
for (const [r, id] of Object.entries(ids)) {
  await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)", [
    id,
    `${r}@example.test`,
    JSON.stringify({ role: r === "ngo2" ? "ngo" : r === "other" ? "volunteer" : r }),
  ]);
  await db.query("UPDATE public.profiles SET latitude=22,longitude=88 WHERE id=$1", [id]);
}
await db.query("INSERT INTO public.user_roles(user_id,role) VALUES($1,'admin')", [ids.admin]);
await db.query("INSERT INTO public.admin_users(user_id) VALUES($1)", [ids.admin]);
let passed = 0;
async function asUser(role, sql, params = []) {
  await db.exec("BEGIN; SET LOCAL ROLE authenticated;");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [ids[role]]);
    const r = await db.query(sql, params);
    await db.exec("COMMIT");
    return r.rows;
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("PASS", name);
  } catch (e) {
    console.error("FAIL", name, e.message);
    throw e;
  }
}
async function listing() {
  const r = await asUser(
    "donor",
    `INSERT INTO public.food_listings(donor_id,title,food_type,quantity,unit,prepared_at,best_before,pickup_address,latitude,longitude) VALUES($1,'Fresh rice','Rice',10,'servings',now()-interval '1 hour',now()+interval '4 hours','Test address',22,88) RETURNING id`,
    [ids.donor],
  );
  return r[0].id;
}
async function claim(id, role = "ngo", qty = 4) {
  return (await asUser(role, "SELECT public.claim_food_listing($1,$2,NULL) AS id", [id, qty]))[0]
    .id;
}
async function schedule(c) {
  return (
    await asUser(
      "ngo",
      "SELECT * FROM public.create_delivery_request($1,now()+interval '30 minutes')",
      [c],
    )
  )[0];
}
await test("all 18 migrations apply", async () =>
  assert.equal(fs.readdirSync(`${root}/supabase/migrations`).length, 18));
await test("volunteer donation denied", async () => {
  await assert.rejects(
    asUser(
      "volunteer",
      `INSERT INTO public.food_listings(donor_id,title,food_type,quantity,best_before,pickup_address) VALUES($1,'Food','rice',10,now()+interval '1 hour','address')`,
      [ids.volunteer],
    ),
    /row-level security|approval required/,
  );
});
await test("self verification denied", async () => {
  await assert.rejects(
    asUser("ngo", "UPDATE public.profiles SET verified=true WHERE id=$1", [ids.ngo]),
    /Only admins/,
  );
});
await test("admin verification allowed", async () => {
  await asUser("admin", "UPDATE public.profiles SET verified=true WHERE id=$1", [ids.ngo]);
});
await db.query("UPDATE public.profiles SET verified=true WHERE id IN ($1,$2)", [
  ids.donor,
  ids.ngo2,
]);
await test("direct workflow mutation denied", async () => {
  for (const table of ["claims", "pickups", "impact_records"])
    await assert.rejects(asUser("ngo", `DELETE FROM public.${table}`), /permission denied/);
});
await test("private workflow implementation inaccessible", async () => {
  await assert.rejects(
    asUser("ngo", "SELECT feedforward_private.cancel_food_claim(gen_random_uuid())"),
    /permission denied/,
  );
});
await test("foreign photo URL denied", async () => {
  await assert.rejects(
    asUser(
      "donor",
      `INSERT INTO public.food_listings(donor_id,title,food_type,quantity,best_before,pickup_address,photo_url) VALUES($1,'Food','rice',10,now()+interval '1 hour','address','https://tracker.invalid/photo')`,
      [ids.donor],
    ),
    /Upload a food photo/,
  );
});
let lid, c, p;
await test("partial claim remains available after scheduling", async () => {
  lid = await listing();
  c = await claim(lid);
  p = await schedule(c);
  const second = await claim(lid, "ngo2", 6);
  assert.ok(second);
  await assert.rejects(claim(lid, "ngo2", 1));
});
await test("unassigned volunteer cannot advance", async () => {
  await assert.rejects(
    asUser("volunteer", "SELECT public.advance_delivery_pickup($1,'en_route')", [p.pickup_id]),
    /not assigned/,
  );
});
await test("PIN visible to NGO only", async () => {
  assert.equal(
    (
      await asUser("ngo", "SELECT pin_code FROM public.delivery_verifications WHERE pickup_id=$1", [
        p.pickup_id,
      ])
    ).length,
    1,
  );
  assert.equal(
    (
      await asUser(
        "volunteer",
        "SELECT pin_code FROM public.delivery_verifications WHERE pickup_id=$1",
        [p.pickup_id],
      )
    ).length,
    0,
  );
});
await test("exactly one volunteer can accept", async () => {
  await asUser("volunteer", "SELECT public.accept_delivery_request($1)", [p.pickup_id]);
  await assert.rejects(
    asUser("other", "SELECT public.accept_delivery_request($1)", [p.pickup_id]),
    /already been accepted/,
  );
});
await test("wrong volunteer cannot complete", async () => {
  await assert.rejects(
    asUser("other", "SELECT public.verify_delivery_pin($1,$2)", [p.pickup_id, p.delivery_pin]),
    /not assigned/,
  );
});
await test("PIN required after collection; completion idempotent", async () => {
  await asUser("volunteer", "SELECT public.advance_delivery_pickup($1,'en_route')", [p.pickup_id]);
  await asUser("volunteer", "SELECT public.advance_delivery_pickup($1,'picked_up')", [p.pickup_id]);
  await assert.rejects(
    asUser("volunteer", "SELECT public.advance_delivery_pickup($1,'completed')", [p.pickup_id]),
    /PIN/,
  );
  await asUser("volunteer", "SELECT public.verify_delivery_pin($1,$2)", [
    p.pickup_id,
    p.delivery_pin,
  ]);
  await asUser("volunteer", "SELECT public.verify_delivery_pin($1,$2)", [
    p.pickup_id,
    p.delivery_pin,
  ]);
  assert.equal(
    (await db.query("SELECT * FROM public.impact_records WHERE pickup_id=$1", [p.pickup_id])).rows
      .length,
    1,
  );
});
await test("cancel twice releases quantity once", async () => {
  const l = await listing(),
    c = await claim(l);
  await asUser("ngo", "SELECT public.cancel_food_claim($1)", [c]);
  await asUser("ngo", "SELECT public.cancel_food_claim($1)", [c]);
  assert.equal(
    Number(
      (await db.query("SELECT claimed_quantity FROM public.food_listings WHERE id=$1", [l])).rows[0]
        .claimed_quantity,
    ),
    0,
  );
});
await test("five failed PINs do not reoffer collected quantity", async () => {
  const l = await listing(),
    c = await claim(l),
    p = await schedule(c);
  await asUser("volunteer", "SELECT public.accept_delivery_request($1)", [p.pickup_id]);
  await asUser("volunteer", "SELECT public.advance_delivery_pickup($1,'en_route')", [p.pickup_id]);
  await asUser("volunteer", "SELECT public.advance_delivery_pickup($1,'picked_up')", [p.pickup_id]);
  const wrong = p.delivery_pin === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++)
    await asUser("volunteer", "SELECT public.verify_delivery_pin($1,$2)", [p.pickup_id, wrong]);
  assert.equal(
    Number(
      (await db.query("SELECT claimed_quantity FROM public.food_listings WHERE id=$1", [l])).rows[0]
        .claimed_quantity,
    ),
    4,
  );
  await assert.rejects(
    asUser("volunteer", "SELECT public.verify_delivery_pin($1,$2)", [p.pickup_id, p.delivery_pin]),
  );
});
await test("expiry cleanup is idempotent and releases uncollected reservations", async () => {
  const l = await listing(),
    c = await claim(l);
  await schedule(c);
  await db.query(
    "UPDATE public.food_listings SET prepared_at=now()-interval '2 hours',best_before=now()-interval '1 hour' WHERE id=$1",
    [l],
  );
  await db.exec("SELECT public.expire_food_batch(100)");
  await db.exec("SELECT public.expire_food_batch(100)");
  const row = (
    await db.query("SELECT status,claimed_quantity FROM public.food_listings WHERE id=$1", [l])
  ).rows[0];
  assert.equal(row.status, "expired");
  assert.equal(Number(row.claimed_quantity), 0);
});
await test("expiry worker unavailable to users", async () =>
  await assert.rejects(asUser("ngo", "SELECT public.expire_food_batch(100)"), /permission denied/));
await test("audit visible only to admin", async () => {
  assert.equal((await asUser("ngo", "SELECT * FROM public.workflow_audit")).length, 0);
  assert.ok((await asUser("admin", "SELECT * FROM public.workflow_audit")).length > 0);
});
await test("direct listing quota cannot be bypassed through REST", async () => {
  ids.quota = "00000000-0000-0000-0000-000000000099";
  await db.query("INSERT INTO auth.users(id,raw_user_meta_data) VALUES($1,$2)", [
    ids.quota,
    JSON.stringify({ role: "donor" }),
  ]);
  await db.query("UPDATE public.profiles SET verified=true WHERE id=$1", [ids.quota]);
  const sql =
    "INSERT INTO public.food_listings(donor_id,title,food_type,quantity,best_before,pickup_address) VALUES($1,'Food','Rice',1,now()+interval '1 hour','Test address')";
  for (let i = 0; i < 60; i++) await asUser("quota", sql, [ids.quota]);
  await assert.rejects(asUser("quota", sql, [ids.quota]), /Hourly action limit/);
});
await test("expiry preserves collected food reservation", async () => {
  const l = await listing(),
    c = await claim(l),
    p = await schedule(c);
  await asUser("volunteer", "SELECT public.accept_delivery_request($1)", [p.pickup_id]);
  await asUser("volunteer", "SELECT public.advance_delivery_pickup($1,'en_route')", [p.pickup_id]);
  await asUser("volunteer", "SELECT public.advance_delivery_pickup($1,'picked_up')", [p.pickup_id]);
  await db.query(
    "UPDATE public.food_listings SET prepared_at=now()-interval '2 hours',best_before=now()-interval '1 hour' WHERE id=$1",
    [l],
  );
  await db.exec("SELECT public.expire_food_batch(100)");
  assert.equal(
    Number(
      (await db.query("SELECT claimed_quantity FROM public.food_listings WHERE id=$1", [l])).rows[0]
        .claimed_quantity,
    ),
    4,
  );
});
await test("photo upload reservation is unavailable to public users", async () => {
  await assert.rejects(
    asUser("donor", "SELECT public.reserve_photo_upload($1)", [ids.donor]),
    /permission denied/,
  );
});
await test("new-food alerts are restricted to nearby NGOs", async () => {
  await db.query("UPDATE public.profiles SET latitude=0,longitude=0 WHERE id=$1", [ids.ngo2]);
  const l = await listing();
  const recipients = (
    await db.query("SELECT recipient_id FROM public.notifications WHERE entity_id=$1", [l])
  ).rows.map((r) => r.recipient_id);
  assert.ok(recipients.includes(ids.ngo));
  assert.ok(!recipients.includes(ids.ngo2));
  await db.query("UPDATE public.profiles SET latitude=22,longitude=88 WHERE id=$1", [ids.ngo2]);
});
if (realDatabase) {
  await test("concurrent claims cannot over-reserve", async () => {
    const l = await listing();
    async function concurrentClaim(role) {
      const c = new pg.Client({ connectionString: realDatabase });
      await c.connect();
      try {
        await c.query("BEGIN; SET LOCAL ROLE authenticated");
        await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [ids[role]]);
        await c.query("SELECT public.claim_food_listing($1,7,NULL)", [l]);
        await c.query("COMMIT");
        return true;
      } catch {
        await c.query("ROLLBACK");
        return false;
      } finally {
        await c.end();
      }
    }
    const results = await Promise.all([concurrentClaim("ngo"), concurrentClaim("ngo2")]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(
      Number(
        (await db.query("SELECT claimed_quantity FROM public.food_listings WHERE id=$1", [l]))
          .rows[0].claimed_quantity,
      ),
      7,
    );
  });
}
await test("automatic dispatch respects availability, capacity and tracking privacy", async () => {
  await db.exec(
    "UPDATE public.pickups SET status='cancelled' WHERE status NOT IN ('completed','cancelled')",
  );
  const l = (
    await db.query(
      `INSERT INTO public.food_listings(donor_id,title,food_type,quantity,unit,prepared_at,best_before,pickup_address,latitude,longitude) VALUES($1,'Dispatch test','Rice',10,'servings',now(),now()+interval '4 hours','Test address',22,88) RETURNING id`,
      [ids.donor],
    )
  ).rows[0].id;
  await assert.rejects(asUser("ngo", "SELECT public.set_rider_presence(true,22,88)"), /Volunteer/);
  await asUser("volunteer", "SELECT public.set_rider_presence(true,22,88)");
  const c = (await asUser("ngo", "SELECT public.claim_with_delivery($1,2,NULL) AS id", [l]))[0].id;
  const p = (await db.query("SELECT * FROM public.pickups WHERE claim_id=$1", [c])).rows[0];
  assert.equal(p.volunteer_id, ids.volunteer);
  const c2 = (await asUser("ngo2", "SELECT public.claim_with_delivery($1,2,NULL) AS id", [l]))[0]
    .id;
  const p2 = (await db.query("SELECT * FROM public.pickups WHERE claim_id=$1", [c2])).rows[0];
  assert.equal(p2.volunteer_id, null);
  await assert.rejects(
    asUser("volunteer", "SELECT public.accept_delivery_request($1)", [p2.id]),
    /active delivery/,
  );
  await asUser("volunteer", "SELECT public.share_delivery_location($1,22.01,88.01,10)", [p.id]);
  assert.equal(
    (await asUser("ngo", "SELECT * FROM public.read_delivery_location($1)", [p.id])).length,
    1,
  );
  await assert.rejects(
    asUser("ngo2", "SELECT * FROM public.read_delivery_location($1)", [p.id]),
    /not found/,
  );
  await assert.rejects(
    asUser("other", "SELECT public.share_delivery_location($1,22,88,10)", [p.id]),
    /assigned delivery/,
  );
  await assert.rejects(
    asUser("ngo", "SELECT * FROM public.delivery_locations"),
    /permission denied/,
  );
  await asUser("volunteer", "SELECT public.stop_delivery_location($1)", [p.id]);
  assert.equal(
    (await asUser("ngo", "SELECT * FROM public.read_delivery_location($1)", [p.id])).length,
    0,
  );
  await asUser("volunteer", "SELECT public.share_delivery_location($1,22.01,88.01,10)", [p.id]);
  await db.query(
    "UPDATE public.delivery_locations SET updated_at=now()-interval '6 minutes' WHERE pickup_id=$1",
    [p.id],
  );
  assert.equal(
    (await asUser("ngo", "SELECT * FROM public.read_delivery_location($1)", [p.id])).length,
    0,
  );
  await db.query("UPDATE public.pickups SET status='cancelled' WHERE id=$1", [p.id]);
  assert.equal(
    (await db.query("SELECT * FROM public.delivery_locations WHERE pickup_id=$1", [p.id])).rows
      .length,
    0,
  );
  await asUser("volunteer", "SELECT public.set_rider_presence(false,22,88)");
  await db.exec("SELECT feedforward_private.dispatch_waiting()");
  assert.equal(
    (await db.query("SELECT volunteer_id FROM public.pickups WHERE id=$1", [p2.id])).rows[0]
      .volunteer_id,
    null,
  );
  await asUser("other", "SELECT public.set_rider_presence(true,22,88)");
  assert.equal(
    (await db.query("SELECT volunteer_id FROM public.pickups WHERE id=$1", [p2.id])).rows[0]
      .volunteer_id,
    ids.other,
  );
});
await test("donor cancellation and expired reservations release rider capacity", async () => {
  await db.exec(
    "UPDATE public.pickups SET status='cancelled' WHERE status IN ('scheduled','en_route','picked_up','delivered')",
  );
  async function fresh() {
    return (
      await db.query(
        "INSERT INTO public.food_listings(donor_id,title,food_type,quantity,unit,prepared_at,best_before,pickup_address,latitude,longitude) VALUES($1,'Expiry regression','Rice',10,'servings',now()-interval '2 hours',now()+interval '4 hours','Test address',22,88) RETURNING id",
        [ids.donor],
      )
    ).rows[0].id;
  }
  const l = await fresh(),
    c = await claim(l),
    p = await schedule(c);
  await asUser("volunteer", "SELECT public.accept_delivery_request($1)", [p.pickup_id]);
  await asUser("volunteer", "SELECT public.advance_delivery_pickup($1,'en_route')", [p.pickup_id]);
  await assert.rejects(
    asUser("ngo", "SELECT public.cancel_food_listing($1)", [l]),
    /Listing not found/,
  );
  await asUser("donor", "SELECT public.cancel_food_listing($1)", [l]);
  await asUser("donor", "SELECT public.cancel_food_listing($1)", [l]);
  assert.equal(
    (await db.query("SELECT status FROM public.pickups WHERE id=$1", [p.pickup_id])).rows[0].status,
    "cancelled",
  );
  assert.equal(
    Number(
      (await db.query("SELECT claimed_quantity FROM public.food_listings WHERE id=$1", [l])).rows[0]
        .claimed_quantity,
    ),
    0,
  );
  const l2 = await fresh(),
    c2 = await claim(l2),
    p2 = await schedule(c2);
  await asUser("volunteer", "SELECT public.accept_delivery_request($1)", [p2.pickup_id]);
  await db.query(
    "UPDATE public.food_listings SET status='expired',best_before=now()-interval '1 hour' WHERE id=$1",
    [l2],
  );
  await db.exec("SELECT public.expire_food_batch(100); SELECT public.expire_food_batch(100)");
  assert.equal(
    (await db.query("SELECT status FROM public.pickups WHERE id=$1", [p2.pickup_id])).rows[0]
      .status,
    "cancelled",
  );
  const l3 = await fresh(),
    c3 = await claim(l3),
    p3 = await schedule(c3);
  await asUser("volunteer", "SELECT public.accept_delivery_request($1)", [p3.pickup_id]);
  await asUser("volunteer", "SELECT public.advance_delivery_pickup($1,'en_route')", [p3.pickup_id]);
  await asUser("volunteer", "SELECT public.advance_delivery_pickup($1,'picked_up')", [
    p3.pickup_id,
  ]);
  await assert.rejects(
    asUser("donor", "SELECT public.cancel_food_listing($1)", [l3]),
    /Collected food cannot be cancelled/,
  );
});
await test("preparation and delay updates enforce ownership and terminal status", async () => {
  const l = (
    await db.query(
      "INSERT INTO public.food_listings(donor_id,title,food_type,quantity,unit,prepared_at,best_before,pickup_address,latitude,longitude) VALUES($1,'Progress test','Rice',10,'servings',now(),now()+interval '4 hours','Test address',22,88) RETURNING id",
      [ids.donor],
    )
  ).rows[0].id;
  await assert.rejects(
    asUser("ngo", "SELECT public.update_preparation($1,'ready')", [l]),
    /Listing not found/,
  );
  for (const status of ["preparing", "delayed", "ready"]) {
    await asUser("donor", "SELECT public.update_preparation($1,$2)", [l, status]);
    assert.equal(
      (await db.query("SELECT preparation_status FROM public.food_listings WHERE id=$1", [l]))
        .rows[0].preparation_status,
      status,
    );
  }
  const c = await claim(l),
    p = await schedule(c);
  await db.exec(
    "UPDATE public.pickups SET status='cancelled' WHERE volunteer_id IS NOT NULL AND status IN ('scheduled','en_route','picked_up','delivered')",
  );
  await asUser("volunteer", "SELECT public.accept_delivery_request($1)", [p.pickup_id]);
  await assert.rejects(
    asUser("other", "SELECT public.report_delivery_delay($1,'Traffic')", [p.pickup_id]),
    /Delivery not found/,
  );
  await asUser("volunteer", "SELECT public.report_delivery_delay($1,'Traffic')", [p.pickup_id]);
  assert.equal(
    (await db.query("SELECT delay_note FROM public.pickups WHERE id=$1", [p.pickup_id])).rows[0]
      .delay_note,
    "Traffic",
  );
  await asUser("volunteer", "SELECT public.report_delivery_delay($1,'')", [p.pickup_id]);
  assert.equal(
    (await db.query("SELECT delay_note FROM public.pickups WHERE id=$1", [p.pickup_id])).rows[0]
      .delay_note,
    null,
  );
  await asUser("donor", "SELECT public.cancel_food_listing($1)", [l]);
  await assert.rejects(
    asUser("donor", "SELECT public.update_preparation($1,'ready')", [l]),
    /no longer active/,
  );
  await assert.rejects(
    asUser("volunteer", "SELECT public.report_delivery_delay($1,'Traffic')", [p.pickup_id]),
    /no longer active/,
  );
});
await test("manual approval cannot be bypassed and reviewer decisions are recorded", async () => {
  await db.query("UPDATE public.profiles SET verified=false WHERE id=$1", [ids.donor]);
  await assert.rejects(listing(), /approval required/);
  await asUser("donor", "SELECT public.request_verification($1)", [
    "Community kitchen; administrator can contact our organisation to verify.",
  ]);
  await assert.rejects(
    asUser("donor", "SELECT public.review_verification($1,true,'Approved')", [ids.donor]),
    /Admins only/,
  );
  assert.equal((await asUser("ngo", "SELECT * FROM public.verification_requests")).length, 0);
  await asUser("admin", "SELECT public.review_verification($1,true,'Contact verified manually')", [
    ids.donor,
  ]);
  assert.equal(
    (await asUser("donor", "SELECT status FROM public.verification_requests"))[0].status,
    "approved",
  );
  await db.query("UPDATE public.profiles SET verified=false WHERE id=$1", [ids.ngo]);
  const l = (
    await db.query(
      "INSERT INTO public.food_listings(donor_id,title,food_type,quantity,best_before,pickup_address) VALUES($1,'Approval test','Rice',10,now()+interval '2 hours','Test address') RETURNING id",
      [ids.donor],
    )
  ).rows[0].id;
  await assert.rejects(claim(l), /approval required/);
  await db.query("UPDATE public.profiles SET verified=true WHERE id=$1", [ids.ngo]);
});
await test("support tickets isolate users and only admins set status", async () => {
  const t = (
    await asUser(
      "ngo",
      "SELECT public.open_support_ticket('Pickup problem','Please help with my order') AS id",
    )
  )[0].id;
  assert.equal((await asUser("ngo2", "SELECT * FROM public.support_tickets")).length, 0);
  assert.equal((await asUser("ngo2", "SELECT * FROM public.support_messages")).length, 0);
  await assert.rejects(
    asUser("ngo2", "SELECT public.reply_support_ticket($1,'Attempt to read',NULL)", [t]),
    /Ticket not found/,
  );
  await assert.rejects(
    asUser("ngo", "SELECT public.reply_support_ticket($1,'Set resolved','resolved')", [t]),
    /Only admins/,
  );
  await asUser(
    "admin",
    "SELECT public.reply_support_ticket($1,'We are investigating','in_progress')",
    [t],
  );
  assert.equal(
    (await asUser("ngo", "SELECT status FROM public.support_tickets"))[0].status,
    "in_progress",
  );
  assert.equal((await asUser("ngo", "SELECT * FROM public.support_messages")).length, 2);
});
await test("NGO can cancel an assigned en-route order but not collected food", async () => {
  await db.exec(
    "UPDATE public.pickups SET status='cancelled' WHERE status IN ('scheduled','en_route','picked_up','delivered')",
  );
  const l = (
    await db.query(
      "INSERT INTO public.food_listings(donor_id,title,food_type,quantity,best_before,pickup_address,latitude,longitude) VALUES($1,'Cancel test','Rice',10,now()+interval '2 hours','Test address',22,88) RETURNING id",
      [ids.donor],
    )
  ).rows[0].id;
  const c = await claim(l),
    p = await schedule(c);
  await asUser("volunteer", "SELECT public.accept_delivery_request($1)", [p.pickup_id]);
  await asUser("volunteer", "SELECT public.advance_delivery_pickup($1,'en_route')", [p.pickup_id]);
  await asUser("ngo", "SELECT public.advance_delivery_pickup($1,'cancelled')", [p.pickup_id]);
  assert.equal(
    Number(
      (await db.query("SELECT claimed_quantity FROM public.food_listings WHERE id=$1", [l])).rows[0]
        .claimed_quantity,
    ),
    0,
  );
  const c2 = await claim(l),
    p2 = await schedule(c2);
  await asUser("volunteer", "SELECT public.accept_delivery_request($1)", [p2.pickup_id]);
  await asUser("volunteer", "SELECT public.advance_delivery_pickup($1,'en_route')", [p2.pickup_id]);
  await asUser("volunteer", "SELECT public.advance_delivery_pickup($1,'picked_up')", [
    p2.pickup_id,
  ]);
  await assert.rejects(
    asUser("ngo", "SELECT public.advance_delivery_pickup($1,'cancelled')", [p2.pickup_id]),
    /administrator/,
  );
});
await test("only NGO food reviews are visible to the matching donor", async () => {
  const p = (await db.query("SELECT id FROM public.pickups LIMIT 1")).rows[0].id;
  await db.query("DELETE FROM public.delivery_feedback WHERE pickup_id=$1", [p]);
  await db.query(
    "INSERT INTO public.delivery_feedback(pickup_id,reviewer_id,reviewer_role,subject_id,subject_role,category,rating,comment) VALUES($1,$2,'ngo',$3,'donor','food',5,'Good food'),($1,$4,'volunteer',$3,'donor','restaurant',3,'Admin only'),($1,$3,'donor',$4,'volunteer','delivery_partner',4,'Admin only')",
    [p, ids.ngo, ids.donor, ids.volunteer],
  );
  const donorRows = await asUser("donor", "SELECT * FROM public.delivery_feedback");
  assert.equal(donorRows.length, 1);
  assert.equal(donorRows[0].comment, "Good food");
  assert.equal((await asUser("volunteer", "SELECT * FROM public.delivery_feedback")).length, 0);
  assert.equal((await asUser("ngo2", "SELECT * FROM public.delivery_feedback")).length, 0);
  assert.ok((await asUser("admin", "SELECT * FROM public.delivery_feedback")).length >= 3);
});

await test("only administrators can moderate and cannot block themselves", async () => {
  await assert.rejects(
    asUser("donor", "SELECT public.moderate_account($1,'block','Test block')", [ids.ngo]),
    /Admins only/,
  );
  await assert.rejects(
    asUser("admin", "SELECT public.moderate_account($1,'block','Test block')", [ids.admin]),
    /Administrator accounts/,
  );
  await assert.rejects(
    asUser(
      "admin",
      "SELECT public.moderate_account($1,'block','Test block',now()-interval '1 hour')",
      [ids.ngo],
    ),
    /future/,
  );
});
await test("permanent blocks stop direct writes and workflow RPCs but allow support", async () => {
  await asUser("admin", "SELECT public.moderate_account($1,'block','Reviewed evidence')", [
    ids.donor,
  ]);
  assert.equal(
    (await asUser("donor", "SELECT public.account_is_blocked(auth.uid()) AS blocked"))[0].blocked,
    true,
  );
  await assert.rejects(
    asUser("donor", "UPDATE public.profiles SET full_name='Bypass' WHERE id=auth.uid()"),
    /blocked/,
  );
  await assert.rejects(
    asUser("donor", "SELECT public.cancel_food_listing(gen_random_uuid())"),
    /blocked/,
  );
  assert.equal(
    (await asUser("donor", "SELECT public.has_current_role('donor') AS allowed"))[0].allowed,
    false,
  );
  await asUser(
    "donor",
    "SELECT public.open_support_ticket('Appeal suspension','Please review my account restriction')",
  );
  assert.equal((await asUser("donor", "SELECT * FROM public.moderation_actions")).length, 0);
  await asUser("admin", "SELECT public.moderate_account($1,'unblock','Review completed')", [
    ids.donor,
  ]);
  await asUser(
    "donor",
    "UPDATE public.profiles SET full_name='Restored donor' WHERE id=auth.uid()",
  );
});
await test("temporary blocks expire without a cleanup job and retain audit history", async () => {
  await asUser(
    "admin",
    "SELECT public.moderate_account($1,'block','Temporary restriction',now()+interval '1 day')",
    [ids.volunteer],
  );
  assert.equal(
    (await asUser("volunteer", "SELECT public.account_is_blocked(auth.uid()) AS blocked"))[0]
      .blocked,
    true,
  );
  await assert.rejects(
    asUser("volunteer", "SELECT public.read_delivery_location(gen_random_uuid())"),
    /blocked/,
  );
  await assert.rejects(
    asUser("volunteer", "SELECT public.set_rider_presence(true,22,88)"),
    /blocked/,
  );
  await db.query(
    "UPDATE public.account_restrictions SET blocked_until=now()-interval '1 second' WHERE user_id=$1",
    [ids.volunteer],
  );
  assert.equal(
    (await asUser("volunteer", "SELECT public.account_is_blocked(auth.uid()) AS blocked"))[0]
      .blocked,
    false,
  );
  assert.equal(
    (await asUser("volunteer", "SELECT public.has_current_role('volunteer') AS allowed"))[0]
      .allowed,
    true,
  );
  assert.ok(
    (
      await asUser("admin", "SELECT * FROM public.moderation_actions WHERE user_id=$1", [
        ids.volunteer,
      ])
    ).length,
  );
});
await test("feedback actions must target the reviewed participant and warnings are recorded", async () => {
  const feedback = (
    await db.query(
      "SELECT id,subject_id FROM public.delivery_feedback WHERE subject_id=$1 LIMIT 1",
      [ids.donor],
    )
  ).rows[0];
  await assert.rejects(
    asUser(
      "admin",
      "SELECT public.moderate_account($1,'warning','Review this complaint',NULL,$2)",
      [ids.ngo, feedback.id],
    ),
    /does not refer/,
  );
  await asUser(
    "admin",
    "SELECT public.moderate_account($1,'warning','Review this complaint',NULL,$2)",
    [ids.donor, feedback.id],
  );
  const actions = await asUser(
    "admin",
    "SELECT * FROM public.moderation_actions WHERE feedback_id=$1",
    [feedback.id],
  );
  assert.equal(actions.length, 1);
  assert.equal(actions[0].user_id, ids.donor);
});
await test("resolved support retains messages and can be reopened", async () => {
  const t = (
    await asUser(
      "ngo",
      "SELECT public.open_support_ticket('Delivery issue','Please help with the delivery') AS id",
    )
  )[0].id;
  await asUser("admin", "SELECT public.reply_support_ticket($1,'Issue fixed','resolved')", [t]);
  assert.equal(
    (await asUser("ngo", "SELECT status FROM public.support_tickets WHERE id=$1", [t]))[0].status,
    "resolved",
  );
  await asUser("ngo", "SELECT public.reply_support_ticket($1,'The issue returned',NULL)", [t]);
  assert.equal(
    (await asUser("ngo", "SELECT status FROM public.support_tickets WHERE id=$1", [t]))[0].status,
    "open",
  );
  assert.equal(
    (await asUser("ngo", "SELECT * FROM public.support_messages WHERE ticket_id=$1", [t])).length,
    3,
  );
});
console.log(
  `${passed} database checks passed (${realDatabase ? "PostgreSQL + concurrent claim test" : "single-session PGlite; no concurrency/load test"})`,
);
await db.close();
