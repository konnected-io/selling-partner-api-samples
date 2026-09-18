import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAuthenticatorProviderFromEnv,
  SP_API_REGIONS,
} from "../../src/auth/sp-api-auth.js";

const LEGACY_KEYS = [
  "SP_API_CLIENT_ID",
  "SP_API_CLIENT_SECRET",
  "SP_API_REFRESH_TOKEN",
  "SP_API_BASE_URL",
];

const REGIONAL_KEYS = SP_API_REGIONS.flatMap((region) => [
  `SP_API_${region}_CLIENT_ID`,
  `SP_API_${region}_CLIENT_SECRET`,
  `SP_API_${region}_REFRESH_TOKEN`,
  `SP_API_${region}_BASE_URL`,
]);

const CREDENTIAL_KEYS = [...LEGACY_KEYS, ...REGIONAL_KEYS];
let originalEnvironment: Record<string, string | undefined>;

beforeEach(() => {
  originalEnvironment = Object.fromEntries(
    CREDENTIAL_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of CREDENTIAL_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of CREDENTIAL_KEYS) {
    const value = originalEnvironment[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function configureRegion(region: "NA" | "EU" | "FE", marker: string): void {
  process.env[`SP_API_${region}_CLIENT_ID`] = `${marker}-client`;
  process.env[`SP_API_${region}_CLIENT_SECRET`] = `${marker}-secret`;
  process.env[`SP_API_${region}_REFRESH_TOKEN`] = `${marker}-refresh`;
}

describe("createAuthenticatorProviderFromEnv", () => {
  it("preserves the legacy single-credential configuration", () => {
    process.env.SP_API_CLIENT_ID = "legacy-client";
    process.env.SP_API_CLIENT_SECRET = "legacy-secret";
    process.env.SP_API_REFRESH_TOKEN = "legacy-refresh";

    const provider = createAuthenticatorProviderFromEnv();

    expect(provider).not.toBeNull();
    expect(provider!.getAuthenticator("NA")).toBe(
      provider!.getAuthenticator("EU"),
    );
  });

  it("returns independent authenticators for configured regions", () => {
    configureRegion("NA", "na");
    configureRegion("EU", "eu");

    const provider = createAuthenticatorProviderFromEnv();
    const naAuthenticator = provider!.getAuthenticator("NA");
    const euAuthenticator = provider!.getAuthenticator("EU");

    expect(naAuthenticator).not.toBe(euAuthenticator);
    expect((naAuthenticator as any).credentials.refreshToken).toBe(
      "na-refresh",
    );
    expect((euAuthenticator as any).credentials.refreshToken).toBe(
      "eu-refresh",
    );
  });

  it("uses a regional base URL only for its matching authenticator", () => {
    configureRegion("NA", "na");
    configureRegion("EU", "eu");
    process.env.SP_API_EU_BASE_URL = "https://eu.example.test";

    const provider = createAuthenticatorProviderFromEnv();

    expect(provider!.getAuthenticator("NA").getExplicitBaseUrl()).toBeNull();
    expect(provider!.getAuthenticator("EU").getExplicitBaseUrl()).toBe(
      "https://eu.example.test",
    );
  });

  it("fails closed when the requested region has no credentials", () => {
    configureRegion("NA", "na");
    process.env.SP_API_CLIENT_ID = "legacy-client";
    process.env.SP_API_CLIENT_SECRET = "legacy-secret";
    process.env.SP_API_REFRESH_TOKEN = "legacy-refresh";

    const provider = createAuthenticatorProviderFromEnv();

    expect(() => provider!.getAuthenticator("EU")).toThrow(
      "SP-API credentials are not configured for region EU",
    );
  });

  it("rejects an incomplete regional credential set", () => {
    process.env.SP_API_EU_CLIENT_ID = "eu-client";
    process.env.SP_API_EU_CLIENT_SECRET = "eu-secret";

    expect(() => createAuthenticatorProviderFromEnv()).toThrow(
      "Missing: SP_API_EU_REFRESH_TOKEN",
    );
  });

  it("returns null when no credentials are configured", () => {
    expect(createAuthenticatorProviderFromEnv()).toBeNull();
  });
});
