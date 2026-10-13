# Elselife visual system rebuild

> For agentic workers: execute the independent visual tasks in this plan, then integrate and review the complete UI.

**Goal:** Implement the comprehensive UI redesign the user explicitly requested after approving the visual audit. Make typography, composition, materials, controls and motion feel deliberate across every current product surface.

**Architecture:** Keep existing story behavior, routing, saved data and semantic controls. Replace the current shared interface, product and reader presentation in their existing ownership files; no additional final-override stylesheet. Use shared design tokens, deliberate editorial layouts and a family of locally drawn world illustrations.

**Tech stack:** Existing native ES modules, CSS, Canvas 2D, Node HTTP, Node test runner.

**Design brief:** The preceding user-approved UI audit and this document. Warm ivory paper, clear charcoal text, mineral plum accents; strong editorial Chinese titles and quiet sans-serif controls. World windows use atmospheric layered vector scenery with fine graphic details. Avoid generic SaaS cards, enormous empty hero panels, excessive gradients, and decorative English copy.

## Global constraints

- Work on the current checkout: it contains the user's ongoing uncommitted implementation. Snapshot the visual sources first. Do not reset, commit unrelated work, or overwrite story records.
- Scope is comprehensive visual design, not story behavior or new product features.
- Shared tokens owned by interface.css: --bg #f5f3ee, --paper #fffefb, --ink #29252c, --muted #6e6771, --line #ddd7d2, --accent #69516f, --soft #eee8ef, --accent-ink #fffefb. Corresponding dark tokens must provide readable controls and surfaces.
- Shared aliases for product pages: --surface var(--paper), --text var(--ink), --secondary var(--muted), --edge var(--line), --brand var(--accent), --brand-soft var(--soft).
- Use local Noto Serif SC and Noto Sans SC first (installed on this host), with system fallback; prefer portable bundled open fonts if feasible. Preserve explicit reader font/size/spacing preferences.
- Shared scale: control radius 10px, field radius 12px, major surface radius 18px; 44px minimum principal touch targets. Thin borders plus a subtle highlight/shadow, no decorative nested cards everywhere.
- Existing classes, IDs, data-action hooks, accessibility semantics and business state remain compatible. Keep Chinese UI copy concise.
- Respect both system and application reduced-motion; never animate reading prose continuously. Hover feedback stays stable and restrained.

## Review focus

- Long Chinese titles and custom world descriptions must wrap or clamp without covering artwork or actions.
- 320/390px layouts and long mobile drafts must not overflow or hide controls.
- Dark mode must preserve control, error, selected and focus contrast.
- World card stretched links and option menus must remain independently operable.
- Modal/dossier content and keyboard focus must remain accessible after styling.

## Tasks

- [ ] 1. Shared foundation: rewrite interface.css tokens and common controls, refine product-shell brand markup if needed; unify font roles and dialogs. Owner: root.
- [ ] 2. Product surfaces: rebuild product-surfaces.css and appropriate library-ui.js / experience-views.js presentation. Cover discovery, resume, world library, detail, creator and settings. Owner: product agent. Consume shared tokens; do not alter business action semantics.
- [ ] 3. Reader: rewrite reading-finish.css to refine header, typography, annotation, composer, pending/error and auxiliary content. Owner: reader agent. Preserve layout requirements and settings.
- [ ] 4. World visual identity: evolve world-field.js and world-materials.css into a coherent family of atmospheric illustrations; refine existing decorative transitions only if needed. Owner: world agent. No external image/model calls.
- [ ] 5. Integrate and inspect current app in the browser at desktop and mobile widths, including dark and reduced motion in isolated preview. Fix visual collisions and verify actual user content with no submitted story actions.
- [ ] 6. Run appropriate existing tests, full suite, syntax and diff checks; review changed source and record screenshots/limitations. No CSS-mirroring tests; update affected structural assertions only if the public interface intentionally changed.

## Execution notes

The user authorized implementation directly based on the completed analysis; do not introduce another design approval stop. Independent file ownership allows parallel implementation. Existing business tests and real browser review are the acceptance checks for this visual refactor.
