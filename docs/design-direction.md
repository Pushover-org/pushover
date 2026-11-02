# Design direction: Court Ledger (owner decision 2026-11-02)

Rightful Share decides who gets paid from a court-supervised fund. The design problem is
**trust**: a judge, a class member and an analyst must all believe every dollar has a reason.
So the product looks like a well-kept ledger and a court record, not an AI startup.

Re-read this file before building or changing any screen.

## The rules of the style

**Colour.** Light-first, on warm paper.
- Base `--paper` #F4F1E8; surfaces `--paper-2` #ECE8DC and `--card` #FBFAF5; hairlines are ink
  at 12%.
- Text is ink #15140F at 100 / 64 / 44%.
- **One accent: ledger green** `--green` #0D5C46, used for the primary action, the money that
  reaches people, the thread line and focus rings.
- State colours, used **only for state**:
  - approve: green (the same accent)
  - deny: `--red` #A3321F
  - review: `--amber` #9A6A00
  - need more: `--blue` #2B4C8C
  These look like rubber-stamp inks, never neon.
- The admin grid uses the same tokens. A dark theme may come later for the admin only.

**Type.**
- Display: **Instrument Serif** (OFL), large and tight (-0.02em), with italics for the one word
  that matters.
- UI: **Geist**.
- Numbers, codes, IDs and labels: **Geist Mono** with `tabular-nums`.
- Labels are mono, upper-case, 11–12px, letter-spaced 0.08em (e.g. `02 · THE PILE`).
- Fluid sizes use `clamp()`.

**Shape and space.**
- Pill buttons with a leading dot (`● Open the claims desk`).
- Cards have a 14px radius and a hairline border, never a heavy shadow. Paper gets a
  1px-offset "stack" shadow only on the check.
- 8pt spacing. Generous margins. A 12-column grid on desktop with `+` crosshair marks at the
  section corners.

**Motion.**
- One easing family, `expo.out` (`cubic-bezier(0.16,1,0.3,1)`).
- Durations: 0.2s for micro, 0.6s for UI, 1.2s for hero moments only.
- Things move to explain a state change: a stamp lands, a claim leaves the pile, money moves
  along the bar. Nothing moves just to decorate.

**Signature moment: the check.**
- A paper check made for an honest claimant, with a guilloche border, a MICR line and a
  hand-drawn signature.
- Its amount starts at what pay-everyone gives ($8.23) and rises to what Rightful Share gives
  ($14.00) as the bot claims are struck out. These are the measured R9 pilot numbers, n = 32.
- It is the one object that tilts and catches the light.

**The thread.** A single ledger-green rule runs down the landing page and links the sections
(the pile → the checks → the payout). It is the line on a ledger, and the line you sign on.

**Copy.** Plain words, short and confident. Every number on a page is real and says where it
came from (pilot n, sandbox batch ID, a source URL).

| Jargon | Say instead |
|---|---|
| class member | you / the claimant |
| adjudicate | decide |
| cy-près | "leftover money goes to the court's chosen charity (cy-près)" |
| NEED_MORE | "We need one more document" |
| REVIEW | "A person will check this" |
| C3 ARITHMETIC_MISMATCH | "The receipt's numbers don't add up" |
| perceptual hash | "the same photo, filed again" |
| payer_id | "your PayPal account" |

## Anti-patterns (these break the style)

- A second accent colour, or state colours used as decoration.
- Gradient text, glassmorphism, neon glows, purple.
- A WebGL background or a cursor effect on any app route (/demo, /claim, /admin, /report).
  The landing page gets at most one ambitious effect, and it is the check plus the pile.
- Fake content: invented testimonials, logos of real companies, numbers we didn't measure.
- The demo settlement presented as real. It always says "(fictional demo)".
- Spinners everywhere: use skeletons. Errors without a fix.
- Chat bubbles or "AI magic" sparkles. The model reports findings; it doesn't talk.
- Pure white (#fff) pages or pure black text: paper and ink only.

## Components and libraries

- `gsap` + ScrollTrigger and `lenis`, landing page only, with Lenis run off the GSAP ticker.
  Both are off with reduced motion and on touch devices.
- `@number-flow/react` for every changing money number.
- `motion` for app micro-interactions (stamp, sheet, list presence).
- `ag-grid-community` / `ag-grid-react` for the claims queue, review queue, payout items and the
  court report, themed from these tokens, with custom renderers (evidence thumbnail, stamp chip,
  payout pill).
- `lucide-react` icons, 1.5px stroke.
