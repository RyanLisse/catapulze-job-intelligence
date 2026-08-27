import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...ultracite.ignorePatterns,
    "**/openwiki",
    ".claude/**",
    ".cursor/**",
    ".omc/**",
    ".github/**",
    "tools/oxlint/anti-slop/**",
  ],
});
