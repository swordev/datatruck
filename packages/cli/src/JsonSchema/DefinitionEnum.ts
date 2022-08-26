export enum DefinitionEnum {
  config = "config",
  repository = "repository",
  package = "package",
  packageRepository = "package-repository",
  task = "task",
  resticRepository = "restic-repository",
  resticPackageRepository = "restic-package-repository",
  datatruckRepository = "datatruck-repository",
  datatruckPackageRepository = "datatruck-package-repository",
  gitRepository = "git-repository",
  gitPackageRepository = "git-package-repository",
  gitTask = "git-task",
  scriptTask = "script-task",
  mariadbTask = "mariadb-task",
  mssqlTask = "mssql-task",
  mysqlDumpTask = "mysql-dump-task",
  postgresqlDumpTask = "postgresql-dump-task",
  sqlDumpTask = "sqldump-task",
  stringListUtil = "stringlist-util",
  prunePolicy = "prune-policy",
  pathsObject = "paths-object",
}

export function makeRef(type: DefinitionEnum, subType?: string) {
  return {
    $ref: `#/definitions/${type}` + (subType ? `_${subType}` : ""),
  };
}
