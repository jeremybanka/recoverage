---
"recoverage": patch
---

⬆️ Update `comline` to `0.8.0`, with documented support for `recoverage.config.json`. Set `defaultBranch` once for capture and diff, with command-line options taking precedence.

✨ Add shell completion for Bash, Zsh, Fish, Nushell, and Carapace, including local Git branch suggestions and explicit completion installation.

✨ Accept `--default-branch` alongside `--defaultBranch` and `-b`, and display warnings on stderr for unknown or ignored options.

🐛 Honor the selected default branch during capture, including when running capture and diff together.
