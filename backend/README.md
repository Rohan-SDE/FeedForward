# FeedForward FastAPI backend

The API validates the Supabase access token supplied by the React client and uses
the project's existing Row Level Security policies and database RPC functions.
The service-role key stays only in this backend and must never use the `VITE_`
prefix.

## Windows PowerShell

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
notepad .env
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Keep that terminal open. In a second terminal, run the React application with
`VITE_API_URL=http://localhost:8000` in the root `.env.local`.

API documentation: <http://localhost:8000/docs>

Run the smoke test after installing dependencies:

```powershell
python -m pytest -q
```
