import { createCapabilityRegistry } from "./registry";

export const productionCapabilityCatalog = [] as const;

export const productionCapabilityRegistry = createCapabilityRegistry(
  productionCapabilityCatalog
);
