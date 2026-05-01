import { buildAppShellModel } from "../../../packages/auth/src/shared/index.ts";

export function getWebsiteShellModel() {
  return buildAppShellModel("website");
}

export const websiteHighlights = [
  {
    title: "Dashboard-first operations",
    description: "Internal teams manage work, finance, and documents from one protected system."
  },
  {
    title: "Portal-safe sharing",
    description: "Customers and partners receive scoped access without crossing internal boundaries."
  },
  {
    title: "Headless-ready surface",
    description: "WordPress content, intake funnels, and signed links can sit on top of this shell."
  }
] as const;
