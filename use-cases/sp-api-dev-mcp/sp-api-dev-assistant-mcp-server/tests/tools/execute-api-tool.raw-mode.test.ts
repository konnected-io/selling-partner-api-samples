import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpApiAuthenticatorProvider } from "../../src/auth/sp-api-auth.js";
import { ExecuteApiTool } from "../../src/tools/execute-api-tool.js";
import { ApiCatalog } from "../../src/types/api-catalog.js";

vi.mock("axios", () => ({
  default: vi.fn(),
}));

const catalog: ApiCatalog = {
  categories: [
    {
      name: "Reports",
      description: "Reports API",
      endpoints: [
        {
          id: "reports_getReportDocument",
          originalOperationId: "getReportDocument",
          name: "getReportDocument",
          path: "/reports/2021-06-30/documents/{reportDocumentId}",
          method: "GET",
          description: "Get report document metadata",
          purpose: "Retrieve report document metadata",
          commonUseCases: [],
          parameters: [
            {
              name: "reportDocumentId",
              type: "string",
              required: true,
              location: "path",
              description: "Report document identifier",
            },
          ],
          responses: [],
          relatedEndpoints: [],
          version: {
            current: "2021-06-30",
            deprecated: [],
            beta: [],
            changes: [],
          },
          examples: [],
        },
      ],
    },
  ],
  intentMappings: [],
};

describe("SP-API raw response mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns exact JSON without abbreviating a signed report-document URL", async () => {
    const signedUrl =
      "https://example-bucket.s3.amazonaws.com/report.tsv?" +
      "X-Amz-Algorithm=AWS4-HMAC-SHA256&" +
      `X-Amz-Credential=${"credential-segment-".repeat(20)}&` +
      `X-Amz-Signature=${"0123456789abcdef".repeat(16)}`;
    const responseBody = {
      reportDocumentId: "amzn1.spdoc.test",
      url: signedUrl,
      compressionAlgorithm: "GZIP",
    };
    vi.mocked(axios).mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: {},
      data: responseBody,
    });

    const provider = {
      getAuthenticator: vi.fn().mockReturnValue({
        getExplicitBaseUrl: () => null,
        signRequest: vi.fn().mockImplementation(async (request) => request),
      }),
    } as unknown as SpApiAuthenticatorProvider;
    const tool = new ExecuteApiTool(catalog, provider);

    const result = await tool.execute({
      endpoint: "reports_getReportDocument",
      parameters: { reportDocumentId: "amzn1.spdoc.test" },
      region: "US",
      rawMode: true,
      generateCode: false,
    });

    expect(JSON.parse(result)).toEqual(responseBody);
    expect(result).toContain(signedUrl);
    expect(result).not.toContain("# SP-API Response");
    expect(result).not.toMatch(/\.\.\.|…/);
  });
});
