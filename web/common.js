// common.js — 세 화면(배분·현업 회신·취합)과 시작 화면이 함께 쓰는 것: 이동 단추, 자료 읽기, 저장.
// 저장은 지금(S5)은 브라우저 localStorage에만 한다. S6에서 서버(/api/app, cases.json)로 옮긴다.
(function (root) {
  "use strict";

  const KEY = "국회요구자료_cases_v1";
  const STATES = ["접수", "배분확정", "회신중", "회신완료", "확정", "재배정요청", "보완요청"];
  const FILES = { rules: "data/rules_보강.csv", org: "data/A부_조직도_26개과.csv" };

  // ── 이동 단추 ────────────────────────────────────────────
  const PAGES = [
    ["index.html", "시작 화면"],
    ["assign.html", "배분"],
    ["dept.html", "현업 회신", "S6"],
    ["collect.html", "취합", "S8"],
  ];
  function nav(active) {
    const el = document.getElementById("nav");
    if (!el) return;
    el.innerHTML = PAGES.map(([href, name, later]) =>
      later ? `<span class="nav-off" title="${later}에서 만듭니다">${name} <small>(${later})</small></span>`
            : `<a href="${href}" class="${href === active ? "on" : ""}">${name}</a>`).join("");
  }

  // ── 자료 읽기(web/data/의 CSV) ───────────────────────────
  async function fetchText(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`${path}를 읽지 못했습니다(${r.status}). 더블클릭으로 열었다면 python -m http.server로 여세요.`);
    return r.text();
  }
  async function loadEngine() {
    const [rules, org] = await Promise.all([fetchText(FILES.rules), fetchText(FILES.org)]);
    const eng = Engine.create(rules, org);
    eng.org = Engine.parseCSV(org);            // [{실국, 과, ...}] 26개
    return eng;
  }

  // ── 저장(localStorage) ──────────────────────────────────
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || { cases: [], log: [] }; }
    catch (e) { return { cases: [], log: [] }; }
  }
  function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
  function clearAll() { localStorage.removeItem(KEY); }

  const now = () => new Date().toLocaleString("sv-SE").slice(0, 16);   // 2026-11-10 13:50
  const caseId = (r) => `${r.의원}-${String(r.문항번호).padStart(2, "0")}`;
  function addLog(db, 작업, id, 과) { db.log.push({ 일시: now(), 작업, 문항: id, 과: 과 || "" }); }

  // 접수: 분해된 문항을 등록한다. 같은 id(의원-문항번호)는 다시 넣지 않는다.
  function register(db, rows) {
    const have = new Set(db.cases.map((c) => c.id));
    let added = 0, dup = 0;
    for (const r of rows) {
      const id = caseId(r);
      if (have.has(id)) { dup++; continue; }
      db.cases.push({
        id, 파일명: r.파일명, 위원회: r.위원회, 의원: r.의원, 제출기한: r.제출기한,
        문항번호: Number(r.문항번호), 요구내용: r.요구내용, 세부항목: r.세부항목 || "", 비고: r.비고 || "",
        상태: "접수", 주관과: "", 협조과: [], 확정방법: "", 후보: [], 일시: now(),
      });
      have.add(id); added++;
      addLog(db, "접수", id);
    }
    return { added, dup };
  }

  // 배분: 설계서 3절 상태표 — 접수·재배정요청·배분확정에서만 배분할 수 있다.
  function assign(db, id, { 주관과, 협조과, 확정방법, 후보 }, orgNames) {
    const c = db.cases.find((x) => x.id === id);
    if (!c) throw new Error(`${id} 문항이 없습니다.`);
    if (!["접수", "재배정요청", "배분확정"].includes(c.상태)) throw new Error(`「${c.상태}」 상태에서는 배분할 수 없습니다.`);
    if (!주관과) throw new Error("주관 과를 고르세요.");
    const bad = [주관과, ...협조과].filter((d) => !orgNames.includes(d));
    if (bad.length) throw new Error(`조직도에 없는 과: ${bad.join(", ")}`);
    Object.assign(c, { 상태: "배분확정", 주관과, 협조과: 협조과.filter((d) => d !== 주관과), 확정방법, 후보, 일시: now() });
    addLog(db, "배분", id, 주관과);
    return c;
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  root.App = { STATES, FILES, nav, fetchText, loadEngine, load, save, clearAll, now, caseId, register, assign, esc };
})(self);
