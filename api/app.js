// api/app.js — 서버 함수 하나(/api/app). 근거: 00_문제정의/design.md 4절
//   GET  → cases.json 전체 {cases, log}
//   POST {작업, ...} → web/flow.js 규칙으로 검사 → 통과하면 cases.json 저장 → {ok, 상태, ..., db}
//   거절(409 순서 · 400 값 · 403 권한)이면 저장하지 않는다.
// 저장소는 Vercel Blob의 cases.json 하나(private). 토큰은 환경변수 BLOB_READ_WRITE_TOKEN에만 둔다.
//   POST {작업:"AI추천", 요구내용} → OpenAI에 요구내용만 보내 조직도 안에서 후보 최대 3개(S7). 저장하지 않는다.
//   AI 키는 환경변수 OPENAI_API_KEY에만 둔다(없으면 500과 안내 문구).
// 시험(test_api.js)은 make(가짜 저장소, {fetch, env})로 같은 처리를 돌린다.
const Flow = require("../web/flow.js");
const ORG_ROWS = require("./org.json");
const ORG = ORG_ROWS.map((o) => o.과);   // 조직도 26개 과

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
        // 오류 클래스에 이름이 없어(e.name이 "Error") instanceof로 가린다. 저장소가 직접 보내는
        // 「conflicting operation」(같은 순간 다른 쓰기)도 충돌로 본다(11-11 실측).
        if (e instanceof BlobPreconditionFailedError || /conflicting operation/i.test(e && e.message)) e.conflict = true;
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

// ── AI 추천(S7) ──────────────────────────────────────────
// 규칙 후보가 없는 문항에만 쓴다. 조직도 26개 과 안에서만 고르게 하고, 목록 밖 과는 서버에서 지운다.
const AI_SYSTEM = [
  "너는 A부 국회 요구자료 배분 보조다. 요구내용을 맡을 과를 아래 조직도 목록에서만 고른다.",
  "규칙: 목록에 있는 과 이름을 글자 그대로 쓴다. 최대 3개, 가능성이 큰 순서. 과마다 근거 1문장(그 과의 주요업무와 연결).",
  "A부 소관이 아니거나 맞는 과가 없으면 후보를 비우고 해당없음을 true로 한다. 추측으로 채우지 않는다.",
  '응답은 JSON 하나: {"후보":[{"과":"…","근거":"…"}],"해당없음":false}',
  "조직도(과: 주요업무):",
  ...ORG_ROWS.map((o) => `- ${o.과}: ${o.주요업무}`),
].join("\n");

async function aiRecommend(body, { fetch: f, env }) {
  const 요구내용 = String(body.요구내용 || "").trim().slice(0, 500);
  if (!요구내용) throw new Flow.FlowError(400, "요구내용이 비었습니다.");
  const key = env.OPENAI_API_KEY;
  if (!key) throw new Flow.FlowError(500, "AI 추천을 쓸 수 없습니다: 서버 환경변수 OPENAI_API_KEY가 없습니다. Vercel → Settings → Environment Variables에 넣고 다시 배포하세요.");
  const r = await f((env.OPENAI_BASE_URL || "https://api.openai.com/v1") + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: env.AI_MODEL || "gpt-4o-mini", temperature: 0, response_format: { type: "json_object" },
      messages: [{ role: "system", content: AI_SYSTEM }, { role: "user", content: "요구내용: " + 요구내용 }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Flow.FlowError(502, `AI 서버 응답 오류(${r.status}). 잠시 뒤 다시 누르거나 직접 고르세요.`);
  let out;
  try { out = JSON.parse((await r.json()).choices[0].message.content); }
  catch { throw new Flow.FlowError(502, "AI 응답을 읽지 못했습니다. 직접 고르세요."); }
  const seen = new Set(), 제거 = [];
  const 후보 = (Array.isArray(out.후보) ? out.후보 : []).filter((x) => {
    const 과 = String((x && x.과) || "").trim();
    if (!ORG.includes(과)) { if (과) 제거.push(과); return false; }   // 목록 밖 과는 지운다
    if (seen.has(과)) return false;
    seen.add(과); return true;
  }).slice(0, 3).map((x) => ({ 과: String(x.과).trim(), 근거: String(x.근거 || "").trim().slice(0, 200) }));
  return { 후보, 해당없음: !후보.length, ...(제거.length ? { 제거 } : {}) };
}

function make(store, deps = { fetch: (...a) => fetch(...a), env: process.env }) {
  return async function handler(req, res) {
    try {
      if (req.method === "GET") return send(res, 200, (await store.read()).db);
      if (req.method !== "POST") return send(res, 405, { error: "GET 또는 POST만 받습니다." });
      let body;
      try { body = await readBody(req); } catch { return send(res, 400, { error: "요청이 JSON 형식이 아닙니다." }); }
      if (body && body.작업 === "AI추천") return send(res, 200, await aiRecommend(body, deps));   // 기록은 바꾸지 않음
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
