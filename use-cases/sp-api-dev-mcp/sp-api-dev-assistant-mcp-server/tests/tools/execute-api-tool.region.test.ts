import { describe, expect, it, vi } from "vitest";
import { SpApiAuthenticatorProvider } from "../../src/auth/sp-api-auth.js";
import {
  ExecuteApiTool,
  resolveSellingRegion,
} from "../../src/tools/execute-api-tool.js";
import { ApiCatalog } from "../../src/types/api-catalog.js";

const catalog: ApiCatalog = {
  categories: [
    {
      name: "Test",
      description: "Test category",
      endpoints: [
        {
          id: "test_get",
          originalOperationId: "getTest",
          name: "getTest",
          path: "/test",
          method: "GET",
          description: "Test endpoint",
          purpose: "Test regional credential selection",
          commonUseCases: [],
          parameters: [],
          responses: [],
          relatedEndpoints: [],
          version: { current: "1", deprecated: [], beta: [], changes: [] },
          examples: [],
        },
      ],
    },
  ],
  intentMappings: [],
};

describe("regional SP-API execution", () => {
  it.each([
    ["NA", "NA"],
    ["US", "NA"],
    ["EU", "EU"],
    ["DE", "EU"],
    ["FE", "FE"],
    ["JP", "FE"],
  ] as const)("normalizes %s to %s", (input, expected) => {
    expect(resolveSellingRegion(input)).toBe(expected);
  });

  it("selects the authenticator that matches the request region", async () => {
    const signRequest = vi
      .fn()
      .mockRejectedValue(new Error("stop before HTTP"));
    const getAuthenticator = vi.fn().mockReturnValue({
      getExplicitBaseUrl: () => null,
      signRequest,
    });
    const provider = {
      getAuthenticator,
    } as unknown as SpApiAuthenticatorProvider;
    const tool = new ExecuteApiTool(catalog, provider);

    await tool.execute({
      endpoint: "test_get",
      parameters: {},
      region: "DE",
      rawMode: false,
      generateCode: false,
    });

    expect(getAuthenticator).toHaveBeenCalledOnce();
    expect(getAuthenticator).toHaveBeenCalledWith("EU");
    expect(signRequest).toHaveBeenCalledOnce();
  });
});
