import { ConfigType } from "../../../src/Config/Config";
import {
  filterPackages,
  findRepositoryOrFail,
  resolvePackage,
  resolvePackages,
  resolvePackagePath,
  resolveDatabaseName,
  params,
} from "../../../src/util/datatruck/config-util";

describe("filterPackages", () => {
  const config: ConfigType = {
    packages: [
      {
        name: "a",
        repositoryNames: ["main1"],
      },
      {
        name: "b",
        repositoryNames: ["main2"],
      },
    ],
    repositories: [
      {
        name: "main1",
        config: {
          outPath: "/tmp",
        },
        type: "local",
      },
      {
        name: "main2",
        config: {
          password: { path: "/secret" },
          repository: {
            backend: "local",
            path: "/tmp",
          },
        },
        type: "restic",
      },
    ],
  };
  it("returns all", () => {
    expect(filterPackages(config, {})).toMatchObject([
      {
        name: "a",
      },
      {
        name: "b",
      },
    ]);
  });

  it("ignores package by name", () => {
    expect(
      filterPackages(config, {
        packageNames: ["a"],
      })
    ).toMatchObject([
      {
        name: "a",
      },
    ]);
  });

  it("returns all by name", () => {
    expect(
      filterPackages(config, {
        packageNames: ["*"],
      })
    ).toMatchObject([
      {
        name: "a",
      },
      {
        name: "b",
      },
    ]);
  });

  it("returns one by repository name", () => {
    expect(
      filterPackages(config, {
        repositoryNames: ["main1"],
      })
    ).toMatchObject([
      {
        name: "a",
      },
    ]);
  });

  it("returns one by repository type", () => {
    expect(
      filterPackages(config, {
        repositoryTypes: ["restic"],
      })
    ).toMatchObject([
      {
        name: "b",
      },
    ]);
  });

  it("returns enabled", () => {
    let config2: ConfigType = {
      ...config,
      packages: [
        {
          ...config.packages[0],
          enabled: false,
        },
        config.packages[1],
      ],
    };
    expect(filterPackages(config2, {})).toMatchObject([
      {
        name: "b",
      },
    ]);
  });
});

describe("findRepositoryOrFail", () => {
  const config: ConfigType = {
    packages: [],
    repositories: [
      {
        name: "a",
        config: {
          outPath: "/tmp",
        },
        type: "local",
      },
    ],
  };

  it("throws error", () => {
    expect(() => findRepositoryOrFail(config, "b")).toThrowError();
  });

  it("returns repository config", () => {
    expect(findRepositoryOrFail(config, "a")).toMatchObject(
      config.repositories[0]
    );
  });
});

describe("resolvePackage", () => {
  it("returns same object", () => {
    expect(
      resolvePackage(
        {
          name: "a",
        },
        {
          action: "backup",
          snapshotId: "1",
          snapshotDate: "2022-01-01 00:00:00",
        }
      )
    ).toMatchObject({
      name: "a",
    });
  });

  it("resolves paths variables", () => {
    expect(
      resolvePackage(
        {
          name: "a",
          path: `${params.pkgPath.action}-${params.pkgPath.packageName}-${params.pkgPath.snapshotId}`,
          restorePath: `target-${params.pkgRestorePath.action}-${params.pkgRestorePath.packageName}-${params.pkgRestorePath.snapshotId}`,
        },
        {
          action: "backup",
          snapshotId: "1",
          snapshotDate: "2022-01-01 00:00:00",
        }
      )
    ).toMatchObject({
      name: "a",
      path: "backup-a-1",
      restorePath: "target-backup-a-1",
    });
  });

  it("resolves restorePath using path reference", () => {
    expect(
      resolvePackage(
        {
          name: "a",
          path: `${params.pkgPath.action}-${params.pkgPath.packageName}-${params.pkgPath.snapshotId}`,
          restorePath: `${params.pkgRestorePath.path}-restore`,
        },
        {
          action: "backup",
          snapshotId: "1",
          snapshotDate: "2022-01-01 00:00:00",
        }
      )
    ).toMatchObject({
      name: "a",
      path: "backup-a-1",
      restorePath: "backup-a-1-restore",
    });
  });
});

describe("resolvePackages", () => {
  it("returns same object", () => {
    expect(
      resolvePackages(
        [
          {
            name: "a",
          },
        ],
        {
          action: "backup",
          snapshotId: "1",
          snapshotDate: "2022-01-01 00:00:00",
        }
      )
    ).toMatchObject([
      {
        name: "a",
      },
    ]);
  });

  it("resolves paths variables", () => {
    expect(
      resolvePackages(
        [
          {
            name: "a",
            path: `${params.pkgPath.action}-${params.pkgPath.packageName}-${params.pkgPath.snapshotId}`,
            restorePath: `target-${params.pkgRestorePath.action}-${params.pkgRestorePath.packageName}-${params.pkgRestorePath.snapshotId}`,
          },
        ],
        {
          action: "backup",
          snapshotId: "1",
          snapshotDate: "2022-01-01 00:00:00",
        }
      )
    ).toMatchObject([
      {
        name: "a",
        path: "backup-a-1",
        restorePath: "target-backup-a-1",
      },
    ]);
  });
});

describe("resolvePackagePath", () => {
  it("returns static value", () => {
    expect(
      resolvePackagePath(
        `${params.pkgRestorePath.action}-${params.pkgRestorePath.packageName}-${params.pkgRestorePath.snapshotId}-${params.pkgRestorePath.path}`,
        {
          action: "backup",
          packageName: "a",
          snapshotId: "1",
          path: "path",
          snapshotDate: "2022-01-01 00:00:00",
        }
      )
    ).toMatch("backup-a-1-path");
  });

  it("returns dynamic value", () => {
    const value1 = resolvePackagePath(`${params.pkgPath.temp}`, {
      action: "backup",
      packageName: "a",
      snapshotId: "1",
      snapshotDate: "2022-01-01 00:00:00",
      path: undefined,
    });
    const value2 = resolvePackagePath(`${params.pkgPath.temp}`, {
      action: "backup",
      packageName: "a",
      snapshotId: "1",
      snapshotDate: "2022-01-01 00:00:00",
      path: undefined,
    });
    expect(value1 === value2).toBeFalsy();
  });

  it("throws error", () => {
    expect(() =>
      resolvePackagePath(`${params.pkgRestorePath.path}`, {
        action: "backup",
        packageName: "a",
        snapshotId: "1",
        snapshotDate: "2022-01-01 00:00:00",
        path: undefined,
      })
    ).toThrowError();
  });
});

describe("resolveDatabaseName", () => {
  it("returns static value", () => {
    expect(
      resolveDatabaseName(
        `${params.dbName.action}-${params.dbName.packageName}-${params.dbName.snapshotId}-${params.dbName.database}`,
        {
          action: "backup",
          packageName: "a",
          snapshotId: "1",
          snapshotDate: "2022-01-01 00:00:00",
          database: "db",
        }
      )
    ).toMatch("backup-a-1-db");
  });

  it("throws error", () => {
    expect(() =>
      resolveDatabaseName("{path}", {
        action: "backup",
        packageName: "a",
        snapshotId: "1",
        snapshotDate: "2022-01-01 00:00:00",
        database: "a",
      })
    ).toThrowError();
  });
});
