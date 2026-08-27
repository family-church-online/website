import { defineConfig } from "tinacms";
import { GlobalConfigCollection } from "./collections/global-config";
import { PageCollection } from "./collections/page";
import { SermonCollection } from "./collections/sermon";
import { DevotionCollection } from "./collections/devotion";

// Your hosting provider likely exposes this as an environment variable
const branch =
  process.env.GITHUB_BRANCH ||
  process.env.VERCEL_GIT_COMMIT_REF ||
  process.env.WORKERS_CI_BRANCH || // Cloudflare Workers Builds
  process.env.CF_PAGES_BRANCH || // Cloudflare Pages
  process.env.HEAD || // Netlify
  "master";

// TINA_HOST can be either a bare host/IP (LAN dev, e.g. "192.168.5.200"),
// which we assume is plain http on the Astro dev port, or a full URL
// (e.g. "https://tina.familychurch.online" via the Cloudflare tunnel),
// which is used as-is.
function getLocalContentApiUrl() {
  const host = process.env.TINA_HOST;
  if (!host) return undefined;
  if (/^https?:\/\//.test(host)) return host;
  return `http://${host}:4321`;
}

export default defineConfig({
  branch,

  // Get this from tina.io
  clientId: process.env.PUBLIC_TINA_CLIENT_ID,
  // Get this from tina.io
  token: process.env.TINA_TOKEN,

  build: {
    outputFolder: "admin",
    publicFolder: "public",
    // When TINA_HOST is set, the admin bundle points there instead of
    // localhost:4001 — either a LAN IP (mobile devices on the same WiFi)
    // or a full URL like the Cloudflare tunnel host.
    ...(getLocalContentApiUrl()
      ? { localContentApiUrlOverride: getLocalContentApiUrl() }
      : {}),
  },
  media: {
    tina: {
      mediaRoot: "",
      publicFolder: "public",
    },
  },
  // See docs on content modeling for more info on how to setup new content models: https://tina.io/docs/schema/
  schema: {
    collections: [
      PageCollection,
      SermonCollection,
      DevotionCollection,
      GlobalConfigCollection,
    ],
  },
});
