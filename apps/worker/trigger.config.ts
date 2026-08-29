import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  dirs: ["./src/tasks"],
  maxDuration: 900,
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_slice_a_local",
  runtime: "bun",
});
