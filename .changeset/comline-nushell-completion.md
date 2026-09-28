---
"recoverage": minor
---

⬆️ Update `comline` to `0.9.0`.

💥 BREAKING CHANGE: Native Nushell completion now requires Nushell `0.116.0` or newer. After upgrading, run `recoverage completion install nushell` (or regenerate your `.nu` file with `recoverage completion nushell`) and open a new shell.

🐛 Remove the native Nushell adapter's positional-input deprecation warning while preserving delegation to other completion providers. Legacy providers may still emit their own warnings.
