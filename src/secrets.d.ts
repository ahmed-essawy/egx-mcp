interface GoogleSecrets {
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}

interface OAuthBinding {
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
}

declare namespace Cloudflare {
  interface Env extends GoogleSecrets, OAuthBinding {}
}

interface Env extends GoogleSecrets, OAuthBinding {}
