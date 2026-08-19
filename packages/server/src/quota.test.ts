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
  test("parses all four AFP windows", () => {
    const payload = {
      PlanType: "Large",
      AFPFiveHour: { Quota: 50.0, Used: 12.5, SubscribeTime: 1778788800000, ResetTime: 1778806800000 },
      AFPDaily: { Quota: 100.0, Used: 22.5, SubscribeTime: 1778716800000, ResetTime: 1778803200000 },
      AFPWeekly: { Quota: 500.0, Used: 150.0, SubscribeTime: 1778457600000, ResetTime: 1779062400000 },
      AFPMonthly: { Quota: 2000.0, Used: 850.5, SubscribeTime: 1777939200000, ResetTime: 1780531200000 },
    };
    const windows = parseArkAfpUsage(payload);
    expect(windows).toHaveLength(4);
    expect(windows[0]).toEqual({
      label: "5h",
      utilization: 0.25,
      resetsAt: 1778806800000,
      used: 12.5,
      limit: 50.0,
      unit: "AFP",
    });
    expect(windows[1].label).toBe("Daily");
    expect(windows[1].utilization).toBeCloseTo(0.225);
    expect(windows[2].label).toBe("Weekly");
    expect(windows[3].label).toBe("Monthly");
    expect(windows[3].used).toBe(850.5);
  });

  test("throws on empty response", () => {
    expect(() => parseArkAfpUsage({})).toThrow("no window data");
  });
});
