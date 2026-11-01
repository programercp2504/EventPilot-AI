EVENTPILOT AI — FRONTEND + SQLITE DATABASE INTEGRATION

This bundle includes:
- app/page.tsx: updated dashboard that loads events from GET /api/events and uses the database API for create, edit, and delete. Event records are no longer read/written to localStorage.
- app/api/events/route.ts: Prisma-backed GET, POST, PUT, DELETE API.
- prisma/schema.prisma: SQLite Event model.
- lib/prisma.ts: Prisma client singleton.
- package.json: dependencies and scripts (merge with your current package.json if you have extra dependencies).
- .env.example: DATABASE_URL example.

INSTALL IN YOUR EXISTING PROJECT (do not replace the entire project folder):
1. Copy the files into the same paths in your existing eventpilot-ai folder. Back up app/page.tsx and app/api/events/route.ts first.
2. Ensure root .env exists and contains exactly:
   DATABASE_URL="file:./dev.db"
3. In PowerShell, from the project root, run:
   npm install
   npx prisma generate
   npx prisma migrate dev --name init
   npm run dev
4. Open http://localhost:3000/api/events. Expected JSON includes success:true and events: [].
5. Create an event in the UI, then refresh the page. It should remain because it is stored in SQLite.
6. Test edit and delete from My Events. They use PUT and DELETE API requests.

IMPORTANT:
- This page keeps theme and vendor checklist preferences in localStorage, but events are loaded from and saved to the database only.
- If your existing package.json has extra dependencies, do not blindly overwrite it; add @prisma/client and prisma and merge the scripts.
- SQLite URL file:./dev.db is resolved relative to the prisma schema, so the DB file will usually be prisma/dev.db.
- Do not delete prisma/dev.db if you want to keep saved event records.
- This local SQLite setup is for development/demo. For many production/serverless deployments, use a managed database instead.

API endpoints:
GET    /api/events
POST   /api/events
PUT    /api/events  (JSON body must include id)
DELETE /api/events?id=<event-id>
