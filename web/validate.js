// validate.js — 처리지침 제4장(회신)·제5장(검증) 규칙을 코드로. 값은 고치지 않고 「확인필요」 목록만 낸다.
// 화면(dept.html·collect.html)과 node 시험(test_validate.js)이 함께 쓴다.
//   Validate.checkReply(행[][], {요구내용, 기준연도}) → [{행, 항목, 내용}]      회신 엑셀 1개(1행 요구 표시, 2행 머리글)
//   Validate.checkLedger(접수대장행[], 조직도과이름[]) → [{행, 접수번호, 항목, 내용}]  공백을 지우지 않고 읽은 CSV 행
//   Validate.merge(문항) → {머리글, 행}                                       과별 회신을 「회신과」 열을 붙여 합친 표
(function (root) {
  "use strict";

  const 공통열 = ["연도", "예산(천원)", "집행액(천원)", "비고"];   // 별표 3: 모든 양식에 있는 열

  const num = (v) => {
    if (typeof v === "number") return v;
    const s = String(v ?? "").replace(/,/g, "").trim();
    return s !== "" && !isNaN(s) ? Number(s) : null;
  };
  const fmt = (n) => Number(n).toLocaleString("ko-KR");
  const blank = (v) => String(v ?? "").trim() === "";

  // 요구 글에서 요구 연도 범위를 읽는다: 「최근 n년」 · 「2022년 이후」 · 「2022~2024」
  function years(text, 기준연도) {
    // 「-」는 접수번호(2026-0412)와 헷갈려 범위로 보지 않는다(11-11 지역정책과 누락을 놓친 원인).
    let m, y = null;
    if ((m = /(?<!\d)((?:19|20)\d{2})\s*년?\s*[~∼]\s*((?:19|20)\d{2})(?!\d)/.exec(text))) y = range(+m[1], +m[2]);
    if (!y && (m = /(?<!\d)((?:19|20)\d{2})\s*년\s*이후/.exec(text))) y = range(+m[1], 기준연도);
    if (!y && (m = /최근\s*(\d+)\s*년/.exec(text))) y = range(기준연도 - +m[1] + 1, 기준연도);
    return y;
  }
  const range = (a, b) => (a <= b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : null);

  function checkReply(rows, ctx = {}) {
    const out = [];
    const add = (행, 항목, 내용) => out.push({ 행, 항목, 내용 });
    if (!Array.isArray(rows) || rows.length < 2) { add(0, "양식", "1행 요구 표시와 2행 머리글이 없습니다."); return out; }
    const head = rows[1].map((h) => String(h ?? "").trim());
    const miss = 공통열.filter((c) => !head.includes(c));
    if (miss.length) add(2, "양식", `머리글에 없는 공통 열: ${miss.join(", ")}`);
    const iY = head.indexOf("연도"), iB = head.indexOf("예산(천원)"), iE = head.indexOf("집행액(천원)"), iN = head.indexOf("비고");
    const body = rows.slice(2).map((r, k) => ({ r, 행: k + 3 })).filter(({ r }) => r.some((v) => !blank(v)));
    const isSum = (r) => /합계|총계/.test(String(r[0] ?? "") + String(iY >= 0 ? r[iY] ?? "" : ""));
    const data = body.filter(({ r }) => !isSum(r));

    // (2) 요구기간 연도 누락 — 1행 요구 표시를 먼저, 없으면 문항 요구내용으로 범위를 정한다
    const 기준 = ctx.기준연도 || new Date().getFullYear();
    const want = years(String(rows[0][0] ?? ""), 기준) || years(String(ctx.요구내용 || ""), 기준);
    if (want && iY >= 0) {
      const have = new Set(data.map(({ r }) => num(r[iY])).filter((y) => y !== null));
      const lack = want.filter((y) => !have.has(y));
      if (lack.length) add(0, "연도 누락", `요구기간 ${want[0]}~${want[want.length - 1]}년 중 ${lack.join(", ")}년 행이 없습니다(자료가 없으면 행을 남기고 비고에 「해당 없음」).`);
    }
    // 제4장 제3조: 집행액이 예산을 넘으면 비고에 사유
    if (iB >= 0 && iE >= 0) for (const { r, 행 } of data) {
      const b = num(r[iB]), e = num(r[iE]);
      if (b !== null && e !== null && e > b && (iN < 0 || blank(r[iN])))
        add(행, "집행액>예산", `${iY >= 0 ? r[iY] + "년 " : ""}${String(r[1] ?? "")} — 예산 ${fmt(b)} < 집행액 ${fmt(e)}, 비고에 사유 없음`);
    }
    // (6) 합계 불일치: 합계 행에 숫자가 있는 열마다 세부 행의 합과 비교
    for (const { r, 행 } of body.filter(({ r }) => isSum(r))) {
      r.forEach((v, c) => {
        const s = num(v); if (s === null || c === iY) return;
        const sum = data.reduce((t, d) => t + (num(d.r[c]) || 0), 0);
        if (s !== sum) add(행, "합계 불일치", `${head[c] || c + 1 + "열"} 합계 ${fmt(s)} ≠ 세부 행의 합 ${fmt(sum)}`);
      });
    }
    return out;
  }

  // 검증용 접수대장: (3) 조직도에 없는 부서명 (4) 기간 역전 (5) 제출기한 형식·접수일보다 빠른 기한 (7) 중복 접수 (8) 표기(공백)
  function checkLedger(rows, org) {
    const out = [];
    const add = (i, r, 항목, 내용) => out.push({ 행: i + 2, 접수번호: String(r.접수번호 ?? "").trim(), 항목, 내용 });
    const date = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
    const byNo = new Map(), byText = new Map();
    rows.forEach((r, i) => {
      const t = (k) => String(r[k] ?? "").trim();
      for (const [k, v] of Object.entries(r)) {
        const s = String(v ?? "");
        if (s !== s.trim() || /\s{2,}/.test(s)) add(i, r, "표기(공백)", `${k} 「${s}」에 앞뒤 또는 겹친 공백`);
      }
      if (!t("배분과")) add(i, r, "빈칸", "배분과가 비었습니다");
      else if (!org.includes(t("배분과"))) add(i, r, "조직도에 없는 부서명", `「${t("배분과")}」 — 조직도 26개 과에 없음(옛 이름·오타 확인)`);
      const a = num(t("요구기간_시작")), b = num(t("요구기간_끝"));
      if (a !== null && b !== null && a > b) add(i, r, "기간 역전", `요구기간 시작 ${a} > 끝 ${b}`);
      if (!date(t("접수일"))) add(i, r, "날짜 형식", `접수일 「${t("접수일")}」`);
      if (!date(t("제출기한"))) add(i, r, "날짜 형식", `제출기한 「${t("제출기한")}」`);
      else if (date(t("접수일")) && t("제출기한") < t("접수일")) add(i, r, "기한이 접수일보다 빠름", `접수일 ${t("접수일")} > 제출기한 ${t("제출기한")}`);
      (byNo.get(t("접수번호")) || byNo.set(t("접수번호"), []).get(t("접수번호"))).push(i);
      const key = [t("요구의원"), t("문항번호"), t("요구내용")].join("|");
      (byText.get(key) || byText.set(key, []).get(key)).push(i);
    });
    for (const [no, list] of byNo) if (list.length > 1) for (const i of list) {
      const others = list.filter((j) => j !== i).map((j) => j + 2);
      const same = list.every((j) => [rows[j].요구의원, rows[j].문항번호, rows[j].요구내용].join("|") === [rows[i].요구의원, rows[i].문항번호, rows[i].요구내용].join("|"));
      add(i, rows[i], "중복 접수", `같은 접수번호(${no})가 ${others.join(", ")}행에도 있음(${same ? "같은 내용" : "내용 다름"})`);
    }
    for (const [, list] of byText) if (list.length > 1) {
      const nos = new Set(list.map((i) => String(rows[i].접수번호).trim()));
      if (nos.size > 1) for (const i of list) add(i, rows[i], "중복 접수", `같은 요구가 ${list.filter((j) => j !== i).map((j) => j + 2).join(", ")}행에 다른 접수번호로 있음`);
    }
    return out.sort((x, y) => x.행 - y.행);
  }

  // 과별 회신을 하나의 표로: 첫 열 「회신과」 + 2행 머리글(과마다 다르면 열 이름을 합침)
  function merge(c) {
    const reps = Object.entries(c.회신 || {}).filter(([, v]) => v.행 && v.행.length >= 2);
    const head = [];
    for (const [, v] of reps) for (const h of v.행[1]) { const s = String(h ?? "").trim(); if (s && !head.includes(s)) head.push(s); }
    const rows = [];
    for (const [과, v] of reps) {
      const h = v.행[1].map((x) => String(x ?? "").trim());
      for (const r of v.행.slice(2)) if (r.some((x) => !blank(x))) rows.push([과, ...head.map((name) => { const k = h.indexOf(name); return k < 0 ? "" : r[k] ?? ""; })]);
    }
    const memo = Object.entries(c.회신 || {}).filter(([, v]) => !(v.행 && v.행.length >= 2)).map(([과, v]) => ({ 과, 메모: v.메모 || "" }));
    return { 머리글: ["회신과", ...head], 행: rows, 메모만: memo };
  }

  root.Validate = { checkReply, checkLedger, merge, years, 공통열 };
  if (typeof module === "object" && module.exports) module.exports = root.Validate;
})(typeof self !== "undefined" ? self : globalThis);
