// src/auth/sp-api-auth.ts

import axios from "axios";
import aws4 from "aws4";
import { URL } from "url";
import { logger } from "../utils/logger.js";

export interface SpApiCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  roleArn?: string;
  baseUrl?: string;
}

export const SP_API_REGIONS = ["NA", "EU", "FE"] as const;
export type SpApiRegion = (typeof SP_API_REGIONS)[number];

export interface SpApiAuthenticatorProvider {
  getAuthenticator(region: SpApiRegion): SpApiAuthenticator;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class SpApiAuthenticator {
  private accessToken: string | null = null;
  private tokenExpiration: Date | null = null;

  constructor(private credentials: SpApiCredentials) {}

  /**
   * Get the configured base URL for SP-API requests.
   * Returns the default NA endpoint if not explicitly configured.
   */
  getBaseUrl(): string {
    return (
      this.credentials.baseUrl || "https://sellingpartnerapi-na.amazon.com"
    );
  }

  /**
   * Returns the explicitly configured base URL (from SP_API_BASE_URL),
   * or null if none was set. Callers use this to decide whether to apply
   * region-based endpoint mapping.
   */
  getExplicitBaseUrl(): string | null {
    return this.credentials.baseUrl || null;
  }

  /**
   * Get a valid access token, refreshing if necessary
   * @throws Error if token cannot be obtained
   */
  async getAccessToken(): Promise<string> {
    // Check if token is still valid
    if (
      this.accessToken &&
      this.tokenExpiration &&
      this.tokenExpiration > new Date()
    ) {
      return this.accessToken;
    }

    // Otherwise, refresh the token
    try {
      logger.info("Refreshing SP-API access token");

      const params = new URLSearchParams();
      params.append("grant_type", "refresh_token");
      params.append("refresh_token", this.credentials.refreshToken);
      params.append("client_id", this.credentials.clientId);
      params.append("client_secret", this.credentials.clientSecret);

      // Get the OAuth URL from environment or use default
      const oauthUrl =
        process.env.SP_API_OAUTH_URL || "https://api.amazon.com/auth/o2/token";

      // Use axios for the request
      const response = await axios.post<TokenResponse>(
        oauthUrl,
        params.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
        },
      );

      // Ensure we have a valid access token
      if (!response.data.access_token) {
        throw new Error("No access token received in the response");
      }

      this.accessToken = response.data.access_token;

      // Set expiration time (subtract 5 minutes for safety)
      const expiresIn = (response.data.expires_in - 300) * 1000;
      this.tokenExpiration = new Date(Date.now() + expiresIn);

      logger.info("Successfully refreshed SP-API access token");
      logger.info(
        `Token expires in ${expiresIn / 1000} seconds (${this.tokenExpiration})`,
      );

      return this.accessToken;
    } catch (error) {
      logger.error("Failed to refresh SP-API access token:", error);
      this.accessToken = null;
      this.tokenExpiration = null;
      throw new Error(
        "Failed to authenticate with SP-API: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /**
   * Prepare a request with the required SP-API authentication
   */
  async signRequest(request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: any;
  }): Promise<{
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: any;
  }> {
    try {
      // Get access token
      const accessToken = await this.getAccessToken();
      logger.info("Successfully obtained access token for request");

      // Add access token to headers
      const headers = {
        ...request.headers,
        "x-amz-access-token": accessToken,
      };

      // Log request details for debugging (without sensitive info)
      logger.info(`Preparing request for ${request.method} ${request.url}`);

      // Return the request with the access token added
      return {
        method: request.method,
        url: request.url,
        headers: headers,
        body: request.body,
      };
    } catch (error) {
      logger.info("Failed to prepare SP-API request:", error);
      throw new Error(
        "Failed to prepare SP-API request: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }
}

class StaticSpApiAuthenticatorProvider implements SpApiAuthenticatorProvider {
  constructor(private authenticator: SpApiAuthenticator) {}

  getAuthenticator(_region: SpApiRegion): SpApiAuthenticator {
    return this.authenticator;
  }
}

class RegionalSpApiAuthenticatorProvider implements SpApiAuthenticatorProvider {
  constructor(
    private authenticators: Partial<Record<SpApiRegion, SpApiAuthenticator>>,
  ) {}

  getAuthenticator(region: SpApiRegion): SpApiAuthenticator {
    const authenticator = this.authenticators[region];
    if (!authenticator) {
      throw new Error(
        `SP-API credentials are not configured for region ${region}. ` +
          `Set SP_API_${region}_CLIENT_ID, SP_API_${region}_CLIENT_SECRET, and ` +
          `SP_API_${region}_REFRESH_TOKEN.`,
      );
    }
    return authenticator;
  }
}

function readRegionalCredentialsFromEnv(
  region: SpApiRegion,
): SpApiCredentials | null {
  const prefix = `SP_API_${region}`;
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  const refreshToken = process.env[`${prefix}_REFRESH_TOKEN`];
  const baseUrl = process.env[`${prefix}_BASE_URL`];
  const values = [clientId, clientSecret, refreshToken, baseUrl];

  if (!values.some((value) => value !== undefined)) {
    return null;
  }

  const missing = [
    ["CLIENT_ID", clientId],
    ["CLIENT_SECRET", clientSecret],
    ["REFRESH_TOKEN", refreshToken],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => `${prefix}_${name}`);

  if (missing.length > 0) {
    throw new Error(
      `Incomplete SP-API credentials for region ${region}. Missing: ${missing.join(", ")}`,
    );
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    refreshToken: refreshToken!,
    baseUrl,
  };
}

// Factory to create authenticator from environment variables
export const createAuthenticatorFromEnv = (): SpApiAuthenticator | null => {
  const clientId = process.env.SP_API_CLIENT_ID || "";
  const clientSecret = process.env.SP_API_CLIENT_SECRET;
  const refreshToken = process.env.SP_API_REFRESH_TOKEN;
  const baseUrl = process.env.SP_API_BASE_URL;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  return new SpApiAuthenticator({
    clientId,
    clientSecret,
    refreshToken,
    baseUrl,
  });
};

/**
 * Creates a region-aware authenticator provider from environment variables.
 *
 * Regional credentials use SP_API_<REGION>_CLIENT_ID,
 * SP_API_<REGION>_CLIENT_SECRET, and SP_API_<REGION>_REFRESH_TOKEN, where
 * REGION is NA, EU, or FE. An optional SP_API_<REGION>_BASE_URL can override
 * that region's endpoint. If any regional credential variable is present,
 * regional mode is enabled and the legacy unprefixed credentials are not used
 * as a fallback for missing regions.
 *
 * When no regional credentials are configured, the existing unprefixed
 * SP_API_CLIENT_ID, SP_API_CLIENT_SECRET, SP_API_REFRESH_TOKEN, and
 * SP_API_BASE_URL variables remain fully backward compatible.
 */
export const createAuthenticatorProviderFromEnv =
  (): SpApiAuthenticatorProvider | null => {
    const regionalAuthenticators: Partial<
      Record<SpApiRegion, SpApiAuthenticator>
    > = {};

    for (const region of SP_API_REGIONS) {
      const credentials = readRegionalCredentialsFromEnv(region);
      if (credentials) {
        regionalAuthenticators[region] = new SpApiAuthenticator(credentials);
      }
    }

    if (Object.keys(regionalAuthenticators).length > 0) {
      return new RegionalSpApiAuthenticatorProvider(regionalAuthenticators);
    }

    const authenticator = createAuthenticatorFromEnv();
    return authenticator
      ? new StaticSpApiAuthenticatorProvider(authenticator)
      : null;
  };
