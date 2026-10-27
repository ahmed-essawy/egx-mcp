interface GoogleSecrets {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}

declare namespace Cloudflare {
  interface Env extends GoogleSecrets {}
}

interface Env extends GoogleSecrets {}
