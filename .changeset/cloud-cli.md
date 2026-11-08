---
"recoverage": patch
---

✨ Manage recoverage.cloud from the CLI with GitHub device login, project initialization, account and project status, and reporter token creation and revocation. Keep account credentials separate from project-scoped CI tokens, and revoke account sessions with `cloud logout`.

✨ Configure an explicit cloud project and report name in `recoverage.config.json`. Capture and diff use locally stored reporter credentials, with environment tokens retaining precedence. Cloud commands support JSON output and explicit project selection for scripts.

✨ Use Hono's RPC client with request and response types generated from the cloud server's routes and JSON validators. Keep the HTMX web UI and detect stale CLI contracts during static checks.
