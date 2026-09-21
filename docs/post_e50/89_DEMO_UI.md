# Stage 89 - Demo UI

The frontend uses the existing Post-E50 product UI. Stage 89 does not introduce a separate
presentation theme or a synthetic frontend-only mode.

## Landing

Recommended demo landing:

`/pacientes`

Expected content after `post-e50-demo-reset.ps1`:

- primary demo subject represented by Studies ending in `DEMO-LUMBAR-2026-03`;
- secondary demo subject represented by `DEMO-LUMBAR-ALT-01`;
- navigation to patient history and Study reopening.

The UI may use safe patient labels rather than printing raw `subjectRef` everywhere. This is
intentional and consistent with the privacy posture of stages 84-86.

## Flow

The demo browser script validates:

- `/pacientes`;
- Study reopening;
- AI partial result;
- history;
- longitudinal evolution;
- structured report panel;
- JSON/PDF exports;
- contextual assistant;
- reload persistence;
- zero legacy `/api/patients` requests.

Command:

```powershell
$token = (Invoke-RestMethod -Method Post -Uri 'http://localhost:8180/api/auth/demo-doctor').accessToken
$env:POST_E50_E2E_TOKEN = $token
npm run test:e2e:post-e50-demo-flow
```

## UI Scope

No broad redesign is part of Stage 89. Only small defects that block a stable presentation should
be changed.
