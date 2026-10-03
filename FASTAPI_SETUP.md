# FeedForward: run React + FastAPI

## 1. Configure React

Add this line to the project-root `.env.local`:

```env
VITE_API_URL=http://localhost:8000
```

Keep the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
Do not put the service-role key in any variable starting with `VITE_`.

## 2. Configure and start Python (PowerShell terminal 1)

```powershell
cd D:\Food_Waste_Redistribution_System\meal-link-loop-main\backend
py -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
notepad .env
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Copy the real values for `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` into `backend/.env`. Restart FastAPI after editing.

Check <http://localhost:8000/health> and <http://localhost:8000/docs>.

## 3. Start React (PowerShell terminal 2)

```powershell
cd D:\Food_Waste_Redistribution_System\meal-link-loop-main
npm run dev -- --host 0.0.0.0 --port 8080
```

Restart React after adding `VITE_API_URL`.

## 4. Verify

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m pytest -q
cd ..
npm run check
```

Demo in this order: donor posts food, NGO claims and requests delivery,
volunteer accepts and picks up, volunteer enters the NGO PIN, then all three
roles submit private admin feedback.
