import { readFileSync } from "node:fs";
import path from "node:path";

export interface EffectBaselineToolchainPins {
  bunHost: string;
  bunPackageManager: string;
  compatibilityNotes: string[];
  effectDirect: string | null;
  effectTransitive: string | null;
  typescript: string;
  typesBun: string;
}

interface PackageJsonPins {
  dependencies?: { effect?: string };
  devDependencies?: { effect?: string };
  packageManager?: string;
  workspaces?: { catalog?: { typescript?: string } };
}

const ROOT = path.resolve(import.meta.dir, "../..");

const readPackageJson = (): PackageJsonPins => {
  const raw: unknown = JSON.parse(
    readFileSync(path.join(ROOT, "package.json"), "utf-8")
  );
  // SAFETY: root package.json is repo-controlled; we only read optional pin fields.
  return raw as PackageJsonPins;
};

const packageManagerPin = (): string =>
  readPackageJson().packageManager ?? "unknown";

const catalogTypescript = (): string =>
  readPackageJson().workspaces?.catalog?.typescript ?? "unknown";

const lockPackageVersion = (packageName: string): string | null => {
  const lock = readFileSync(path.join(ROOT, "bun.lock"), "utf-8");
  const escaped = packageName.replaceAll("/", "\\/");
  // bun.lock packages map: "name": ["name@version", ...]
  const pattern = new RegExp(
    `"${escaped}":\\s*\\[\\s*"${escaped}@([^"]+)"`,
    "u"
  );
  return pattern.exec(lock)?.[1] ?? null;
};

const directEffectDeclared = (): string | null => {
  const pkg = readPackageJson();
  return pkg.dependencies?.effect ?? pkg.devDependencies?.effect ?? null;
};

const hostBunVersion = (override?: string): string => {
  if (override !== undefined) {
    return override;
  }
  if (globalThis.Bun === undefined) {
    return "unknown";
  }
  return globalThis.Bun.version;
};

/** Reads peildatum pins from package.json + bun.lock + host Bun. No network. */
export const readToolchainPins = (
  bunHostVersion?: string
): EffectBaselineToolchainPins => ({
  bunHost: hostBunVersion(bunHostVersion),
  bunPackageManager: packageManagerPin(),
  compatibilityNotes: [
    "Effect is not a first-party dependency on peildatum main; transitive via @prisma/config only.",
    "Official Effect v4 RC: bun add effect@rc (https://effect.website/blog/effect-v4-rc-august-recap).",
    "Do not reuse unrelated historical timings as this baseline (ADR-0001/ADR-0013).",
  ],
  effectDirect: directEffectDeclared(),
  effectTransitive: lockPackageVersion("effect"),
  typesBun: lockPackageVersion("@types/bun") ?? "unknown",
  typescript: lockPackageVersion("typescript") ?? catalogTypescript(),
});
