// test_api.js — api/app.js를 가짜 저장소(메모리)로 시험한다. Blob·토큰·인터넷 없이 돈다.
// 실행: node test_api.js
// 확인: 정상 흐름(접수 → 배분 → 회신 → 회신완료, 재배정요청 → 다시 배분)과
//       거절 3종(409 순서 · 400 값 · 403 권한) — 거절되면 cases.json이 그대로인지
const fs = require("fs");
const path = require("path");
const Engine = require("./web/engine.js");
const app = require("./api/app.js");

// 가짜 저장소: 저장된 글자와 판 번호(etag)만 가진다. conflictOnce면 첫 쓰기를 한 번 실패시킨다.
function memStore() {
  const s = { text: null, ver: 0, writes: 0, conflictOnce: false };
  s.read = async () => ({ db: s.text ? JSON.parse(s.text) : { cases: [], log: [] }, etag: s.text ? "v" + s.ver : null });
  s.write = async (db, etag) => {
    if (s.conflictOnce) {                       // 그 사이 다른 사람이 저장한 것처럼 만든다
      s.conflictOnce = false;
      const other = JSON.parse(s.text); other.log.push({ 일시: "x", 작업: "다른 사람", 문항: "", 과: "" });
      s.text = JSON.stringify(other); s.ver++;
    }
    if (etag && etag !== "v" + s.ver) { const e = new Error("etag 다름"); e.conflict = true; throw e; }
    s.text = JSON.stringify(db); s.ver++; s.writes++;
  };
  return s;
}

const store = memStore();
const handler = app.make(store);

async function call(method, body) {
  const req = { method, body };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(t) { this.text = t; } };
  await handler(req, res);
  return { status: res.statusCode, body: JSON.parse(res.text) };
}

let pass = 0, failN = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "통과" : "실패"} | ${name}${detail ? " | " + detail : ""}`);
  ok ? pass++ : failN++;
}
async function expectReject(name, body, status) {
  const before = store.text;
  const r = await call("POST", body);
  check(name, r.status === status && store.text === before, `${r.status} ${r.body.error || ""} · cases.json ${store.text === before ? "그대로" : "바뀜"}`);
}

(async () => {
  const rows = Engine.parseCSV(fs.readFileSync(path.join(__dirname, "data", "문항목록.csv"), "utf8"));

  // ── 정상 흐름 ─────────────────────────────────────────
  let r = await call("GET");
  check("빈 저장소 조회", r.status === 200 && r.body.cases.length === 0, `${r.status} 문항 ${r.body.cases.length}`);

  const withPrivate = rows.map((x, i) => (i === 0 ? { ...x, 보좌관: "홍길동", 연락처: "02-000-0000" } : x));
  r = await call("POST", { 작업: "접수", 문항: withPrivate });
  check("접수 78문항", r.status === 200 && r.body.added === 78, `${r.status} 등록 ${r.body.added}`);
  check("design.md에 없는 값(이름·연락처) 버림", !store.text.includes("홍길동") && !store.text.includes("02-000-0000"));

  r = await call("POST", { 작업: "접수", 문항: rows.slice(0, 25) });
  check("같은 문항 다시 접수 → 건너뜀", r.status === 200 && r.body.added === 0 && r.body.dup === 25, `등록 ${r.body.added} · 중복 ${r.body.dup}`);

  const A = "의원K-01", B = "의원K-02";
  await expectReject("409 배분 전 문항에 회신", { 작업: "회신", id: A, 과: "산업정책과", 메모: "자료 없음" }, 409);

  r = await call("POST", { 작업: "배분", id: A, 주관과: "산업정책과", 협조과: ["디지털정책과"], 확정방법: "규칙", 후보: ["산업정책과"] });
  check("배분 → 배분확정", r.status === 200 && r.body.상태 === "배분확정", `${r.status} ${r.body.상태}`);

  await expectReject("400 조직도 밖 과(미래전략과)로 배분", { 작업: "배분", id: B, 주관과: "미래전략과", 협조과: [], 확정방법: "규칙" }, 400);
  await expectReject("400 협조 과에 조직도 밖 과", { 작업: "배분", id: B, 주관과: "운영지원과", 협조과: ["미래전략과"], 확정방법: "수정" }, 400);
  await expectReject("400 확정방법 값 틀림", { 작업: "배분", id: B, 주관과: "운영지원과", 협조과: [], 확정방법: "아무거나" }, 400);
  await expectReject("403 담당 아닌 과(운영지원과)가 회신", { 작업: "회신", id: A, 과: "운영지원과", 메모: "자료 없음" }, 403);
  await expectReject("400 회신에 엑셀·메모 둘 다 없음", { 작업: "회신", id: A, 과: "산업정책과" }, 400);

  r = await call("POST", { 작업: "회신", id: A, 과: "산업정책과", 파일명: "회신_산업정책과.xlsx", 행: [["요구"], ["연도", "예산(천원)"], [2024, 1000]] });
  check("주관 과 회신 → 회신중(협조 과 남음)", r.status === 200 && r.body.상태 === "회신중" && r.body.남은과.join() === "디지털정책과", `${r.body.상태} · 남은 과 ${r.body.남은과}`);
  r = await call("POST", { 작업: "회신", id: A, 과: "디지털정책과", 메모: "해당 자료 없음" });
  check("협조 과 회신 → 회신완료", r.status === 200 && r.body.상태 === "회신완료", r.body.상태);
  await expectReject("409 회신완료 문항에 또 회신", { 작업: "회신", id: A, 과: "산업정책과", 메모: "다시" }, 409);
  await expectReject("409 회신완료 문항을 다시 배분", { 작업: "배분", id: A, 주관과: "산업정책과", 협조과: [], 확정방법: "규칙" }, 409);

  // 재배정요청 → 다시 배분
  await call("POST", { 작업: "배분", id: B, 주관과: "교육훈련과", 협조과: [], 확정방법: "수정", 후보: [] });
  await expectReject("400 재배정 사유 없음", { 작업: "재배정요청", id: B, 과: "교육훈련과", 사유: " " }, 400);
  await expectReject("403 담당 아닌 과의 재배정 요청", { 작업: "재배정요청", id: B, 과: "운영지원과", 사유: "소관 아님" }, 403);
  await expectReject("400 희망 과가 조직도 밖", { 작업: "재배정요청", id: B, 과: "교육훈련과", 사유: "소관 아님", 희망과: "미래전략과" }, 400);
  r = await call("POST", { 작업: "재배정요청", id: B, 과: "교육훈련과", 사유: "인사 소관이라 운영지원과 업무", 희망과: "운영지원과" });
  check("재배정요청", r.status === 200 && r.body.상태 === "재배정요청", r.body.상태);
  r = await call("POST", { 작업: "배분", id: B, 주관과: "운영지원과", 협조과: [], 확정방법: "수정", 후보: [] });
  check("재배정요청 문항 다시 배분", r.status === 200 && r.body.상태 === "배분확정", r.body.상태);

  await expectReject("400 없는 작업", { 작업: "삭제", id: A }, 400);
  await expectReject("400 없는 문항", { 작업: "배분", id: "의원Z-99", 주관과: "운영지원과", 협조과: [], 확정방법: "규칙" }, 400);

  // 동시 저장: 쓰는 사이 다른 사람이 저장했으면 최신 기록 위에서 다시 처리한다
  store.conflictOnce = true;
  r = await call("POST", { 작업: "배분", id: "의원K-03", 주관과: "운영지원과", 협조과: [], 확정방법: "수정", 후보: [] });
  const db = JSON.parse(store.text);
  check("동시 저장 → 다시 처리해 둘 다 남음", r.status === 200 && db.log.some((l) => l.작업 === "다른 사람") && db.cases.find((c) => c.id === "의원K-03").상태 === "배분확정");

  r = await call("GET");
  const st = {}; for (const c of r.body.cases) st[c.상태] = (st[c.상태] || 0) + 1;
  check("마지막 조회", r.status === 200 && r.body.cases.length === 78, JSON.stringify(st) + ` · 기록 ${r.body.log.length}줄`);

  console.log(`\n통과 ${pass} · 실패 ${failN}`);
  process.exit(failN ? 1 : 0);
})();
