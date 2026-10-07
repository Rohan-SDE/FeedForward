# FeedForward

Start here: [current deployment and operations guide](docs/DEPLOYMENT.md) and [verification results](docs/VERIFICATION.md).

Latest release: [September 26 hardening, 3D frontend and setup guide](docs/RELEASE_2026_09_26.md). Read this before upgrading; the new database migration and API must be deployed together.

FeedForward is a role-based food redistribution platform connecting donors, NGOs and volunteer delivery partners. Donors publish surplus food, NGOs claim it, nearby volunteers accept delivery requests, and a six-digit NGO PIN confirms the physical handover.

## Technology

- React 19, TanStack Start/Router/Query, TypeScript and Tailwind CSS
- FastAPI and Pydantic
- Supabase Auth and PostgreSQL with row-level security
- Ola Maps for embedded maps and Google Maps URLs for turn-by-turn navigation
- Durable role-based notifications for new food, delivery requests and accepted deliveries
- Pytest, ESLint, TypeScript and GitHub Actions CI

## Delivery workflow

1. A donor publishes food with a safe pickup window and coordinates.
2. An NGO claims an available quantity and requests delivery.
3. Nearby volunteers see the request based on coordinates and service radius.
4. One volunteer atomically accepts the request.
5. The volunteer travels to the donor and confirms food collection.
6. Navigation switches to the NGO destination.
7. The NGO shares its six-digit PIN after receiving the food.
8. Correct PIN verification completes the pickup and creates an impact record.

## Local setup on Windows

Requirements: Node.js 22, Python 3.12, a Supabase project and an Ola Maps browser key.

Create the frontend environment file:

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Create the backend environment and virtual environment:

```powershell
cd backend
Copy-Item .env.example .env
py -3.12 -m venv .venv
& .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
notepad .env
```

Apply all database migrations from the project root:

```powershell
cd ..
npx supabase login
npx supabase link --project-ref YOUR_20_CHARACTER_PROJECT_REF
npx supabase db push
```

Run the backend:

```powershell
cd backend
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Run the frontend in a second terminal:

```powershell
cd "D:\Food_Waste_Redistribution_System\meal-link-loop-main"
npm ci
npm run check
npm run dev -- --host 0.0.0.0 --port 8001
```

Open `http://localhost:8001`. API documentation is available at `http://localhost:8000/docs` in development. Readiness is available at `http://localhost:8000/health/ready`.

## Production configuration

Frontend variables belong in the deployment platform's frontend settings:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_API_URL` using HTTPS
- `VITE_OLA_MAPS_API_KEY` restricted to the production domain

Backend secrets belong only in the backend host:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FRONTEND_ORIGINS` containing the exact HTTPS frontend origin
- `ENVIRONMENT=production`

Never commit `.env`, `.env.local`, a service-role key, `node_modules`, `.venv` or build output.

## Verification

```powershell
npm run check
npm run build
cd backend
& .\.venv\Scripts\python.exe -m pytest tests -q
```

See [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) for the audit, remaining launch work and realistic schedule.
