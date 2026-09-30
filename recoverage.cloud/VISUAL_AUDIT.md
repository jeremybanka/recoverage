# Recoverage visual audit

Date: September 30, 2026. Scope: current public site, public billing preview, and pinned source for the existing and new interfaces.

## Evidence and limits

- Current site: https://recoverage.cloud/ . Public HTML and its two texture assets were fetched without cookies or sign-in.
- Preview: https://recoverage-billing-preview.7tffcqc6vs.workers.dev/ and its public `/support` page. Public HTML was fetched without cookies or sign-in.
- Current main was resolved through GitHub to `a4d86f2f817e8a4f03f3989b27dfb4394c93006a`; eight relevant source files were downloaded at that immutable commit. Main does not contain the new billing, pricing, support, or usage components.
- Preview source before this work: `725186a8f1afdd30fddea03ce023653b8cce7ed5`, checkout `recoverage-stable-preview`.
- Public responses, pinned main source, and a hash manifest are retained in the task workspace `visual-audit-evidence/`. The source links below are the durable public evidence.
- **This is source and response evidence, not a rendered screenshot audit.** This agent's tool inventory has no supported browser/computer control; executor skill discovery returned no skills. The parent reports the same limitation. No browser session, credentials, private pages, screenshots, computed styles, or rendered viewport measurements were inspected. No browser automation workaround was used.
- Main is source provenance, not proof of the production deployment commit. However, the live home response exactly matches its relevant shell styling, and the live texture assets match the source.

The live and preview home pages have identical extracted CSS (SHA-256 `6719130e3cf7c0f7ee8c8807a7e55d381e7c6eefaa85427577c1112f4aeb1517`). Their text is also identical: Recoverage, its micro-platform description, and Login with GitHub. Their HTML differs in login plumbing, not those styles. The anonymous landing page is consequently not evidence of a new visual regression. The differences are in authenticated additions and component layout.

## Existing visual language

The interface uses a small, centered, solid panel on a fine patterned field. Hierarchy comes from narrowly stepped gray fills, precise one-pixel outlines, hard shallow shadows, and corners chosen by component function. It is compact and mechanical rather than soft or floating. These observations are interpretations of explicit CSS values below.

### Background and page frame

Source: [pinned Page](https://github.com/jeremybanka/recoverage/blob/a4d86f2f817e8a4f03f3989b27dfb4394c93006a/recoverage.cloud/src/page.tsx) (body and main); same CSS present in both public home responses.

| Property | Existing value | Design role |
| --- | --- | --- |
| Body texture | `/assets/dots.svg`, repeated at `4px 4px` | Fine texture around the main frame |
| Texture offset and blend | `0px -100px`, `background-blend-mode: overlay` | Positions the small repeating pattern and blends it with the base surface |
| Body layout | flex column, `min-height:100svh`, margin `0`, padding `5px` | Centers a bounded workspace while retaining a thin viewport gutter |
| Main width | `width:100%`, `max-width:630px`, border-box | Narrow reading and management workspace |
| Main spacing | `padding:40px 15px 20px`, `margin:auto`, `min-height:500px` | Breathing room above the content and a stable small-page frame |
| Main fill | `var(--color-bg-t1)` | One tint above the outer canvas |
| Main border | `1px solid var(--color-fg-light)` | Visible, continuous frame |
| Main shadow | `0 4px 0 -2px #0003` | Small hard lower edge; no blur |
| Main corners | No radius declaration | Square outer frame |

Live dots SVG: a black circle at `(1024,1024)`, radius `1024`, in a `2048 × 2048` viewBox. This is not a photograph/noise image. Do not replace it with a large grain overlay or gradient.

### Tint and shade scale

All values below come from `Page`; dark is the default, light switches under `prefers-color-scheme: light`.

| Token | Dark | Light | Existing role |
| --- | --- | --- | --- |
| `--color-bg-s2` | `#050505` | `#eee` | Deepest sunken/deleted surface |
| `--color-bg-s1` | `#121212` | `#f3f3f3` | Secondary depressed/deleted surface |
| `--color-bg` | `#222` | `#f6f6f6` | Canvas and input wells |
| `--color-bg-t1` | `#2a2a2a` | `#f8f8f8` | Page and report sockets |
| `--color-bg-t2` | `#353535` | `#fbfbfb` | Project containers |
| `--color-bg-t3` | `#424242` | `#fff` | Tokens, forms, report faces, buttons |
| `--color-fg` | white | black | Primary content, active control outlines |
| `--color-fg-light` | `#777` | `#888` | Container outlines and ancillary labels |
| `--color-fg-superlight` | `#666` | `#aaa` | Disabled control text and border |
| `--color-fg-faint` | `#555` | `#ddd` | Empty/deleted outlines and separators |
| `--hyperlink` | `#0ff` | `#00f` | Links |
| `--hyperlink-active` | `#f80` | `#f00` | Pressed links |
| `--hyperlink-visited` | `#f5f` | `#a0a` | Visited links |
| `--success` | `#0f0` | `#080` | Positive information such as revealed token values |

The layering is deliberate: canvas → main → project → token/control. Creating a uniform flat fill across all those elements loses hierarchy. Equally, arbitrary blue/white gradients and soft shadows introduce a second visual language. Dark and light share the hierarchy through variables; hard-coded white text should not be used over a light tinted surface.

Existing muted colors do not establish an accessibility guarantee. In particular, `#888` is used as secondary text on very light surfaces. New instructional billing text should use the primary foreground instead of copying low-contrast decorative labels. Screen-rendered and computed contrast validation is still pending.

### Shadow vocabulary and physical meaning

| Context | Existing exact shadow | Meaning |
| --- | --- | --- |
| Main, project, token, report face | `0 4px 0 -2px #0003` | Raised item with a narrow hard bottom edge |
| Buttons, revealed-token strip | `0 3px 0 -2px #0003` | Slightly raised action or strip |
| Inputs, report sockets, empty report slot | `inset 0 1px 0 1px #0002` | Recessed well |
| Pressed button | `inset 0 1px 0 1px #0002` | Action is physically pushed in |
| Deleted project/token | `inset 0 4px 0 -2px #0003` | Former raised item recedes |
| Coverage percent tag | `0 2px 0 -1px #0005` | Tiny raised annotation |

There is no soft 20px ambient shadow in the old components. Preserve zero blur for added billing surfaces. A repeated inner highlight (`inset 0 1px 0 #fff1`) is also not part of the old card vocabulary.

### Borders and corner grammar

CSS shorthand order is top-left, top-right, bottom-right, bottom-left.

| Component | Border | Corners |
| --- | --- | --- |
| Main frame | 1px muted outline | Square |
| Project | 1px muted outline | `10px 0 10px 0` |
| Token | 1px muted outline | `10px 0 10px 0` |
| Name form | 1px muted outline | `10px 0 10px 0` |
| Create/Submit | 1px primary foreground | `0 0 5px 0` (bottom-right only) |
| Delete × | 1px primary foreground | `0 0 0 5px` (bottom-left only) |
| Copy | 1px primary foreground | `5px 0 5px 0` |
| Input | 1px primary foreground | Square |
| Report socket/face | 1px muted/faint outline | Square |
| Coverage percentage | 1px faint outline | `10px` all corners, a small pill annotation |
| Newly revealed token value | `2px dotted green` | Square |

The isolated pill is not precedent for pill-shaped cards/buttons. The opposing top-left and bottom-right corner pair is the dominant container signature. The delete control rounds the opposite bottom corner because it is a distinct destructive control. New panels should adopt the container signature rather than alternating arbitrary 16px corner combinations.

### Typography, density, and decoration

- Body uses system `sans-serif`; no custom font is loaded in the inspected source.
- Most text/headings use browser sizes; project h3 and token h5 reset margins to zero with a 5px top margin.
- Mini labels are `9px`, uppercase, `letter-spacing:0.15em` (`header.tsx`). They identify object kinds, not long instructions.
- Card interiors use 10px padding (project bottom padding 12px); compact internal gaps are 5px or 10px.
- Form input is 16px with 10px padding; button padding is 10px. Delete is 15px with `6px 10px 7px` padding.
- Report sockets use 2px padding, minimum 80px width; faces use `9px 10px 11px`. Empty slots are 80 × 46px.
- Section headings use a 30px-high diagonal-texture strip before the label; `background-size:4px 40px`, position `0px -8px`, margin top 10px/bottom 5px (`h4.tsx`). Live diagonal asset is a black line from `(0,0)` to `(2048,2048)` with stroke width 512. Preserve this established detail in Reports/Tokens; don't sprinkle it on every new paragraph.
- Existing report lists wrap horizontally with a 10px gap. Project and token cards depend on surrounding flex columns for vertical separation.

### Interaction and responsive evidence

- Disabled create/delete/copy controls use transparent fill, no shadow, muted text/border, with the same geometry. The preview correctly adds actual HTML `disabled` attributes absent on main; retain that behavioral fix.
- Existing pressed buttons refer to undefined `--bg-color-s2` instead of defined `--color-bg-s2`. This prevents the intended pressed fill. The shadow still changes; repairing the token reference completes the established interaction.
- Browser focus outlines are not explicitly removed by the existing primitives. Preserve keyboard focus rather than resetting it for visual cleanliness.
- Existing splash link has explicit normal/visited/active colors. Other unstyled new anchors do not automatically inherit that CSS because it is scoped to the splash anchor.
- Source supports a fluid ≤630px frame, wrapped report rows, and wrapped pricing headers. There is no source evidence of a separate mobile redesign. Actual narrow-view overflow, focus, zoom, OS theme, and rendering remain unobserved.

## Regression findings and implementation

### High-confidence differences

1. **Project/token card gaps disappeared after adding wrappers.** `ui.tsx` adds `#project-list` and `project.tsx` adds `#tokens-ID`. The old parent's 10px flex gap affects these new wrappers as a single child, not the cards inside them. Fix: both wrappers become vertical flex containers with a 10px gap. Preserve their IDs, HTMX targets and request behavior.
2. **Billing management was browser-default UI.** `BillingAccountPage` had headings, paragraphs, links and an unstyled `<button>`, but no surface hierarchy. Fix: group current status and actions in an established project-like panel; use the existing submit-button primitive; render status/preservation guidance as recessed notes. All state branches and copy remain.
3. **Usage/support were unstyled additions.** Account usage and billing support were bare paragraphs/aside. Fix: shared panel styling with existing 10px corners, outlines, tint and hard shadow. Storage guidance gets a square recessed note, not a new marketing card style.
4. **Pricing introduced competing geometry.** Former cards used `0 16px 4px 4px` / `4px 4px 0 16px`, colored gradients, inner highlights, and `0 8px 20px #00000024`. Fix: use shared `10px 0 10px 0` panels, stepped gray backgrounds and hard shadows. Supporter is distinguished through its existing semantic label color and stronger outline, without a second gradient system.
5. **Upgrade CTA used hard-coded white text on a pale light-theme gradient.** Fix: use the existing submit primitive, whose foreground switches with the page theme. Keep the POST/form route, enabled state and $1/month semantics untouched.
6. **Information precedes the task.** Pricing placed all support/refund guidance before the plan cards. Fix: keep the short introduction, show plans/actions, then storage and support information. No wording or decisions change.
7. **Pressed fill had a shared typo.** Fix all four existing button variants to reference `--color-bg-s2`; limit active styling to enabled controls, preserving disabled presentation.
8. **New links needed the site's colors.** Shared panel/navigation styles apply normal, visited and active link tokens locally to new billing surfaces; they do not globally restyle the entire site.

### Presentation changes made locally

- `src/presentation.ts`: shared panel, inset note and navigation styles, derived from existing primitives. Includes safe wrapping for long support strings and narrow containers.
- `src/pricing.tsx`: shared card surfaces, hard-shadow role badge, existing submit action, primary-foreground explanatory text, inset current-plan indicator, reordered guidance below plan choices.
- `src/billing-account.tsx`: styled navigation, status notice, current-plan/action panel, existing submit control, retention note.
- `src/support.tsx`: shared support panel.
- `src/usage.tsx`: shared usage panel and recessed storage guidance; HTMX attributes unchanged.
- `src/button.tsx`: correct pressed-surface token and avoid depressed styling for disabled controls.
- `src/ui.tsx` / `src/project.tsx`: restore child-card gaps inside the new wrappers.

No pricing, quotas, permission checks, payment state logic, form actions, URLs, secrets or account data are changed. No live/preview deployment is part of this audit. No mocks or CI calls to live servers were added.

### Local validation

- Three existing billing presentation tests pass: return parameters cannot establish paid status, a pending return does not offer another purchase, and billing distinguishes payment state/role/cancellation/manual assignment. Six unrelated tests were deliberately excluded from this focused run.
- Adding CSS exposed an existing test-rendering assumption: `String(await Component(...))` does not await Hono's asynchronous CSS rendering. These assertions now use a local Hono `c.html` response and `response.text()`, the real response-rendering mechanism. No response mocks, network stubs, or live services were introduced.
- Full Page rendering for the new Free plans and billing views was executed locally through Hono. Both yielded HTTP 200, generated the shared panel and button CSS, retained their exact POST form actions, used theme foregrounds, and contained no former pricing gradient. Resulting HTML is saved as `visual-audit-evidence/rendered-plans.html` and `rendered-billing.html`; these are synthetic local component inputs, not authenticated-site captures or browser screenshots.
- TypeScript main check passed before and after implementation. Scoped ESLint, Biome, formatting, and whitespace checks are recorded separately in the implementation handoff.
- Initial sandboxed formatting/test launches were prevented by a cache path outside the writable directory and local socket permissions. Formatting was rerun with its cache inside the task directory; the local Workers test run used the reviewed localhost permission with logs inside the task directory. No security/trust settings were bypassed.

## Remaining visual validation

Source fidelity can be verified now, but final visual approval requires supported browser access. Review actual rendered pages at approximately 375px and 1280px viewport widths, in both light and dark OS themes, at normal and 200% zoom:

1. Public home: unchanged dot texture, square 630px frame and original spacing.
2. Authenticated home: multiple projects and tokens retain 10px gaps; usage additions do not overwhelm the existing hierarchy.
3. Billing: Free, active Supporter, pending payment, scheduled cancellation, paused purchase and disabled portal states; status copy remains distinguishable from actions.
4. Plans: light-theme CTA legible; Free/Supporter share corner and shadow language; supporting policy text follows the choice.
5. Focus/active/disabled: keyboard outline visible, pressed fill and inset shadow visible only on enabled actions, native disabled behavior preserved.
6. Long project names, support addresses, labels and narrow forms: no horizontal page overflow or clipped actions. Existing name-form flex overflow risk predates this work and is not established as a rendered failure.

Do not claim screenshot parity, mobile pixel accuracy, or measured accessibility compliance from this source-only audit. Those checks remain a specific evidence gap, not a reason to discard the verified improvements.

## Rendered Safari Technology Preview follow-up

A separate browser review inspected live `recoverage.cloud` and the stable billing preview at commit `a0236f1ce86d1e4a1c52b30e7006b01ed9a2e924`, using the user's Safari Technology Preview. Screenshots remain in the browser review thread. At a 1598×1146 window in light theme, the square frame, dot texture, raised tints, crisp shallow shadows, TL/BR card corners and approximately 10px project spacing matched the existing site vocabulary. Home, billing, plans and support rendered without clipping or an internal error. The account remained active Supporter.

The review identified three corrections:

- Full support/refund copy plus usage occupied roughly 224px above projects; the first project began around 634px from the screen top. Home now links to full support details instead of repeating the policy card, and usage counts share a wrapping row. Billing, plans and support retain the full copy and quota warnings remain visible.
- Support had no return navigation. It now links to projects, billing and plans using the shared navigation styling.
- Home's visited navigation used browser-default dark purple. Its navigation now uses the same normal, visited and active theme tokens as billing and plans.

At native page zoom 300% in a 1282px window (approximately 427 CSS pixels), sampled home, billing, plans and support views showed no overlap or horizontal overflow. Quota items wrapped, the active badge remained inside its card, and the long fixture project name and delete control fit. This establishes zoom/reflow behavior, not mobile emulation. The reviewer restored 100% zoom and the original window size. Dark theme, actual mobile devices and comprehensive keyboard/accessibility checks remain unverified. A rendered recheck of the three corrections is required after deployment.

The rendered recheck of `f48f75b` passed the three corrections: the first home project moved from approximately y634 to y426 (208px gained), visited navigation used site magenta, and the home/support navigation worked. Usage wrapped cleanly at approximately 427 CSS pixels. A remaining narrow-view issue split navigation labels, leaving “support” or “plans” alone on a second line. The shared navigation now wraps whole links with consistent gaps; standalone separator bullets were removed so they cannot become stranded between rows. This final wrapping adjustment awaits rendered confirmation.
