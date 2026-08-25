import { defineConfig } from "tinacms";
import { GlobalConfigCollection } from "./collections/global-config";
import { PageCollection } from "./collections/page";
import { SermonCollection } from "./collections/sermon";

// Your hosting provider likely exposes this as an environment variable
const branch =
  process.env.GITHUB_BRANCH ||
  process.env.VERCEL_GIT_COMMIT_REF ||
  process.env.WORKERS_CI_BRANCH || // Cloudflare Workers Builds
  process.env.CF_PAGES_BRANCH || // Cloudflare Pages
  process.env.HEAD || // Netlify
  "main";

export default defineConfig({
  branch,

  // Get this from tina.io
  clientId: process.env.PUBLIC_TINA_CLIENT_ID,
  // Get this from tina.io
  token: process.env.TINA_TOKEN,

  build: {
    outputFolder: "admin",
    publicFolder: "public",
    // When TINA_HOST is set, the admin bundle points to that IP so mobile
    // devices on the same WiFi can reach the local content API.
    ...(process.env.TINA_HOST
      ? { localContentApiUrlOverride: `http://${process.env.TINA_HOST}:4001` }
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
      GlobalConfigCollection,
    ],
  },
});
