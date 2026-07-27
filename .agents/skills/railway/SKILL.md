---
name: railway
description: Query Railway's API to check real deployment state during development — env vars actually set, deployment status, project/service info. Use when the user wants to verify something on Railway rather than assume it from local state.
---

# Railway API

Bearer-token access to Railway's GraphQL API, for checking real Railway state during development. Read-only checks, not for making changes.

## Auth

Token lives in `RAILWAY_API_TOKEN` in `.env`. Generate one at Railway → Account Settings → Tokens (account-wide) or Project Settings → Tokens (scoped to one project+environment).

- **Account token**: `Authorization: Bearer $RAILWAY_API_TOKEN`
- **Project token**: `Project-Access-Token: $RAILWAY_API_TOKEN` instead

Endpoint: `https://backboard.railway.com/graphql/v2` (POST, JSON body `{"query": "...", "variables": {...}}`).

## Verify the token works

```bash
curl --request POST \
  --url https://backboard.railway.com/graphql/v2 \
  --header "Authorization: Bearer $RAILWAY_API_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"query":"query { me { name email } }"}'
```

## Finding other queries

Field names for projects/services/deployments/variables shift over time — don't guess them from memory. Two reliable sources:

1. **Introspect the live schema** (always accurate):
   ```bash
   curl --request POST \
     --url https://backboard.railway.com/graphql/v2 \
     --header "Authorization: Bearer $RAILWAY_API_TOKEN" \
     --header 'Content-Type: application/json' \
     --data '{"query":"query { __schema { queryType { fields { name description } } } }"}'
   ```
   Then introspect a specific type once you know its name.
2. **WebFetch `https://docs.railway.com/reference/public-api`** — links to per-resource example queries (Manage Projects/Services/Deployments/Variables).
