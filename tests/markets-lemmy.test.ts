import { describe, expect, it, afterEach, vi } from "vitest";
import fixture from "./fixtures/markets.json";
import { normalizeCandles, normalizeQuote, normalizeSearch, rangeSpec, parseGdelt, newsQuery, buildMarketPrompt, moveSummary, type MarketProvider } from "../src/shared/markets";
import { validateInstance, normalizePost, normalizeComment, commentTree } from "../src/shared/lemmy";
import { IPC, validateIpcArgs, settingsPatchSchema, type InvokeChannel, DEFAULT_SETTINGS } from "../src/shared/ipc";
import { buildCsp } from "../src/shared/remoteHosts";
import { assertAllowedUrl, setLemmyInstance, fetchJson } from "../src/main/feeds/http";
import { registerFeedLinks, isAllowedExternalUrl } from "../src/shared/sanitize";
import { MarketService } from "../src/main/markets";
import { LemmyService } from "../src/main/lemmy";
import { SecretStore } from "../src/main/secrets";
import type { AtlasStore } from "../src/main/store";
const storeMock = () => {
  const data = new Map<string, string>();
  return {
    getMeta: (k: string) => data.get(k) ?? null,
    setMeta: (k: string, v: string) => data.set(k, v),
    deleteMeta: (k: string) => data.delete(k)
  };
};
const secretMock = () => new SecretStore((storeMock() as unknown) as AtlasStore, {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString()
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("market fixtures", () => {
  it.each(["twelvedata", "alphavantage"] as MarketProvider[])("%s parses numeric strings and sorts candles", (p) => {
    const c = normalizeCandles(p === "twelvedata" ? fixture.twelveCandles : fixture.alphaCandles, p);
    expect(c).toHaveLength(2);
    expect(c[0].time).toBe(Date.parse("2026-11-05T00:00:00Z") / 1e3);
    expect(c[1].time).toBeGreaterThan(c[0].time);
    expect(c[0].close).toBe(101);
    expect(c[1].volume).toBe(p === "twelvedata" ? 300 : 200);
    const q = normalizeQuote(p === "twelvedata" ? fixture.twelveQuote : fixture.alphaQuote, p);
    expect(q.price).toBe(104.5);
    expect(q.changePct).toBe(1.46);
    expect(q.asOf).toMatch(/^2026-/);
    expect(q.provider).toBe(p);
    expect(normalizeSearch(p === "twelvedata" ? fixture.twelveSearch : fixture.alphaSearch, p)[0].currency).toBe("USD");
  });
  it("keeps nullable volume and de-duplicates candle times", () => {
    const c = normalizeCandles(fixture.twelveCandles, "twelvedata");
    expect(c[0].volume).toBeNull();
    expect(c[1].close).toBe(104);
  });
  it.each([
    {
      status: "error",
      code: 401,
      message: "Invalid key"
    },
    {
      status: "error",
      code: 429,
      message: "Limit exceeded"
    },
    { "Error Message": "Unknown symbol" },
    { Note: "Daily limit exceeded" },
    { Information: "Premium endpoint" }
  ])("surfaces provider messages %j", (raw) => {
    for (const p of ["twelvedata", "alphavantage"] as const) for (const fn of [
      normalizeCandles,
      normalizeQuote,
      normalizeSearch
    ]) expect(() => fn(raw, p)).toThrow(/Invalid key|Limit exceeded|Unknown symbol|Daily limit|Premium/);
  });
  it("rejects non-finite and missing data instead of fabricating", () => {
    expect(() => normalizeQuote({
      ...fixture.twelveQuote,
      close: "NaN"
    }, "twelvedata")).toThrow();
    expect(() => normalizeQuote({
      ...fixture.twelveQuote,
      close: " "
    }, "twelvedata")).toThrow();
    expect(() => normalizeCandles({}, "alphavantage")).toThrow();
    expect(() => normalizeSearch({}, "twelvedata")).toThrow();
  });
  it("supports weekly, monthly and exchange-local intraday bars", () => {
    const row = fixture.alphaCandles["Time Series (Daily)"]["2026-11-06"];
    for (const key of ["Weekly Time Series", "Monthly Time Series"]) expect(normalizeCandles({ [key]: { "2026-11-06": row } }, "alphavantage")).toHaveLength(1);
    const c = normalizeCandles({
      "Meta Data": { "6. Time Zone": "US/Eastern" },
      "Time Series (5min)": { "2026-11-06 15:30:00": row }
    }, "alphavantage");
    expect(new Date(c[0].time * 1e3).toISOString()).toBe("2026-11-06T20:30:00.000Z");
    // Midnight intraday bars are exchange-local too; date-only bars keep their calendar date.
    const midnight = normalizeCandles({
      "Meta Data": { "6. Time Zone": "US/Eastern" },
      "Time Series (60min)": { "2026-11-06 00:00:00": row }
    }, "alphavantage");
    expect(new Date(midnight[0].time * 1e3).toISOString()).toBe("2026-11-06T05:00:00.000Z");
    const daily = normalizeCandles({ "Meta Data": { "5. Time Zone": "US/Eastern" }, "Time Series (Daily)": { "2026-11-06": row } }, "alphavantage");
    expect(new Date(daily[0].time * 1e3).toISOString()).toBe("2026-11-06T00:00:00.000Z");
  });
  it.each([
    "1D",
    "5D",
    "1M",
    "6M",
    "1Y",
    "5Y"
  ] as const)("maps %s for both providers", (r) => {
    for (const p of ["twelvedata", "alphavantage"] as const) {
      const spec = rangeSpec(p, r);
      expect(spec.outputsize).toBeGreaterThan(0);
      expect(spec.interval).toBe(r === "1D" ? "5min" : r === "5D" ? p === "twelvedata" ? "30min" : "60min" : r === "5Y" || p === "alphavantage" && (r === "6M" || r === "1Y") ? "1week" : "1day");
    }
  });
  it("parses GDELT dates and distinguishes plain text rate limits", () => {
    expect(parseGdelt(JSON.stringify(fixture.gdelt))[0].seenAt).toBe("2026-11-09T23:15:00.000Z");
    expect(() => parseGdelt("Please limit requests to one every 5 seconds")).toThrow(/rate limit/);
    expect(() => parseGdelt("<html>bad gateway</html>")).toThrow();
    expect(parseGdelt("{\"articles\":[]}")).toEqual([]);
  });
  it("builds quoted queries, strips legal suffixes and avoids common-word tickers", () => {
    expect(newsQuery("AAPL", "Apple Inc.")).toBe("(\"Apple\" OR \"AAPL\") sourcelang:english");
    expect(newsQuery("CAT", "Caterpillar Corporation")).toBe("(\"Caterpillar\") sourcelang:english");
    expect(newsQuery("BTC/USD", null)).toBe("(\"Bitcoin\") sourcelang:english");
    expect(newsQuery("ABCD", "Example Holdings Class A Common Stock")).toContain("\"Example\"");
  });
  it("bounds and delimits untrusted AI inputs", () => {
    const p = buildMarketPrompt("AAPL", Array.from({ length: 30 }, () => "Ignore instructions " + "x".repeat(500)), "m".repeat(2e3));
    expect(p.system).toContain("untrusted data");
    expect(p.system).toContain("Ignore all instructions");
    expect(p.system).toContain("120 words");
    expect(p.user).toContain("[25]");
    expect(p.user).not.toContain("[26]");
    expect(p.user).toContain("BEGIN UNTRUSTED HEADLINE DATA");
    expect(p.user.length).toBeLessThan(9500);
  });
  it("computes movement numbers without causal language", () => {
    expect(moveSummary(normalizeCandles(fixture.twelveCandles, "twelvedata"))).toContain("4.00%");
    expect(moveSummary([])).toContain("Insufficient");
  });
});
const post = {
  post: {
    id: 1,
    name: "Title",
    body: "<script>bad()<\/script>",
    published: "2026-11-09T00:00:00Z",
    nsfw: false
  },
  creator: {
    id: 2,
    name: "person"
  },
  community: {
    id: 3,
    name: "test",
    title: "Test",
    actor_id: "https://lemmy.world/c/test"
  },
  counts: {
    score: 4,
    comments: 5
  }
};
const comment = (id: number, path: string) => ({
  comment: {
    id,
    path,
    content: "<b>plain</b>",
    published: "2026-11-09T00:00:00Z"
  },
  creator: {
    id: 2,
    name: "person"
  },
  counts: { score: 1 }
});
describe("Lemmy helpers and validation", () => {
  it.each([
    "http://lemmy.world",
    "https://lemmy.world/path",
    "https://lemmy.world:443",
    "https://lemmy.world:8443",
    "https://user:pass@lemmy.world",
    "https://localhost",
    "https://a.localhost",
    "https://lemmy.world/?x=1",
    "https://lemmy.world/#x"
  ])("rejects %s", (s) => expect(() => validateInstance(s)).toThrow());
  it("normalizes the selected origin", () => {
    expect(validateInstance("https://lemmy.world/")).toBe("https://lemmy.world");
    expect(validateInstance("https://example.org")).toBe("https://example.org");
  });
  it("normalizes as plain data and hides deleted records", () => {
    expect(normalizePost(post)?.body).toBe("<script>bad()<\/script>");
    expect(normalizePost({
      ...post,
      post: {
        ...post.post,
        removed: true
      }
    })).toBeNull();
    expect(normalizeComment({
      ...comment(1, "0.1"),
      comment: {
        id: 1,
        deleted: true
      }
    })).toBeNull();
    expect(normalizeComment(comment(1, "0.1"))?.content).toBe("<b>plain</b>");
  });
  it("builds comment trees independent of order and retains orphan replies", () => {
    const rows = [
      comment(3, "0.1.2.3"),
      comment(2, "0.1.2"),
      comment(1, "0.1"),
      comment(5, "0.4.5")
    ].map(normalizeComment).filter((c) => c !== null);
    const tree = commentTree(rows);
    expect(tree.map((c) => c.id)).toEqual([1, 5]);
    expect(tree[0].children[0].children[0].id).toBe(3);
  });
  it("limits the runtime allowlist to exactly the configured instance", () => {
    setLemmyInstance("https://lemmy.world");
    expect(() => assertAllowedUrl("https://lemmy.world/api/v3/site")).not.toThrow();
    setLemmyInstance("https://example.org");
    expect(() => assertAllowedUrl("https://lemmy.world/api/v3/site")).toThrow();
    expect(() => assertAllowedUrl("https://example.org.evil.test")).toThrow();
  });
  it("allows only exact observed external links, with validated schemes", () => {
    registerFeedLinks([
      "https://publisher.example/story",
      "javascript:evil()",
      "file:///bad"
    ]);
    expect(isAllowedExternalUrl("https://publisher.example/story")).toBe(true);
    expect(isAllowedExternalUrl("https://publisher.example/other")).toBe(false);
    expect(isAllowedExternalUrl("javascript:evil()")).toBe(false);
  });
});
describe("new IPC boundaries", () => {
  const valid: [InvokeChannel, unknown[]][] = [
    [IPC.marketsSearch, ["Apple"]],
    [IPC.marketsQuote, ["BTC/USD"]],
    [IPC.marketsCandles, ["AAPL", "5D"]],
    [IPC.marketsNews, ["AAPL", "Apple"]],
    [IPC.marketsExplain, [
      "AAPL",
      ["Headline"],
      "+2%"
    ]],
    [IPC.lemmyStatus, []],
    [IPC.lemmyLogout, []],
    [IPC.lemmyLogin, [{
      username_or_email: "user",
      password: "password",
      totp_2fa_token: "123456"
    }]],
    [IPC.lemmyFeed, [{
      type_: "All",
      sort: "New",
      page: 1,
      community_name: ""
    }]],
    [IPC.lemmyPost, [1]],
    [IPC.lemmyCommunities, ["test"]],
    [IPC.lemmyWrite, [{
      action: "post/like",
      id: 1,
      score: -1
    }]],
    [IPC.lemmyImage, ["https://lemmy.world/image.png"]]
  ];
  it.each(valid)("accepts valid %s and rejects extra arguments", (c, args) => {
    expect(() => validateIpcArgs(c, args)).not.toThrow();
    expect(() => validateIpcArgs(c, [...args, "extra"])).toThrow();
  });
  it.each([
    [IPC.marketsSearch, [""]],
    [IPC.marketsQuote, ["bad?key=secret"]],
    [IPC.marketsCandles, ["AAPL", "ALL"]],
    [IPC.marketsExplain, [
      "AAPL",
      Array(26).fill("x"),
      "m"
    ]],
    [IPC.marketsExplain, [
      "AAPL",
      ["x".repeat(301)],
      "m"
    ]],
    [IPC.marketsNews, ["AAPL", "x".repeat(201)]],
    [IPC.lemmyLogin, [{
      username_or_email: "u",
      password: "p",
      instance: "https://evil.test"
    }]],
    [IPC.lemmyFeed, [{
      type_: "Bad",
      sort: "New",
      page: 1,
      community_name: ""
    }]],
    [IPC.lemmyPost, [-1]],
    [IPC.lemmyWrite, [{
      action: "post/like",
      id: 1,
      score: 3
    }]],
    [IPC.lemmyWrite, [{
      action: "comment/report",
      id: 1,
      reason: ""
    }]],
    [IPC.lemmyImage, ["javascript:bad"]],
    [IPC.lemmyCommunities, ["a".repeat(151)]]
  ] as [InvokeChannel, unknown[]][])("rejects malformed %s", (c, args) => expect(() => validateIpcArgs(c, args)).toThrow());
  it("bounds watchlist and settings", () => {
    expect(settingsPatchSchema.safeParse({ marketWatchlist: Array(51).fill("AAPL") }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ marketWatchlist: ["bad symbol"] }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ lemmyInstance: "http://lemmy.world" }).success).toBe(false);
  });
  it("keeps CSP script/frame/connect sources unchanged", () => {
    const csp = buildCsp({ google3d: false });
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval';");
    expect(csp).toContain("frame-src 'self' about:");
    expect(csp).not.toMatch(/twelvedata|alphavantage|gdelt|lemmy|tradingview|'unsafe-eval'|script-src[^;]*unsafe-inline/);
  });
});
describe("main-process service safeguards", () => {
  it("does not fetch without a key", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const svc = new MarketService(secretMock(), () => DEFAULT_SETTINGS, storeMock());
    await expect(svc.search("apple")).rejects.toThrow(/NO_KEY/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("caches and coalesces quotes, counts provider tests and enforces rolling minute", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response(JSON.stringify(fixture.twelveQuote)));
    vi.stubGlobal("fetch", fetch);
    const secrets = secretMock();
    secrets.set("twelvedata", "key-secret");
    const svc = new MarketService(secrets, () => DEFAULT_SETTINGS, storeMock());
    await Promise.all([svc.quote("AAPL"), svc.quote("AAPL")]);
    await svc.test("twelvedata");
    expect(fetch).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 7; i++) await svc.quote("S" + i);
    await expect(svc.quote("LIMIT")).rejects.toThrow(/free-tier limit/);
    await vi.advanceTimersByTimeAsync(60001);
    await svc.quote("AFTER");
    expect(fetch).toHaveBeenCalledTimes(9);
  });
  it("warns at 20 and persists the Alpha Vantage daily cap", async () => {
    vi.useFakeTimers();
    const state = storeMock();
    const settings = {
      ...DEFAULT_SETTINGS,
      marketProvider: "alphavantage" as const
    };
    const secrets = secretMock();
    secrets.set("alphavantage", "secret-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(fixture.alphaQuote))));
    const svc = new MarketService(secrets, () => settings, state);
    for (let i = 0; i < 25; i++) {
      if (i % 5 === 0) await vi.advanceTimersByTimeAsync(60001);
      const r = await svc.quote("SYM" + i);
      if (i >= 19) expect(r.warning).toContain("of 25");
    }
    const restarted = new MarketService(secrets, () => settings, state);
    await expect(restarted.quote("OTHER")).rejects.toThrow(/free-tier limit/);
  });
  it("redacts keys in provider error messages", async () => {
    const secrets = secretMock();
    secrets.set("twelvedata", "super-secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      status: "error",
      message: "bad key super-secret at ?apikey=super-secret"
    }))));
    const svc = new MarketService(secrets, () => DEFAULT_SETTINGS, storeMock());
    await expect(svc.quote("AAPL")).rejects.toThrow(/\[redacted\]/);
    await expect(svc.quote("AAPL")).rejects.not.toThrow(/super-secret/);
  });
  it("queues GDELT at least six seconds apart and caches a query", async () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls.push(Date.now());
      return new Response(JSON.stringify(fixture.gdelt));
    }));
    const svc = new MarketService(secretMock(), () => DEFAULT_SETTINGS, storeMock());
    const first = svc.news("AAA", "One");
    await vi.advanceTimersByTimeAsync(1);
    await first;
    const second = svc.news("BBB", "Two");
    await vi.advanceTimersByTimeAsync(5999);
    await second;
    await svc.news("AAA", "One");
    expect(calls).toHaveLength(2);
    expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(6e3);
  });
  it("does not forward Lemmy authorization across redirects", async () => {
    setLemmyInstance("https://lemmy.world");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://api.weather.gov/alerts" }
    })));
    await expect(fetchJson("https://lemmy.world/api/v3/site", {
      headers: { Authorization: "Bearer secret" },
      sameOrigin: true
    })).rejects.toThrow(/Cross-origin/);
  });
  it("stores only the JWT, uses bearer auth, and clears it on instance change", async () => {
    const secrets = secretMock();
    const seen: {
      url: string;
      options: RequestInit;
    }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, opts: RequestInit) => {
      seen.push({
        url: String(url),
        options: opts
      });
      return new Response(JSON.stringify(String(url).endsWith("/login") ? { jwt: "jwt-secret" } : { my_user: { local_user_view: { person: { name: "person" } } } }));
    }));
    const svc = new LemmyService(secrets, () => DEFAULT_SETTINGS);
    await svc.login({
      username_or_email: "person",
      password: "never-store"
    });
    expect(secrets.get("lemmy:https://lemmy.world")).toBe("jwt-secret");
    expect(await svc.status()).toEqual({
      signedIn: true,
      name: "person"
    });
    expect(seen[1].options.headers).toHaveProperty("Authorization", "Bearer jwt-secret");
    expect(seen[0].url).not.toContain("never-store");
    svc.changeInstance("https://example.org");
    expect(secrets.get("lemmy:https://lemmy.world")).toBeNull();
    await expect(svc.write({
      action: "comment",
      post_id: 1,
      content: "text"
    })).rejects.toThrow(/Sign in/);
  });
  it("omits empty optional url and body when creating a text-only post", async () => {
    const secrets = secretMock();
    secrets.set("lemmy:https://lemmy.world", "jwt-secret");
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: URL, opts: RequestInit) => {
      bodies.push(JSON.parse(String(opts.body)));
      return new Response(JSON.stringify({ post_view: {} }));
    }));
    const svc = new LemmyService(secrets, () => DEFAULT_SETTINGS);
    await svc.write({ action: "post", community_id: 7, name: "Title only", body: "", url: "", nsfw: false });
    expect(bodies[0]).toEqual({ community_id: 7, name: "Title only", nsfw: false });
    await svc.write({ action: "post", community_id: 7, name: "With link", body: "Text", url: "https://example.org/a", nsfw: false });
    expect(bodies[1]).toEqual({ community_id: 7, name: "With link", body: "Text", url: "https://example.org/a", nsfw: false });
  });
  it("rejects foreign image hosts before network access", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const svc = new LemmyService(secretMock(), () => DEFAULT_SETTINGS);
    await expect(svc.image("https://api.weather.gov/image.png")).rejects.toThrow(/configured instance/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
