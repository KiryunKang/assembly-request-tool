// flow.js — 처리 단계(상태) 규칙. 화면(브라우저 저장)과 서버(api/app.js)가 같은 파일을 쓴다.
// 근거: 00_문제정의/design.md 3절 상태표 · 4절 거부 규칙
//   Flow.apply(db, 요청, 조직도과이름[]) → { ok: true, 상태, ... }  (db를 그 자리에서 바꾼다)
//   규칙에 안 맞으면 FlowError(409 순서 · 400 값 · 403 권한)를 던지고 db는 그대로 둔다.
// S7(AI 추천)·S8(보완요청·확정)은 이 파일의 ACTIONS에 작업을 더한다.
(function (root) {
  "use strict";

  const STATES = ["접수", "배분확정", "회신중", "회신완료", "확정", "재배정요청", "보완요청"];
  const 확정방법들 = ["규칙", "AI", "수정"];
  // 접수 때 받는 열(design.md 3절). 여기 없는 값(이름·연락처 등)은 버린다.
  const 문항열 = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"];

  class FlowError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  const fail = (status, message) => { throw new FlowError(status, message); };

  // 한국 시각 「2026-11-11 10:05」 (서버는 UTC라 시간대를 정해 둔다)
  const now = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16);
  const caseId = (r) => `${r.의원}-${String(r.문항번호).padStart(2, "0")}`;
  const text = (v, max = 2000) => String(v ?? "").trim().slice(0, max);
  const empty = () => ({ cases: [], log: [] });

  function addLog(db, 작업, id, 과, 비고) {
    db.log.push({ 일시: now(), 작업, 문항: id || "", 과: 과 || "", ...(비고 ? { 비고 } : {}) });
  }
  function findCase(db, id) {
    return db.cases.find((c) => c.id === id) || fail(400, `${id || "(빈 값)"} 문항이 없습니다.`);
  }
  function needState(c, allowed, 작업) {
    if (!allowed.includes(c.상태)) fail(409, `${c.id}: 「${c.상태}」 상태에서는 ${작업}할 수 없습니다(가능: ${allowed.join("·")}).`);
  }
  function needOrg(org, 과, 이름) {
    if (!과) fail(400, `${이름}를 고르세요.`);
    if (!org.includes(과)) fail(400, `조직도에 없는 과입니다: ${과}`);
  }
  const 담당과 = (c) => [c.주관과, ...c.협조과].filter(Boolean);
  function needOwner(c, 과) {
    if (!담당과(c).includes(과)) fail(403, `${과}는 ${c.id} 문항의 담당 과가 아닙니다(담당: ${담당과(c).join(", ")}).`);
  }

  const ACTIONS = {
    // 접수: 분해된 문항 목록을 등록한다. 같은 id(의원-문항번호)는 건너뛴다.
    접수(db, req) {
      const rows = Array.isArray(req.문항) ? req.문항 : fail(400, "문항 목록이 없습니다.");
      const have = new Set(db.cases.map((c) => c.id));
      let added = 0, dup = 0;
      for (const r of rows) {
        const c = Object.fromEntries(문항열.map((k) => [k, text(r[k])]));
        c.문항번호 = Number(c.문항번호);
        if (!c.의원 || !c.문항번호 || !c.요구내용) fail(400, "의원·문항번호·요구내용은 비울 수 없습니다.");
        const id = caseId(c);
        if (have.has(id)) { dup++; continue; }
        db.cases.push({ id, ...c, 상태: "접수", 주관과: "", 협조과: [], 확정방법: "", 후보: [],
          회신: {}, 재배정: null, 보완: null, 확정코멘트: "", 일시: now() });
        have.add(id); added++;
        addLog(db, "접수", id);
      }
      return { added, dup };
    },

    // 배분: 접수·재배정요청·배분확정에서만. 이미 받은 회신은 계속 담당인 과의 것만 남긴다.
    배분(db, req, org) {
      const c = findCase(db, req.id);
      needState(c, ["접수", "재배정요청", "배분확정"], "배분");
      needOrg(org, req.주관과, "주관 과");
      const 협조과 = [...new Set((req.협조과 || []).map((d) => text(d)).filter((d) => d && d !== req.주관과))];
      for (const d of 협조과) needOrg(org, d, "협조 과");
      if (!확정방법들.includes(req.확정방법)) fail(400, `확정방법은 ${확정방법들.join("·")} 가운데 하나여야 합니다.`);
      const 후보 = (req.후보 || []).map((d) => text(d, 50)).filter((d) => org.includes(d)).slice(0, 3);
      const keep = new Set([req.주관과, ...협조과]);
      const 회신 = Object.fromEntries(Object.entries(c.회신 || {}).filter(([d]) => keep.has(d)));
      Object.assign(c, { 상태: "배분확정", 주관과: req.주관과, 협조과, 확정방법: req.확정방법, 후보, 회신, 일시: now() });
      addLog(db, "배분", c.id, c.주관과, "확정방법 " + req.확정방법);
    },

    // 회신: 담당 과만. 모든 담당 과가 회신하면 회신완료, 아니면 회신중.
    회신(db, req, org) {
      const c = findCase(db, req.id);
      needState(c, ["배분확정", "회신중", "보완요청"], "회신");
      needOrg(org, req.과, "회신하는 과");
      needOwner(c, req.과);
      const 파일명 = text(req.파일명, 200), 메모 = text(req.메모, 1000);
      if (!파일명 && !메모) fail(400, "회신 엑셀을 올리거나 메모(예: 자료 없음)를 적으세요.");
      const 행 = Array.isArray(req.행) ? req.행.slice(0, 500).map((r) => (Array.isArray(r) ? r.slice(0, 50).map((v) => (v == null ? "" : typeof v === "number" ? v : text(v, 500))) : [])) : [];
      c.회신 = c.회신 || {};
      c.회신[req.과] = { 파일명, 행, 메모, 확인필요: [], 일시: now() };
      const 남은과 = 담당과(c).filter((d) => !c.회신[d]);
      c.상태 = 남은과.length ? "회신중" : "회신완료";
      c.일시 = now();
      addLog(db, "회신", c.id, req.과);
      return { 남은과 };
    },

    // 재배정요청: 담당 과만, 사유 필수. 희망 과는 고르지 않아도 된다.
    재배정요청(db, req, org) {
      const c = findCase(db, req.id);
      needState(c, ["배분확정", "회신중", "보완요청"], "재배정을 요청");
      needOrg(org, req.과, "요청하는 과");
      needOwner(c, req.과);
      const 사유 = text(req.사유, 500);
      if (!사유) fail(400, "재배정 사유를 적으세요.");
      const 희망과 = text(req.희망과, 50);
      if (희망과) needOrg(org, 희망과, "희망 과");
      Object.assign(c, { 상태: "재배정요청", 재배정: { 과: req.과, 사유, 희망과, 일시: now() }, 일시: now() });
      addLog(db, "재배정요청", c.id, req.과, 사유);
    },
  };

  function apply(db, req, org) {
    if (!db || !Array.isArray(db.cases) || !Array.isArray(db.log)) fail(500, "기록 형식이 맞지 않습니다.");
    if (!req || typeof req !== "object") fail(400, "요청이 비었습니다.");
    const act = ACTIONS[req.작업] || fail(400, `알 수 없는 작업입니다: ${req.작업}`);
    if (!Array.isArray(org) || !org.length) fail(500, "조직도를 읽지 못했습니다.");
    const extra = act(db, req, org) || {};
    const c = req.id ? db.cases.find((x) => x.id === req.id) : null;
    return { ok: true, ...(c ? { 상태: c.상태 } : {}), ...extra };
  }

  root.Flow = { STATES, apply, FlowError, empty, now, caseId, 담당과 };
  if (typeof module === "object" && module.exports) module.exports = root.Flow;
})(typeof self !== "undefined" ? self : globalThis);
