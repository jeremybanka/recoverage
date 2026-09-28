---
"recoverage": patch
---

⬆️ Update `comline` to `0.9.0`, removing the native Nushell completion adapter's positional-input deprecation warning.

If you use native Nushell completion, Nushell `0.116.0` or newer is now required. Run `recoverage completion install nushell` (or regenerate your `.nu` file with `recoverage completion nushell`) and open a new shell to update the integration. Legacy completion providers may still emit their own warnings.
