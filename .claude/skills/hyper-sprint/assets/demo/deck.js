// Fill this in — it is the ONLY file you edit for demo content. index.html renders it;
// no build, no CDN, no dependency on the app under test. Drop recordings into clips/
// and reference them from "video" slides. Slide types:
//   cover     {title, subtitle?, note?}
//   scope     {title, cols?, groups:[{title, items}]}         — the issue list
//   burndown  {title, bars:[{label, value, color?}], note?}   — progress vs total
//   metrics   {title, items:[{v, l}]}                          — headline numbers
//   bugs      {title, items:[{sev:'h'|'m'|'l', text}]}         — found & fixed
//   video     {title, src, points?[] | caption, controls?}    — LIVE recorded proof
//   bullets   {title, items:[]}
// Every slide may add {kicker}. Keyboard: →/space/click next, ← back, f fullscreen.
window.DECK = {
  accent: "#7c9cff",
  footer: "Sprint <name> · end-of-sprint review",
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

    // 4. QUALITY — bugs found & fixed (honesty = credibility)
    { type:"bugs", kicker:"Quality", title:"Bugs found & fixed", items:[
      { sev:"h", text:"<high-severity bug and the fix>" },
      { sev:"m", text:"<medium bug and the fix>" },
      { sev:"l", text:"<low bug and the fix>" },
    ]},

    // 5. LIVE WALKTHROUGH — one video slide per change (the heart of the deck)
    { type:"cover", kicker:"Live", title:"Live walkthrough", subtitle:"the real app, recorded" },
    { type:"video", kicker:"Change 1", title:"<change 1 name>", src:"clips/change-1.webm",
      points:["<what to watch>","<the outcome>"] },
    { type:"video", kicker:"Change 2", title:"<change 2 name>", src:"clips/change-2.webm",
      points:["<what to watch>","<the outcome>"] },
    // …one per change…

    // 6. CLOSE
    { type:"bullets", kicker:"Close", title:"Shipped.", items:[
      "<total> tests green (unit + e2e)",
      "0 CR bugs after the adversarial hunt",
      "<what's next / follow-ups>",
    ]},
  ],
};
