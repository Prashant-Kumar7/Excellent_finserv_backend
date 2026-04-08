import axios, { AxiosError, type AxiosInstance } from "axios";

type OAuthTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type?: string;
};

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

export type VkycUserInput = {
  id: number | string;
  name?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
};

export type VkycUserResult = {
  user_id: string;
};

export type VkycInitiateResult = {
  verification_id: string;
  vkyc_url: string;
};

function cashfreeBaseUrl(): string {
  const env = (process.env.CASHFREE_ENV ?? "SANDBOX").toUpperCase();
  return env === "PRODUCTION" ? "https://api.cashfree.com" : "https://sandbox.cashfree.com";
}

// Cashfree expects a specific VRS API version header.
// Error from Cashfree: "provided x-api-version should be 2024-12-01"
const CF_VRS_API_VERSION = "2024-12-01";

const vkycClient: AxiosInstance = axios.create({
  // Cashfree Verification Suite base path is `/verification`
  baseURL: `${cashfreeBaseUrl()}/verification`,
  timeout: 15000
});

let cachedToken: CachedToken | null = null;

function isTokenValid(token: CachedToken | null): boolean {
  if (!token) return false;
  const now = Date.now();
  // Refresh 60 seconds before expiry for safety
  return now + 60_000 < token.expiresAt;
}

async function requestOAuthToken(): Promise<CachedToken> {
  const clientId = process.env.CASHFREE_VRS_CLIENT_ID ?? "";
  const clientSecret = process.env.CASHFREE_VRS_CLIENT_SECRET ?? "";

  if (!clientId || !clientSecret) {
    throw new Error("CASHFREE_VRS_CLIENT_ID and CASHFREE_VRS_CLIENT_SECRET must be set");
  }

  try {
    const url = "/oauth/token";
    // Cashfree VRS OAuth expects credentials in headers (x-client-id/secret).
    // (Matches the existing Secure ID implementation in `shared/cashfreeSecureId.ts`.)
    const body = {
      grant_type: "client_credentials"
    };

    const res = await vkycClient.post<OAuthTokenResponse>(url, body, {
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
        "x-api-version": CF_VRS_API_VERSION,
        "x-client-id": clientId,
        "x-client-secret": clientSecret
      }
    });

    const data = res.data;
    if (!data?.access_token || !data?.expires_in) {
      throw new Error("Cashfree VKYC OAuth response missing access_token or expires_in");
    }

    const token: CachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000
    };

    cachedToken = token;
    return token;
  } catch (err) {
    const e = err as AxiosError;
    console.error("Cashfree VKYC getOAuthToken error", {
      status: e.response?.status,
      data: e.response?.data
    });
    const msg =
      (e.response?.data as { message?: string } | undefined)?.message ??
      e.message ??
      "Unable to obtain Cashfree VKYC token";
    throw new Error(msg);
  }
}

export async function getOAuthToken(forceRefresh = false): Promise<CachedToken> {
  if (!forceRefresh && isTokenValid(cachedToken)) {
    return cachedToken as CachedToken;
  }
  return requestOAuthToken();
}

async function authorizedPost<T>(
  path: string,
  body: Record<string, unknown>,
  opts?: { retryOnAuthError?: boolean }
): Promise<T> {
  const retryOnAuthError = opts?.retryOnAuthError ?? true;

  const token = await getOAuthToken();

  try {
    const res = await vkycClient.post<T>(path, body, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
        accept: "application/json",
        "x-api-version": CF_VRS_API_VERSION
      }
    });
    console.log(`Cashfree VKYC POST ${path} success`, {
      status: res.status
    });
    return res.data;
  } catch (err) {
    const error = err as AxiosError;
    const status = error.response?.status;

    console.error(`Cashfree VKYC POST ${path} error`, {
      status,
      data: error.response?.data
    });

    // If token looks expired/invalid, refresh once and retry
    if (retryOnAuthError && (status === 401 || status === 403)) {
      await getOAuthToken(true);
      return authorizedPost<T>(path, body, { retryOnAuthError: false });
    }

    throw new Error(
      `Cashfree VKYC request failed for ${path}: ${
        (error.response?.data as { message?: string })?.message ??
        error.message ??
        "Unknown error"
      }`
    );
  }
}

export async function createVkycUser(user: VkycUserInput): Promise<VkycUserResult> {
  const payload: Record<string, unknown> = {
    customer_identifier: String(user.id),
    customer_name: user.name ?? "",
    email: user.email ?? "",
    phone: user.phone ?? ""
  };

  const data = await authorizedPost<VkycUserResult>("/users", payload);
  if (!data?.user_id) {
    throw new Error("Cashfree VKYC user response missing user_id");
  }
  return data;
}

export async function initiateVkyc(userId: string): Promise<VkycInitiateResult> {
  const payload: Record<string, unknown> = {
    user_id: userId
  };

  const data = await authorizedPost<VkycInitiateResult>("/video-kyc/initiate", payload);
  if (!data?.verification_id || !data?.vkyc_url) {
    throw new Error("Cashfree VKYC initiate response missing verification_id or vkyc_url");
  }
  return data;
}

