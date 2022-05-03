export enum DefinitionEnum {
  config = "config",
  repository = "repository",
  package = "package",
  packageRepository = "package-repository",
  task = "task",
  resticRepository = "restic-repository",
  resticPackageRepository = "restic-package-repository",
  localRepository = "local-repository",
  localPackageRepository = "local-package-repository",
  gitRepository = "git-repository",
  gitPackageRepository = "git-package-repository",
  gitTask = "git-task",
  mariadbTask = "mariadb-task",
  mssqlTask = "mssql-task",
  mysqlDumpTask = "mysql-dump-task",
  postgresqlDumpTask = "postgresql-dump-task",
  sqlDumpTask = "sqldump-task",
  stringListUtil = "stringlist-util",
  prunePolicy = "prune-policy",
  pathsObject = "paths-object",
}

export function makeRef(type: DefinitionEnum) {
  return {
    $ref: `#/definitions/${type}`,
  };
}
