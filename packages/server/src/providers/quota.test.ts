import { describe, expect, test } from "bun:test";
import { listQuotaProvidersForModels, parseArkAfpUsage } from "./quota";

describe("RPC quota providers", () => {
  test("lists only adapters with provider-id-only endpoint resolution", () => {
    expect(
      listQuotaProvidersForModels([
        { provider: "minimax-cn" },
        { provider: "deepseek" },
        { provider: "moonshotai-cn" },
        { provider: "openai" },
        { provider: "ark-agent-plan" },
        { provider: "custom-openai-proxy" },
        { provider: "minimax-cn" },
      ]),
    ).toEqual([
      { id: "minimax-cn", name: "MiniMax" },
      { id: "deepseek", name: "DeepSeek" },
      { id: "moonshotai-cn", name: "Moonshot" },
      { id: "openai", name: "OpenAI" },
      { id: "ark-agent-plan", name: "Ark Agent Plan" },
    ]);
  });
});

describe("parseArkAfpUsage", () => {
  test("parses 5h / Weekly / Monthly, skipping AFPDaily", () => {
    // 真实 GetAFPUsage 响应（实测 2026-08-19）：AFPDaily 被控制台隐藏，应跳过。
    const payload = {
      PlanType: "medium",
      AFPFiveHour: { Quota: 10000, Used: 1665.9303, SubscribeTime: 1787113844000, ResetTime: 1787131844000 },
      AFPDaily: { Quota: 50000, Used: 0, SubscribeTime: 1787068800000, ResetTime: 1787155200000 },
      AFPWeekly: { Quota: 35000, Used: 1665.9303, SubscribeTime: 1786896000000, ResetTime: 1787500800000 },
      AFPMonthly: { Quota: 100000, Used: 1665.9303, SubscribeTime: 1787113181000, ResetTime: 1789833599000 },
    };
    const windows = parseArkAfpUsage(payload);
    expect(windows).toHaveLength(3);
    expect(windows[0]).toEqual({
      label: "5h",
      utilization: 1665.9303 / 10000,
      resetsAt: 1787131844000,
      used: 1665.9303,
      limit: 10000,
      unit: "AFP",
    });
    expect(windows[1].label).toBe("Weekly");
    expect(windows[1].utilization).toBeCloseTo(1665.9303 / 35000);
    expect(windows[2].label).toBe("Monthly");
    expect(windows[2].used).toBe(1665.9303);
  });

  test("skips windows with zero or missing quota", () => {
    const payload = {
      AFPFiveHour: { Quota: 0, Used: 0 },
      AFPWeekly: { Quota: 0, Used: 0 },
      AFPMonthly: { Quota: 0, Used: 0 },
    };
    expect(() => parseArkAfpUsage(payload)).toThrow("no window data");
  });

  test("throws on empty response", () => {
    expect(() => parseArkAfpUsage({})).toThrow("no window data");
  });
});
