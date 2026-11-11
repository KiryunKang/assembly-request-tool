// api/app.js — 서버 함수 하나(/api/app). 근거: 00_문제정의/design.md 4절
//   GET  → cases.json 전체 {cases, log}
//   POST {작업, ...} → web/flow.js 규칙으로 검사 → 통과하면 cases.json 저장 → {ok, 상태, ..., db}
//   거절(409 순서 · 400 값 · 403 권한)이면 저장하지 않는다.
// 저장소는 Vercel Blob의 cases.json 하나(private). 토큰은 환경변수 BLOB_READ_WRITE_TOKEN에만 둔다.
// 시험(test_api.js)은 make(가짜 저장소)로 같은 처리를 돌린다.
const Flow = require("../web/flow.js");
const ORG = require("./org.json").map((o) => o.과);   // 조직도 26개 과

const KEY = "cases.json";

// Vercel Blob 저장소. 읽을 때 etag를 받아 두고, 쓸 때 그 사이 다른 사람이 바꿨으면 실패시킨다.
function blobStore() {
  const { get, put, BlobPreconditionFailedError } = require("@vercel/blob");
  return {
    async read() {
      const r = await get(KEY, { access: "private", useCache: false });
      if (!r || r.statusCode !== 200) return { db: Flow.empty(), etag: null };
      // get은 약한 etag(W/"…")를 주고, put의 ifMatch는 W/ 없는 값과 비교한다(11-11 실측).
      return { db: JSON.parse(await new Response(r.stream).text()), etag: r.blob.etag.replace(/^W\//, "") };
    },
    async write(db, etag) {
      try {
        await put(KEY, JSON.stringify(db), {
          access: "private", contentType: "application/json; charset=utf-8",
          addRandomSuffix: false, allowOverwrite: true, ...(etag ? { ifMatch: etag } : {}),
        });
      } catch (e) {
        // 오류 클래스에 이름이 없어(e.name이 "Error") instanceof로 가린다(11-11 실측).
        if (e instanceof BlobPreconditionFailedError) e.conflict = true;
        throw e;
      }
    },
  };
}

const isConflict = (e) => e && e.conflict === true;
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;          // Vercel이 미리 읽어 둔 경우
  if (typeof req.body === "string") return JSON.parse(req.body);
  let s = ""; for await (const ch of req) s += ch;
  return s ? JSON.parse(s) : {};
}

function make(store) {
  return async function handler(req, res) {
    try {
      if (req.method === "GET") return send(res, 200, (await store.read()).db);
      if (req.method !== "POST") return send(res, 405, { error: "GET 또는 POST만 받습니다." });
      let body;
      try { body = await readBody(req); } catch { return send(res, 400, { error: "요청이 JSON 형식이 아닙니다." }); }
      // 두 사람이 거의 동시에 저장하면 나중 쪽을 최신 기록 위에서 다시 처리한다(최대 5번).
      for (let i = 0; ; i++) {
        const { db, etag } = await store.read();
        const result = Flow.apply(db, body, ORG);                           // 거절이면 여기서 FlowError
        try { await store.write(db, etag); return send(res, 200, { ...result, db }); }
        catch (e) { if (!isConflict(e) || i >= 4) throw e; await wait(50 + Math.random() * 200); }
      }
    } catch (e) {
      if (e instanceof Flow.FlowError) return send(res, e.status, { error: e.message });
      if (isConflict(e)) return send(res, 409, { error: "다른 담당자가 같은 순간에 저장하고 있습니다. 잠시 뒤 다시 눌러 주세요." });
      console.error(e);
      return send(res, 500, { error: "서버 오류: " + (e && e.message) });
    }
  };
}

let real;   // 실제 저장소는 처음 요청 때 만든다(시험에서 @vercel/blob을 읽지 않도록)
module.exports = (req, res) => (real = real || make(blobStore()))(req, res);
module.exports.make = make;
module.exports.ORG = ORG;
