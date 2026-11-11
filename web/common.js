// common.js — 세 화면(배분·현업 회신·취합)과 시작 화면이 함께 쓰는 것: 이동 단추, 자료 읽기, 기록 읽기·저장, 과거 이력.
// 기록 저장(S6): 주소가 *.vercel.app이면 서버(/api/app → Vercel Blob cases.json)에, 아니면 이 브라우저(localStorage)에.
// 두 경우 모두 상태 규칙은 flow.js 하나로 검사한다(서버도 같은 파일).
(function (root) {
  "use strict";

  const KEY = "국회요구자료_cases_v1";
  const STATES = Flow.STATES;
  const FILES = { rules: "data/rules_보강.csv", org: "data/A부_조직도_26개과.csv", ledger: "data/접수대장.csv" };
  const SERVER = location.hostname.endsWith(".vercel.app");
  const API = "/api/app";

  // ── 이동 단추 + 기록 위치 표시 ─────────────────────────────
  const PAGES = [
    ["index.html", "시작 화면"],
    ["assign.html", "배분"],
    ["dept.html", "현업 회신"],
    ["collect.html", "취합"],
  ];
  function nav(active) {
    const el = document.getElementById("nav");
    if (!el) return;
    el.innerHTML = PAGES.map(([href, name, later]) =>
      later ? `<span class="nav-off" title="${later}에서 만듭니다">${name} <small>(${later})</small></span>`
            : `<a href="${href}" class="${href === active ? "on" : ""}">${name}</a>`).join("");
    const mode = document.createElement("span");
    mode.className = "mode " + (SERVER ? "mode-server" : "mode-local");
    mode.textContent = SERVER ? "기록: 서버 공유(Vercel Blob)" : "기록: 이 브라우저에만";
    mode.title = SERVER ? "모든 담당자가 같은 처리 단계를 봅니다." : "다른 사람·다른 브라우저에서는 보이지 않습니다. *.vercel.app 주소에서 열면 서버에 저장합니다.";
    el.after(mode);
  }

  // ── 자료 읽기(web/data/의 CSV) ───────────────────────────
  async function fetchText(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`${path}를 읽지 못했습니다(${r.status}). 더블클릭으로 열었다면 python -m http.server로 여세요.`);
    return r.text();
  }
  let orgNames = null;
  async function loadEngine() {
    const [rules, org] = await Promise.all([fetchText(FILES.rules), fetchText(FILES.org)]);
    const eng = Engine.create(rules, org);
    eng.org = Engine.parseCSV(org);            // [{실국, 과, ...}] 26개
    orgNames = eng.org.map((o) => o.과);
    return eng;
  }

  // ── 기록 읽기·저장 ───────────────────────────────────────
  async function load() {
    if (SERVER) {
      const r = await fetch(API, { cache: "no-store" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `기록을 읽지 못했습니다(${r.status}).`);
      return body;
    }
    try { return JSON.parse(localStorage.getItem(KEY)) || Flow.empty(); }
    catch (e) { return Flow.empty(); }
  }
  // 작업 하나를 보내고 {결과, db}를 받는다. 거절이면 서버·flow.js의 문구로 오류를 던진다.
  async function act(req) {
    if (SERVER) {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `저장하지 못했습니다(${r.status}).`);
      const { db, ...result } = body;
      return { result, db };
    }
    if (!orgNames) throw new Error("조직도를 아직 읽지 못했습니다.");
    const db = await load();
    const result = Flow.apply(db, req, orgNames);       // 거절이면 여기서 멈추고 저장하지 않음
    localStorage.setItem(KEY, JSON.stringify(db));
    return { result, db };
  }
  function clearAll() { localStorage.removeItem(KEY); }

  // ── 과거 이력(접수대장 520건, 읽기만) ─────────────────────
  // 1순위 후보의 근거 키워드가 든 과거 요구를 찾아 「n건 · 주로 ○○과」와 최근 5건을 낸다.
  let ledger = null;
  async function loadLedger() {
    ledger = ledger || Engine.parseCSV(await fetchText(FILES.ledger));
    return ledger;
  }
  function history(cand) {
    if (!ledger || !cand || !cand.length) return null;
    const kws = cand[0].근거키워드;
    const hits = ledger.filter((l) => kws.some((k) => l.요구내용.includes(k)));
    if (!hits.length) return null;
    const cnt = new Map();
    for (const h of hits) cnt.set(h.배분과, (cnt.get(h.배분과) || 0) + 1);
    const [주로, 주로건수] = [...cnt].sort((a, b) => b[1] - a[1])[0];
    const 최근 = [...hits].sort((a, b) => b.접수일.localeCompare(a.접수일)).slice(0, 5);
    return { n: hits.length, 주로, 주로건수, 최근, kws };
  }
  function historyHtml(h) {
    if (!h) return `<span class="hint">과거 이력 없음</span>`;
    return `<details class="hist"><summary>과거 ${h.n}건 · 주로 ${esc(h.주로)}(${h.주로건수})</summary>
      <div class="hint">키워드: ${esc(h.kws.join(", "))}</div><ol>` +
      h.최근.map((l) => `<li><small>${esc(l.접수일)} · ${esc(l.위원회)}</small><br>${esc(l.요구내용)} → <b>${esc(l.배분과)}</b> <small>(${esc(l.처리상태)})</small></li>`).join("") +
      `</ol></details>`;
  }

  const caseId = Flow.caseId;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  root.App = { STATES, FILES, SERVER, nav, fetchText, loadEngine, load, act, clearAll, caseId, esc, loadLedger, history, historyHtml };
})(self);
