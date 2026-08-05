# Food Share Connect

# Build Prompt: Food-Waste Redistribution System

Copy everything below into your AI coding tool (Claude Code, Cursor, etc.) to generate the app.

---

## Project Overview

Build a full-stack web/mobile application called **[App Name — e.g., "FeedForward" / "MealBridge"]** that connects food donors (restaurants, hostels, event organizers, canteens) with NGOs and shelters to redistribute surplus food before it goes to waste. The system should minimize food waste, reduce hunger, and provide transparency into social impact.

## User Roles

1. **Donor** — Restaurant, hostel, canteen, or event organizer with surplus food.

2. **NGO / Shelter** — Receiving organization that picks up and distributes food.

3. **Volunteer / Delivery Agent** (optional role) — Handles pickup/delivery if NGO can't self-collect.

4. **Admin** — Platform manager who verifies organizations, monitors activity, and resolves disputes.

## Core Features

### 1. Donor Food Posting

- Donors can create a "food listing" with: food type/category, quantity (servings or kg), description, preparation/cooked time, expiry/best-before window, photos, veg/non-veg tag, allergen info, and pickup address (auto-filled via geolocation).

- Ability to edit or cancel a listing before pickup.

- Recurring donation templates for regular donors (e.g., daily canteen leftovers).

### 2. Location-Based NGO Alerts

- NGOs set a service radius and food-type preferences in their profile.

- New listings within radius trigger real-time push/SMS/email notifications.

- NGOs can view nearby listings on a live map, sorted by distance and expiry urgency.

- First-accept or claim-based system to avoid duplicate pickups.

### 3. Pickup Scheduling

- NGO selects a pickup time slot; donor confirms or proposes an alternate slot.

- Calendar/timeline view for both donor and NGO showing upcoming pickups.

- Automated reminders (push/SMS) before pickup time.

- Status tracking: Posted → Claimed → Scheduled → Picked Up → Delivered → Completed / Expired / Cancelled.

### 4. Food Quantity & Freshness Tracking

- Track quantity claimed vs. quantity available (supports partial claims by multiple NGOs).

- Freshness indicator based on prep time + food type (e.g., cooked food = 4hr safe window, packaged = longer), with color-coded urgency (green/yellow/red).

- Auto-expire listings past the safe consumption window and notify donor/NGO.

- Optional temperature/storage condition tag (hot, refrigerated, room temp).

### 5. Route Optimization

- Suggest optimal pickup routes when an NGO/volunteer has multiple pickups scheduled, using a mapping API (Google Maps / Mapbox / OpenRouteService).

- Estimated travel time and distance per route.

- Multi-stop route reordering to minimize total travel time.

- Live tracking of volunteer/delivery agent en route (optional real-time GPS).

### 6. Impact Dashboard

- Aggregate metrics: total meals saved, total food weight redistributed (kg), CO2 emissions avoided, number of people fed, number of active donors/NGOs.

- Filters by date range, donor, NGO, city/region.

- Leaderboard for top-contributing donors and NGOs (gamification).

- Downloadable/shareable impact reports (PDF/CSV) for CSR or grant reporting.

- Visual charts: meals saved over time, food category breakdown, geographic heatmap of donations.

## Suggested Tech Stack (adjust to your preference)

- **Frontend:** React (web) + React Native or Flutter (mobile), Tailwind CSS

- **Backend:** Django REST Framework

- **Database:** PostgreSQL with PostGIS (for geolocation queries)

- **Real-time/Notifications:** Firebase Cloud Messaging / Twilio (SMS) / WebSockets for live status updates

- **Maps & Routing:** Google Maps Platform (Places, Directions, Distance Matrix) or Mapbox + OpenRouteService

- **Auth:** JWT-based auth with role-based access control (Donor/NGO/Volunteer/Admin)

- **Hosting:** AWS / GCP / Vercel + Supabase (if rapid prototyping)

## Data Models (minimum viable schema)

- **User** (id, name, role, org name, phone, email, address, geolocation, verified status)

- **FoodListing** (id, donor_id, food_type, quantity, unit, description, photos[], prep_time, expiry_time, status, geolocation, created_at)

- **Claim** (id, listing_id, ngo_id, claimed_quantity, status, claimed_at)

- **Pickup** (id, claim_id, scheduled_time, actual_pickup_time, volunteer_id, status, route_id)

- **ImpactRecord** (id, pickup_id, meals_saved_estimate, weight_kg, co2_avoided_estimate, completed_at)

## Non-Functional Requirements

- Mobile-responsive UI, accessible (WCAG 2.1 AA where feasible)

- Verification workflow for NGOs/donors to prevent fraud/misuse

- Data privacy compliant handling of location and contact info

- Offline-friendly / low-bandwidth fallback for volunteers in low-connectivity areas

- Scalable to multi-city deployment

## Deliverables Requested

1. System architecture diagram

2. Database schema (ERD)

3. API endpoint list (REST or GraphQL)

4. UI wireframes/mockups for Donor, NGO, and Admin dashboards

5. MVP feature scope vs. Phase 2 roadmap

6. Working starter codebase for [specify: web app / mobile app / both]

---

**Instructions to the AI:** Start by proposing the MVP feature set (pick the highest-impact subset of the above for a hackathon/first release), then generate the database schema, then scaffold the codebase. Ask me clarifying questions only if something is ambiguous; otherwise proceed with reasonable defaults.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://meal-link-loop.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e7454d5e-bcce-4658-b147-03aaa47fa6a0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
