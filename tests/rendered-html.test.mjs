import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the ttarawaing route planner", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>따라와잉/);
  assert.match(html, /어디로 따라갈까요/);
  assert.match(html, /최적 경로 찾기/);
  assert.match(html, /망원시장/);
  assert.match(html, /더현대 서울/);
  assert.match(
    html,
    /https:\/\/map\.kakao\.com\/link\/by\/bicycle\/[^\"]*37\.55605,126\.90523\/[^\"]*37\.5556488,126\.91062927\/[^\"]*37\.52606583,126\.92553711\/[^\"]*37\.52591,126\.92843/,
  );
  assert.match(html, /카카오맵에서 이어보기/);
  assert.match(html, /출발 · 대여 · 반납 · 도착 4개 지점 자동 입력/);
  assert.doesNotMatch(html, /nmap:\/\/|네이버 지도/);
  assert.match(html, /카카오맵 연동/);
  assert.match(html, /카카오맵 실제 데이터/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("serves the Kakao JavaScript key from the runtime binding", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `kakao-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/config/kakao", {
      headers: { accept: "application/json" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
      KAKAO_JAVASCRIPT_KEY: "test-public-js-key",
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { javascriptKey: "test-public-js-key" });
  assert.match(response.headers.get("cache-control") ?? "", /max-age=300/);
});
