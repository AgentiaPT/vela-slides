// Fill this in — it is the ONLY file you edit for demo content. index.html renders it;
// no build, no CDN, no dependency on the app under test. Drop recordings into clips/
// and reference them from "video" slides. EDIT INCREMENTALLY across checkpoints (mid-
// sprint cost run, each new clip) — don't regenerate this file from scratch, and never
// re-encode/re-embed a clip or image that's already here (references/demo-deck.md).
// Slide types:
//   cover     {title, subtitle?, note?}
//   scope     {title, cols?, groups:[{title, items}]}         — the issue list
//   burndown  {title, bars:[{label, value, color?}], note?}   — progress vs total
//   metrics   {title, items:[{v, l}]}                          — headline numbers
//   bugs      {title, items:[{sev:'h'|'m'|'l', text}]}         — found & fixed
//   table     {title, headers:[], rows:[[...]], note?}        — generic data table
//   cost      {title, total?, totalLabel?, headers?, rows:[[agent,model,cost],...],
//              byModel?:[{label,v}], note?}                   — REQUIRED, see below
//   savings   {title, items:[], errors?:[str|{text,cost?}], note?} — REQUIRED, see below
//   video     {title, src, points?[] | caption, controls?}    — LIVE recorded proof
//   bullets   {title, items:[]}
// Every slide may add {kicker}. Keyboard: →/space/click next, ← back, f fullscreen.
//
// cost + savings are REQUIRED in the arc (SKILL.md principle 9, references/demo-deck.md):
// run `python3 ../sprint-cost.py --json cost.json` (or without --json for the printed
// table) and transcribe its rows/total/by-model rollup into the cost slide below; ground
// the savings slide's numbered ideas in what that breakdown actually shows.
//
// Attribution footer (optional, OFF by default): set `attribution: true` (or a custom
// string) at the top level to show a small "Powered by Hyper Sprint" footer. Leave it
// unset/false unless the caller explicitly opts in.
window.DECK = {
  accent: "#7c9cff",
  footer: "Sprint <name> · end-of-sprint review",
  // attribution: true,
  slides: [
    // 1. OPEN — theme & story
    { type:"cover", kicker:"End-of-sprint review", title:"Sprint <name>",
      subtitle:"“<codename>”", note:"<one-line theme tying the changes together>" },

    // 2. SCOPE — the issue list
    { type:"scope", kicker:"Scope", title:"<N> change requests", cols:2, groups:[
      { title:"<Area A>", items:"<changes in this area>" },
      { title:"<Area B>", items:"<changes in this area>" },
      { title:"<Area C>", items:"<changes in this area>" },
      { title:"<Area D>", items:"<changes in this area>" },
    ]},

    // 3. DELIVERY — burndown & numbers
    { type:"burndown", kicker:"Delivery", title:"Burndown", bars:[
      { label:"Change requests shipped", value:100 },
      { label:"Automated tests passing", value:100 },
      { label:"Known CR bugs remaining", value:0, color:"#34d399" },
    ], note:"<N> CRs → 0 remaining in one session." },
    { type:"metrics", kicker:"By the numbers", title:"By the numbers", items:[
      { v:"<N>/<N>", l:"change requests" },
      { v:"+<k>", l:"tests → <total>" },
      { v:"<b>", l:"bugs found & fixed" },
      { v:"0", l:"CR bugs remaining" },
    ]},

    // 4. COST — required (from assets/sprint-cost.py; see the docstring in that script
    // for how it discovers transcripts). Transcribe its rows verbatim; don't hand-guess.
    { type:"cost", kicker:"Cost", title:"Where the spend went",
      total:"$<grand total>", totalLabel:"grand total",
      headers:["Agent","Model","Cost"],
      rows:[
        ["<orchestrator (main)>", "<model tier>", "$<cost>"],
        ["<worker/validator/recon label>", "<model tier>", "$<cost>"],
        // …one row per agent from sprint-cost.py's output…
      ],
      byModel:[
        { label:"<model tier>", v:"$<subtotal>" },
        // …one per tier that appears…
      ],
      note:"<e.g. cache-read share of total tokens, if notable>" },

    // 5. SAVINGS — required: concrete, numbered changes for next time, grounded in the
    // cost breakdown above — not vague "we could be faster" bullets.
    { type:"savings", kicker:"Savings", title:"Same scope, cheaper next time", items:[
      "<concrete change #1, tied to a specific line item above>",
      "<concrete change #2>",
      "<concrete change #3>",
    ], errors:[
      // Name anything scrapped/killed/restarted — it's spend with nothing to show.
      { text:"<what died/was scrapped and why>", cost:"$<cost, if known>" },
    ], note:"<estimated total delta, if you have one>" },

    // 6. QUALITY — bugs found & fixed (honesty = credibility)
    { type:"bugs", kicker:"Quality", title:"Bugs found & fixed", items:[
      { sev:"h", text:"<high-severity bug and the fix>" },
      { sev:"m", text:"<medium bug and the fix>" },
      { sev:"l", text:"<low bug and the fix>" },
    ]},

    // 7. LIVE WALKTHROUGH — one video slide per change (the heart of the deck)
    { type:"cover", kicker:"Live", title:"Live walkthrough", subtitle:"the real app, recorded" },
    { type:"video", kicker:"Change 1", title:"<change 1 name>", src:"clips/change-1.webm",
      points:["<what to watch>","<the outcome>"] },
    { type:"video", kicker:"Change 2", title:"<change 2 name>", src:"clips/change-2.webm",
      points:["<what to watch>","<the outcome>"] },
    // …one per change…

    // 8. CLOSE
    { type:"bullets", kicker:"Close", title:"Shipped.", items:[
      "<total> tests green (unit + e2e)",
      "0 CR bugs after the adversarial hunt",
      "<what's next / follow-ups>",
    ]},
  ],
};
