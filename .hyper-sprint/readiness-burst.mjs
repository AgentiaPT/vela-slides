export async function run(page, ctx) {
  const {
    counter,
    editHeading,
    exitPresent,
    galleryState,
    navKey,
    openExportMenu,
    openGallery,
    presentKey,
    snapshotActions,
    waitForSavedHeading,
  } = await ctx.verbs();
  const started = Date.now();
  const trace = [];
  const step = async (name, fn) => {
    const t0 = Date.now();
    const value = await fn();
    trace.push({ name, ms: Date.now() - t0, value });
    return value;
  };

  await step("editor-boot", async () => {
    const reset = await ctx.reset();
    const actions = await snapshotActions(page);
    if (!actions.buttons.some(text => /Present/.test(text))) {
      throw new Error("editor-boot: Present control is absent");
    }
    return { reset, testids: actions.testids.length, buttons: actions.buttons.length };
  });

  const edited = await step("heading-edit", async () => {
    const text = await editHeading(page, 0, " READY");
    if (!text.endsWith("READY")) throw new Error("heading-edit: text did not change");
    return text;
  });
  await step("save-state", () => waitForSavedHeading(page, edited));

  await step("presenter-entry", async () => {
    await ctx.reset();
    await presentKey(page);
    const state = await counter(page);
    if (!state) throw new Error("presenter-entry: presenter state is absent");
    return state;
  });
  const before = await counter(page);
  await step("presenter-next", async () => {
    await navKey(page, "ArrowRight");
    const after = await counter(page);
    if (!after || JSON.stringify(after) === JSON.stringify(before)) {
      throw new Error("presenter-next: slide did not change");
    }
    return { before, after };
  });
  await step("presenter-safe-exit", async () => {
    await exitPresent(page);
    return true;
  });

  await step("gallery-entry", async () => {
    await ctx.reset();
    await openGallery(page);
    const state = await galleryState(page);
    if (!state.open) throw new Error("gallery-entry: gallery did not open");
    return state;
  });

  await step("export-menu", async () => {
    await ctx.reset();
    await openExportMenu(page);
    const open = await page.evaluate(() => !!document.querySelector("[data-testid=export-pptx-menu-item]"));
    if (!open) throw new Error("export-menu: PowerPoint item is absent");
    return true;
  });

  await step("in-memory-reset", async () => {
    const reset = await ctx.reset();
    const state = await page.evaluate(() => ({
      booted: window.__velaBooted === true,
      editor: !!document.querySelector("header"),
      gallery: /GALLERY/.test(document.body.textContent),
      exportItem: !!document.querySelector("[data-testid=export-pptx-menu-item]"),
      editedHeading: [...document.querySelectorAll("[data-block-type=heading]")]
        .some(el => el.textContent.trim().endsWith("READY")),
    }));
    if (!state.booted || !state.editor || state.gallery || state.exportItem || state.editedHeading) {
      throw new Error(`in-memory-reset: unexpected state ${JSON.stringify(state)}`);
    }
    return { reset, state };
  });

  return { totalMs: Date.now() - started, trace };
}
