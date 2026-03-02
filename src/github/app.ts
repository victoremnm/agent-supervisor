// src/github/app.ts
// GitHub App authentication using @octokit/app v4 + @octokit/rest.
// Source: https://github.com/octokit/app.js (v4 API)
// The App exchanges App credentials (appId + privateKey) for short-lived
// installation access tokens. All API calls authenticate as supervisor-bot[bot].
//
// Multi-org support:
//   Set GITHUB_APP_INSTALLATION_IDS=victoremnm:12345,BonkBotTeam:67890,lfefoundation:11111
//   The daemon calls bootstrapGitHubToken(owner) per-repo to switch tokens across orgs.
//   GITHUB_APP_INSTALLATION_ID (singular) is the fallback for single-org deployments.

import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";

// Cache the App instance (private key parsing is expensive)
let _app: App | null = null;

function getApp(): App {
  if (_app) return _app;

  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKey) {
    throw new Error(
      "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set. " +
        "See GITHUB_APP_SETUP.md for setup instructions."
    );
  }

  // Env vars escape newlines as \n — restore actual newlines for PEM format
  const normalizedKey = privateKey.replace(/\\n/g, "\n");

  _app = new App({
    id: parseInt(appId, 10),
    privateKey: normalizedKey,
  });

  return _app;
}

/**
 * Resolve the GitHub App installation ID for a given owner (user or org).
 *
 * Resolution order:
 *   1. GITHUB_APP_INSTALLATION_IDS env var — comma-separated "owner:id" pairs
 *      e.g. "victoremnm:113367631,BonkBotTeam:987654,lfefoundation:111222"
 *   2. GITHUB_APP_INSTALLATION_ID — singular fallback for single-org deployments
 *
 * Returns null if neither is configured for the given owner.
 */
function resolveInstallationId(owner: string): string | null {
  const idsMap = process.env.GITHUB_APP_INSTALLATION_IDS ?? "";
  if (idsMap) {
    for (const pair of idsMap.split(",")) {
      const [mapOwner, mapId] = pair.trim().split(":");
      if (mapOwner?.toLowerCase() === owner.toLowerCase() && mapId) {
        return mapId.trim();
      }
    }
  }
  // Fallback: single-org mode
  return process.env.GITHUB_APP_INSTALLATION_ID ?? null;
}

/**
 * Generate a GitHub App installation token for the given owner and set it as
 * GITHUB_TOKEN so the `gh` CLI used by agent Bash tools can access that org's repos.
 *
 * Call this once per owner before running agents against that owner's repos.
 * Tokens are short-lived (~1 hour) — safe to regenerate each loop iteration.
 *
 * No-ops gracefully if GitHub App env vars are not configured.
 */
export async function bootstrapGitHubToken(owner: string): Promise<void> {
  const installationId = resolveInstallationId(owner);
  if (!installationId) {
    console.log(
      `[auth] No installation ID found for owner "${owner}" — ` +
        "set GITHUB_APP_INSTALLATION_IDS or GITHUB_APP_INSTALLATION_ID"
    );
    return;
  }

  try {
    const app = getApp();
    const token = await app.getInstallationAccessToken({
      installationId: parseInt(installationId, 10),
    });
    process.env.GITHUB_TOKEN = token;
    console.log(`[auth] Installation token set for owner "${owner}" (gh CLI ready)`);
  } catch (err) {
    console.warn(
      `[auth] Failed to get installation token for "${owner}":`,
      err instanceof Error ? err.message : String(err)
    );
    console.warn("[auth] gh CLI will fall back to runner GITHUB_TOKEN (may lack access)");
  }
}

/**
 * Get an authenticated Octokit instance for a specific repo installation.
 *
 * Uses resolveInstallationId(owner) for per-org token generation.
 * Constructs an @octokit/rest Octokit instance authenticated with the
 * short-lived installation access token.
 */
export async function getInstallationOctokit(
  owner: string,
  _repo: string
): Promise<Octokit> {
  const installationId = resolveInstallationId(owner);
  if (!installationId) {
    throw new Error(
      `No installation ID configured for owner "${owner}". ` +
        "Set GITHUB_APP_INSTALLATION_IDS=owner:id,owner2:id2 or GITHUB_APP_INSTALLATION_ID. " +
        "See GITHUB_APP_SETUP.md for setup instructions."
    );
  }

  const app = getApp();
  // Exchange App credentials for a short-lived installation access token
  const token = await app.getInstallationAccessToken({
    installationId: parseInt(installationId, 10),
  });

  return new Octokit({ auth: token });
}
