import { RepositoryConfigTypeType } from "../src/Config/RepositoryConfig";
import { makeParseLog, CommandEnum, exec } from "../src/Factory/CommandFactory";
import { createMysqlCli } from "../src/utils/mysql";
import { parseStringList } from "../src/utils/string";
import { makeConfig, makeRepositoryConfig } from "./util";
import { describe, expect, it } from "vitest";

const autoclean = true;

const repositoryTypes = parseStringList<RepositoryConfigTypeType>(
  process.env.DTT_REPO,
  ["datatruck", "git", "restic"],
  true,
);

const dataFormats = parseStringList(
  process.env.DTT_DATA_FORMAT,
  ["sql" as const, "csv" as const],
  true,
);

describe("mysql-dump-task", () => {
  it.each(
    repositoryTypes.flatMap((repositoryType) =>
      dataFormats.map((dataFormat) => ({
        repositoryType,
        dataFormat,
      })),
    ),
  )(
    "backup and restore $repositoryType with $dataFormat format",
    async ({ repositoryType, dataFormat }) => {
      const verbose = 1;
      const dbName = `tmp_dtt_db`;
      let restoredDbName: string | undefined;
      const sql = await createMysqlCli({
        verbose: !!verbose,
        hostname: "127.0.0.1",
        username: "root",
        password: "root",
        port: 3307,
      });
      try {
        await sql.execute(`DROP DATABASE IF EXISTS ${dbName}`);
        const sourceData: Record<string, Record<string, any>[]> = {
          table1: [
            { id: 1, value: null },
            { id: 2, value: "a" },
            { id: 3, value: '"with\' quotes"' },
            { id: 4, value: '"with\nline\r\nsalts"' },
            { id: 5, value: '"\ttext' },
            { id: 6, value: null },
            { id: 7, value: "a\nb" },
            { id: 8, value: "»finish" },
          ],
          table2: [{ id: 3, value: "b" }],
          emptytable: [],
        };

        await sql.createDatabase({ name: dbName });
        await sql.changeDatabase(dbName);
        for (const table of Object.keys(sourceData)) {
          await sql.execute(
            `
              CREATE TABLE ${table} (
                id INT(11) NOT NULL AUTO_INCREMENT,
                value VARCHAR(50) NULL COLLATE 'utf8_general_ci',
                PRIMARY KEY (id) USING BTREE
              )
              COLLATE='utf8_general_ci'
              ENGINE=InnoDB
            `,
          );
          for (const row of sourceData[table]) {
            await sql.insert(table, row);
          }
        }

        const config = await makeConfig({
          repositories: [await makeRepositoryConfig(repositoryType)],
          packages: [
            {
              name: "main/sql-dump",
              repositoryNames: [repositoryType],
              task: {
                name: "mysql-dump",
                config: {
                  dataFormat,
                  database: dbName,
                  hostname: sql.options.hostname,
                  username: sql.options.username,
                  password: sql.options.password,
                  port: sql.options.port,
                  targetDatabase: {
                    name: `${dbName}_{snapshotId}`,
                  },
                },
              },
            },
          ],
        });

        expect(await exec(CommandEnum.init, { config, verbose }, {})).toBe(0);
        expect(await exec(CommandEnum.backup, { config, verbose }, {})).toBe(0);

        const parseLog = makeParseLog(CommandEnum.snapshots);

        expect(
          await exec(
            CommandEnum.snapshots,
            { config, verbose, outputFormat: "json" },
            {},
          ),
        ).toBe(0);

        const snapshotsJson = parseLog();
        expect(snapshotsJson.length).toBe(1);
        const [snapshot] = snapshotsJson;
        restoredDbName = `${dbName}_${snapshot.id}`;
        expect(
          await exec(
            CommandEnum.restore,
            { config, verbose, outputFormat: "json" },
            { id: snapshot.id },
          ),
        ).toBe(0);

        const tableNames = (await sql.fetchTableNames(restoredDbName)).sort();
        expect(tableNames.join()).toBe(Object.keys(sourceData).sort().join());
        const restoreSql = await createMysqlCli({
          ...sql.options,
          database: restoredDbName,
        });
        for (const table in sourceData) {
          const rows = await restoreSql.fetchAll(`SELECT * FROM ${table}`);
          expect(JSON.stringify(rows)).toBe(JSON.stringify(sourceData[table]));
        }
      } finally {
        if (autoclean) {
          await sql.execute(`DROP DATABASE IF EXISTS ${dbName}`);
          await sql.execute(`DROP DATABASE IF EXISTS ${restoredDbName}`);
        }
      }
    },
  );
});
