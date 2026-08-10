# Sprint "clarity" — plan (2026-07-23)

Codename **clarity** · base branch `main` · sprint branch `claude/sprint-ux-clarification-m7ot9d`

## Verbatim original prompt

> you are the orchestrator, you own this sprint outcomes. use hyper sprint, skill. but with one
> relevant improvement. some issues/change requests are still not fully 100% clear about final UX
> changes needed. identify which ones. for those requests dispatch a mixed po/pm/ux role that can
> explore the app to understand the issue and the best way to fix it according to modern UX
> practices and keep everything consistent
>
> the sprint issues are
> * Gallery view is not showing the section slides that have title card enabled, they should render
>   also as they will be presented
> * When focus is on toc in edit mode and focus is on a section left/right cursor should should
>   collapse or expand the selected section. Not sure about the behavior but the issue is that using
>   cursor moves the slides (ok) when the section is collapsed and we cannot so what slide we are in,
>   it counter intuitive needs improvement.
> * -when using on windows through neutralino. Somehow it stops saving to the windows file without
>   any hint or error, specially when I keep the file open through longer periods. Needs confirmation
>   and root cause
> * When pasting images, especially when there images already we need better heuristics for
>   placement. Ex adding a second image to a only slide image should likely add both side by side,
>   currently it adds in a single column which gets akward. But we should have good heuristic that
>   make full slide content balanvced, including any non image content. Should work up to 5 images.
> * When ai is working on a slide, ex. Ai edit, the full slide should have some kind of smooth
>   animation on top. I think there's already on some occasions, it should be consistent

## Change requests (parsed)

- **CR1 — Gallery title-card slides.** Gallery view omits section slides that have "title card"
  enabled; they must render as they'll be presented. *Clarity: CLEAR (bug).* → standard recon→worker.
- **CR2 — TOC collapse/expand on cursor.** In edit mode, when focus is on a section in the TOC,
  left/right should collapse/expand that section (today cursor moves slides even while collapsed, so
  you lose track of which slide you're on). *Clarity: AMBIGUOUS — user unsure of behavior.* →
  **PO/PM/UX discovery**.
- **CR3 — Neutralino silent save-stop (Windows).** On Windows via Neutralino, saving to the file
  silently stops (no hint/error), esp. when the file is kept open a long time. *Clarity: technical
  root-cause unknown; UX = surface failures.* → **root-cause investigation** (+ UX-surfacing rec).
- **CR4 — Image-paste placement heuristics.** Better placement when pasting images, esp. with
  existing content: 2nd image onto an image-only slide → side by side; balanced full-slide layout
  incl. non-image content; up to 5 images. *Clarity: AMBIGUOUS — heuristic undefined.* →
  **PO/PM/UX discovery**.
- **CR5 — Consistent AI-working animation.** When AI edits a slide, the whole slide should show a
  smooth animation overlay; exists in some cases, must be consistent. *Clarity: partly ambiguous —
  treatment + trigger states undefined.* → **PO/PM/UX discovery**.

## Improvement over base skill (as requested)

Ambiguous CRs (2, 4, 5) get a **mixed PO/PM/UX discovery agent** that explores the live app + code,
studies current behavior, and proposes the *final* UX per modern practice while keeping the app
consistent — written to a UX spec, surfaced to the user for confirm before implementation. CR3 gets
a **source-level root-cause investigation** (Windows/Neutralino only — not reproducible in the Linux
browser harness) that also recommends the failure-surfacing UX.

## Flow

0b. Readiness gate (delegated): boot offline render, baseline `test_vela.py`, smoke all surfaces
    (gallery, TOC edit, image paste, AI overlay, presenter). Entrypoint file crystallized.
Discovery. Parallel PO/PM/UX explorers (CR2, CR4, CR5) + root-cause investigator (CR3) → UX specs +
    code edit-maps. Batched user confirm on the proposed UX decisions.
1–3. Recon (CR1 folded into worker) → cluster by file-locality → worker sub-agents (worktrees for
    disjoint sets) → merge, suite green between merges.
4. Fix-round diverse-lens hunt.
5. Blind gate (hybrid: per-CR verifiers + cross-cutting hunters via burst-bug-hunter engine) →
    Markdown proof report + archive.

## What happened vs plan

Executed as planned. Discovery ran for the three ambiguous CRs (2, 4, 5) and root-cause investigation for
CR3; UX specs were written before implementation. Delivery used 4 parallel worktree workers (CR1+CR2, CR4,
CR5, CR3) → integrator merge (which also brought the branch up to date with main's security work) → changelog
dedup. The blind gate took **three rounds**: round 1 (7 validators) confirmed all 5 features present and found
8 in-scope defects (fixed in `cb02fa5`); round 2 (6 validators) found 2 regressions (fixed in `8076c3f`);
round 3 (3 validators) was clean (0 in-scope defects). Final: v13.19 → v13.20, `test_vela.py` 421 passed, UI
battery 220/0/9-skip deterministic across 3 reloads, concat in sync. 10 agent-found defects, all fixed.
Cost ~$161.49 (hub 25%), 27 sub-agents, ~130 min. Proof artifact: [`README.md`](./README.md).
