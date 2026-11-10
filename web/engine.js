// engine.js — 요구내용을 배분기준표와 대조해 소관 과 후보를 최대 3개 낸다.
// 규칙: 처리지침_초안.md 제13조(판정 순서) · 별표 1(조직도) · 별표 2(배분기준표)
// 엔진은 파일을 직접 읽지 않는다. 바깥(node는 fs, 화면은 fetch)이 읽은 CSV 글자를 받아 계산만 한다.
// 쓰는 법:
//   const eng = Engine.create(배분기준표CSV글자, 조직도CSV글자);
//   eng.classify("최근 5년간 업무추진비 내역") → [{과, 점수, 근거키워드}, ...] (최대 3개, 점수 큰 순)
(function (root) {
  "use strict";

  // CSV 글자 → 객체 배열. 따옴표("…, …") 안의 쉼표·줄바꿈과 "" 이스케이프를 처리한다.
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, "");          // utf-8-sig 머리 표시 제거
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    const head = rows.shift().map((h) => h.trim());
    return rows
      .filter((r) => r.some((v) => v.trim() !== ""))
      .map((r) => Object.fromEntries(head.map((h, k) => [h, (r[k] || "").trim()])));
  }

  const splitBar = (s) => String(s || "").split("|").map((x) => x.trim()).filter(Boolean);

  function create(rulesCsv, orgCsv) {
    const org = parseCSV(orgCsv);
    const depts = new Set(org.map((o) => o.과));            // 조직도 26개 과
    const rules = parseCSV(rulesCsv).map((r) => ({
      id: r.rule_id, 유형: r.유형, 과: r.과, 키워드: r.키워드,
      제외어: splitBar(r.제외어), 우선순위: Number(r.우선순위) || 0,
    }));
    const outside = rules.filter((r) => !depts.has(r.과)).map((r) => r.id);  // 조직도 밖 과 규칙(후보로 안 냄)

    function classify(text) {
      text = String(text || "");
      const byDept = new Map();                               // 과 → {과, 점수, 근거키워드[]}
      for (const r of rules) {
        if (!r.키워드 || !text.includes(r.키워드)) continue;            // 1. 키워드가 들어 있어야 함
        if (r.제외어.some((w) => text.includes(w))) continue;           // 2. 제외어가 하나라도 있으면 건너뜀
        if (!depts.has(r.과)) continue;                                  // 3. 조직도에 없는 과는 후보 아님
        const s = r.우선순위 + r.키워드.length / 10;                     // 4. 점수 = 우선순위 + 키워드 길이/10
        const d = byDept.get(r.과) || { 과: r.과, 점수: 0, 근거키워드: [] };
        d.점수 = Math.round((d.점수 + s) * 10) / 10;                     //    같은 과에 여러 규칙이 걸리면 더함
        d.근거키워드.push(r.키워드);
        byDept.set(r.과, d);
      }
      return [...byDept.values()]
        .sort((a, b) => b.점수 - a.점수)
        .slice(0, 3);
    }

    return { classify, parseCSV, depts: [...depts], ruleCount: rules.length, outside };
  }

  const Engine = { create, parseCSV };
  if (typeof module === "object" && module.exports) module.exports = Engine;   // node
  else root.Engine = Engine;                                                    // 브라우저
})(typeof self !== "undefined" ? self : this);
