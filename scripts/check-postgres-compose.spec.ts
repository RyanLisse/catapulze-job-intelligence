import { describe, expect, it } from "bun:test";

import { validatePostgresCompose } from "./check-postgres-compose";

describe("validatePostgresCompose", () => {
  it("accepts localhost-bound postgres with protected external volume and DB-first limits", () => {
    const violations = validatePostgresCompose({
      services: {
        postgres: {
          ports: [{ target: 5432, published: 5432, host_ip: "127.0.0.1" }],
          mem_limit: "4g",
        },
        manticore: {
          mem_limit: "1g",
        },
      },
      volumes: {
        postgres_data: {
          external: true,
          name: "${POSTGRES_DATA_VOLUME:-catapulze-postgres-p0}",
        },
      },
    });

    expect(violations).toEqual([]);
  });

  it("rejects public postgres port bindings", () => {
    const violations = validatePostgresCompose({
      services: {
        postgres: {
          ports: [{ target: 5432, published: 5432, host_ip: "0.0.0.0" }],
          mem_limit: "4g",
        },
        manticore: {
          mem_limit: "1g",
        },
      },
      volumes: {
        postgres_data: { external: true, name: "catapulze-postgres-p0" },
      },
    });

    expect(violations).toContainEqual(
      "postgres port 5432 must bind to host_ip 127.0.0.1, found '0.0.0.0'"
    );
  });

  it("rejects inline postgres volumes and Manticore parity or higher memory", () => {
    const violations = validatePostgresCompose({
      services: {
        postgres: {
          ports: [{ target: 5432, published: 5432, host_ip: "127.0.0.1" }],
          mem_limit: "1g",
        },
        manticore: {
          mem_limit: "1g",
        },
      },
      volumes: {
        postgres_data: {},
      },
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        "volumes.postgres_data must be external: true so compose lifecycle cannot destroy production data",
        "postgres mem_limit (1024m) must exceed manticore mem_limit (1024m)",
      ])
    );
  });
});
