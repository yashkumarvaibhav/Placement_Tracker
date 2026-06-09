# Graphic Identity

The core system originated in the **GWiz** app and now also covers the personal portfolio at
`yashkumarvaibhav.me`. It has two coordinated presentation layers:

1. **Editorial core** — flat white surfaces, IIITD teal, ink-grey text, hairline borders,
   Newsreader headings, and Arial UI.
2. **Cosmic hero** — a dark, animated first-screen environment used only for high-impact
   personal storytelling. It retains the same typography and teal identity.

The editorial core is the default. The cosmic layer is an intentional portfolio-specific
exception, not a replacement for the base system.

> Drop-in CSS custom properties are at the bottom — paste the `:root` block into any project.

---

## 1. Color

### Brand / Accent
| Token | Value | Use |
|---|---|---|
| `--accent` (IIITD Teal) | `#3fada8` | Primary accent: buttons, active states, links |
| `--accent-hover` | `#359a95` | Hover/pressed accent |
| `--accent-soft` | `rgba(63, 173, 168, 0.12)` | Tinted fills, selected rows, chips |
| `--accent-contrast` | `#ffffff` | Text/icons on an accent fill |

### Cosmic Hero Extension
| Token | Value | Use |
|---|---|---|
| `--cosmic-bg` | `#10191b` | Header and hero background only |
| `--cosmic-surface` | `rgba(20, 44, 46, 0.92)` | Achievement planets and dark floating objects |
| `--cosmic-teal` | `#66dcd5` | Stars, scan lines, illuminated orbit points |
| `--cosmic-text` | `#f5f8f8` | Hero display heading |
| `--cosmic-body` | `rgba(255, 255, 255, 0.64)` | Hero supporting copy |
| `--cosmic-line` | `rgba(102, 220, 213, 0.30)` | Orbits and highlighted celestial outlines |

`--cosmic-teal` is a light-emitting extension of the main teal, not a second brand color.
Do not use it as the primary accent on white pages.

### Ink / Text (neutral scale)
| Token | Value | Use |
|---|---|---|
| `--text-strong` (`--ink-900`) | `#333333` | Headings, key facts |
| `--text-body` (`--ink-800`) | `#4d4d4d` | Body copy |
| `--text-muted` (`--ink-700`) | `#666666` | Secondary text |
| `--text-faint` (`--ink-500`) | `#808080` | Captions, metadata, disabled |

### Surfaces & Lines
| Token | Value | Use |
|---|---|---|
| `--bg-page` / `--bg-raised` | `#ffffff` | Page + cards |
| `--bg-sidebar` | `#f5f6f6` | Sidebar / soft surface |
| `--bg-user-bubble` | `#f1f1f0` | User message bubble |
| `--bg-code` | `#f4f6f6` | Inline/code blocks |
| `--bg-hover` | `rgba(51, 51, 51, 0.05)` | Row/button hover |
| `--border` | `rgba(51, 51, 51, 0.10)` | Hairline borders |
| `--border-strong` | `rgba(63, 173, 168, 0.35)` | Emphasised (teal) borders |

### Status & Feedback
| Token | Value | Meaning |
|---|---|---|
| `--danger` | `#8d2a2a` | Errors, destructive |
| `--status-tackled` | `#3b6fb0` | Done / handled (blue) |
| `--status-sent` | `#2f9e6f` | Sent / success (green) |
| `--urgency-high` | `#d9822b` | High urgency (amber) |
| pending / normal | `var(--accent)` | Active — uses teal |
| read / low | `var(--text-faint)` | De-emphasised — uses faint grey |

---

## 2. Typography

| Role | Stack |
|---|---|
| **Serif** (display, headings, assistant prose) | `"Newsreader", Georgia, "Times New Roman", serif` |
| **Sans** (UI, body, controls) | `Arial, "Helvetica Neue", "Segoe UI", Geneva, sans-serif` |
| **Mono** (code) | `ui-monospace, "SF Mono", Menlo, Consolas, monospace` |

- **Signature face:** [Newsreader](https://fontsource.org/fonts/newsreader) — a literary serif, loaded at weights **400 / 500 / 600**. It carries the brand's "editorial" feel: the **GWiz** wordmark, headings, and long-form/assistant text are all serif. UI chrome and dense data stay in Arial.

### Type scale
| Element | Size | Line height | Tracking |
|---|---|---|---|
| `h1` (display) | `clamp(2.8rem, 4vw, 4.6rem)` | `0.96` | `-0.04em` (tight) |
| Portfolio hero `h1` | `clamp(3.7rem, 6.8vw, 7rem)` | `0.88` | `-0.055em` |
| Portfolio section `h2` | `clamp(2.8rem, 5.4vw, 5.25rem)` | `0.98` | `-0.045em` |
| `h2` | `1.7rem` | — | slight negative |
| `h3` | `1.1rem` | — | — |
| Body | `1rem` | `1.65` | normal |
| Eyebrows / labels (UPPERCASE) | small | — | `+0.04em` to `+0.18em` (open) |

Rule of thumb: **display headings track tight and negative; uppercase labels track wide and positive.**

---

## 3. Shape & Elevation

| Token | Value |
|---|---|
| `--radius-lg` | `16px` (cards, panels) |
| `--radius-md` | `12px` (buttons, inputs) |
| `--radius-sm` | `10px` (chips, small controls) |
| `--shadow-sm` | `0 1px 2px rgba(51, 51, 51, 0.06)` |
| `--shadow` | `0 8px 24px rgba(51, 51, 51, 0.08)` |

Borders are **hairline** (`rgba(51,51,51,0.1)`); shadows are **soft and rare**. The look is flat — depth comes from borders and the soft sidebar tint, not heavy shadows.

---

## 4. Principles

1. **Editorial by default** — white surfaces and soft grey section fills remain the base experience.
2. **One accent** — teal `#3fada8` does all the work; everything else is ink-grey neutrals.
3. **Serif + sans contrast** — Newsreader serif for voice (wordmark, headings, prose); Arial for the machine (UI, data, controls).
4. **Hairlines over shadows** — structure with thin borders; reserve soft shadows for true elevation.
5. **Generous rounding** — 10–16px radii throughout.
6. **Spectacle has a boundary** — cosmic visuals belong in the portfolio hero. Project, experience, education, and recognition sections stay restrained and readable.
7. **Information before decoration** — achievement planets communicate real facts. Decorative stars, galaxies, meteors, and asteroids remain `aria-hidden` and never cover text or controls.
8. **Claims stay evidence-based** — describe concrete work: C++ backend systems, full-stack applications, applied deep learning, algorithms, measurable project scope, and verified achievements.

### Gradient Rule

The editorial UI does not use gradients for cards, buttons, or page surfaces. Very subtle
CSS gradients are permitted only as rendering tools in the cosmic hero, for example meteor
tails, grid masks, and light falloff. They must not introduce extra brand colors or reduce
text contrast.

---

## 5. Portfolio Composition

### Hero

- Full-viewport dark cosmic field with a two-column desktop layout.
- Left column owns all primary reading and interaction: status, headline, introduction,
  calls to action, and profile links.
- Right column owns identity and credentials: portrait, orbital rings, and achievement planets.
- Achievement planets must remain inside the portrait-side orbital container. They may overlap
  decorative rings and the portrait edge, but never the headline, description, buttons, or links.
- On mobile, text and controls render first; the portrait universe starts below the social links.

### Content Sections

- Maximum content width: `1240px`.
- Use large vertical spacing (`90–120px`) and hairline dividers instead of boxed dashboards.
- Project entries are editorial rows, not generic card grids.
- Soft grey is reserved for alternating section emphasis.
- Keep one clear purpose per section: work, experience, credentials, recognition, contact.

### Voice

- Direct, factual, and technically specific.
- Prefer “C++ backend systems, full-stack applications, applied deep learning, and algorithms”
  over broad phrases such as “systems that think” or unsupported product-design claims.
- Use exact metrics only when supported by the current resume or project implementation.

---

## 6. Motion System

Motion should create a living universe without turning the page into a video backdrop.

| Motion | Typical timing | Purpose |
|---|---|---|
| Star drift / constellation parallax | Continuous, very slow | Spatial depth and pointer response |
| Orbital rotation | `22–34s linear` | Persistent ambient movement |
| Planet float | `6–9s ease-in-out` | Separate achievement bodies visually |
| Meteor pass | `8–11s`, mostly idle | Occasional high-energy event |
| Portrait scan | `5s ease-in-out` | Technical identity detail |
| Content reveal | `0.5–0.8s` | Establish reading order |

Rules:

- Ambient motion must not move content text or controls.
- Pointer parallax affects only the canvas star field.
- Avoid rapid flashing, hard cuts, and constant large-scale movement.
- Decorative layers use `pointer-events: none`.
- Respect `prefers-reduced-motion`; animations become effectively static and canvas animation stops.
- Keep the canvas particle count responsive to viewport area and cap device pixel ratio at `2`.

---

## 7. Accessibility & Responsive Rules

- Maintain readable contrast on both white and `#10191b` surfaces.
- Meaningful achievement text remains in the DOM; purely decorative space objects are hidden
  from assistive technology.
- All profile icons require accessible labels and visible hover/focus behavior.
- Do not encode essential information only through animation, position, or color.
- At `850px`, the hero becomes a single-column composition.
- At `560px`, social links become icon-only controls with labels retained for assistive technology.
- Validate at narrow mobile widths to ensure orbital facts do not overlap the hero links.

---

## 8. Drop-in CSS

```css
:root {
  /* Brand */
  --accent: #3fada8;          /* IIITD teal */
  --accent-hover: #359a95;
  --accent-soft: rgba(63, 173, 168, 0.12);
  --accent-contrast: #ffffff;

  /* Portfolio cosmic extension */
  --cosmic-bg: #10191b;
  --cosmic-surface: rgba(20, 44, 46, 0.92);
  --cosmic-teal: #66dcd5;
  --cosmic-text: #f5f8f8;
  --cosmic-body: rgba(255, 255, 255, 0.64);
  --cosmic-line: rgba(102, 220, 213, 0.30);

  /* Ink / text */
  --text-strong: #333333;
  --text-body: #4d4d4d;
  --text-muted: #666666;
  --text-faint: #808080;

  /* Surfaces */
  --bg-page: #ffffff;
  --bg-sidebar: #f5f6f6;
  --bg-user-bubble: #f1f1f0;
  --bg-code: #f4f6f6;
  --bg-hover: rgba(51, 51, 51, 0.05);

  /* Lines */
  --border: rgba(51, 51, 51, 0.10);
  --border-strong: rgba(63, 173, 168, 0.35);

  /* Status */
  --danger: #8d2a2a;
  --status-tackled: #3b6fb0;
  --status-sent: #2f9e6f;
  --urgency-high: #d9822b;

  /* Shape & elevation */
  --radius-lg: 16px;
  --radius-md: 12px;
  --radius-sm: 10px;
  --shadow-sm: 0 1px 2px rgba(51, 51, 51, 0.06);
  --shadow: 0 8px 24px rgba(51, 51, 51, 0.08);

  /* Type */
  --font-serif: "Newsreader", Georgia, "Times New Roman", serif;
  --font-sans: Arial, "Helvetica Neue", "Segoe UI", Geneva, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  color: var(--text-strong);
  background: var(--bg-page);
  font-family: var(--font-sans);
}

h1, h2, h3 { font-family: var(--font-serif); color: var(--text-strong); }
h1 { font-size: clamp(2.8rem, 4vw, 4.6rem); line-height: 0.96; letter-spacing: -0.04em; }
body { line-height: 1.65; color: var(--text-body); }
```

Newsreader is free (OFL). Add its optical-size variable build via `@fontsource/newsreader`
or Google Fonts:
`https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap`
