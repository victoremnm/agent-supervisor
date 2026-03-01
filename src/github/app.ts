// src/github/app.ts
// GitHub App authentication using @octokit/app v4 + @octokit/rest.
// Source: https://github.com/octokit/app.js (v4 API)
// The App exchanges App credentials (appId + privateKey) for short-lived
// installation access tokens. All API calls authenticate as supervisor-bot[bot].

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
 * Get an authenticated Octokit instance for a specific repo installation.
 *
 * Uses GITHUB_APP_INSTALLATION_ID env var if set (faster, no extra API call).
 * Constructs an @octokit/rest Octokit instance authenticated with the
 * short-lived installation access token.
 *
 * @param _owner - Repository owner (reserved for future dynamic lookup)
 * @param _repo - Repository name (reserved for future dynamic lookup)
 */
export async function getInstallationOctokit(
  _owner: string,
  _repo: string
): Promise<Octokit> {
  const app = getApp();

  // Use pre-configured installation ID if available (preferred in CI)
  const staticInstallationId = process.env.GITHUB_APP_INSTALLATION_ID;
  if (!staticInstallationId) {
    throw new Error(
      "GITHUB_APP_INSTALLATION_ID must be set. " +
        "Run: gh api /app/installations | jq '.[0].id' (after installing the App on repos). " +
        "See GITHUB_APP_SETUP.md for setup instructions."
    );
  }

  const installationId = parseInt(staticInstallationId, 10);

  // Exchange App credentials for a short-lived installation access token
  const token = await app.getInstallationAccessToken({ installationId });

  return new Octokit({ auth: token });
}
