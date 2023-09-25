import { RepositoryConfigTypeType } from "../src/Config/RepositoryConfig";
import { makeParseLog, CommandEnum, exec } from "../src/Factory/CommandFactory";
import { parentTmpDir } from "../src/utils/fs";
import { createMysqlCli } from "../src/utils/mysql";
import { makeConfig, makeRepositoryConfig } from "./util";
import { rm } from "fs/promises";
import { describe, expect, it, afterAll } from "vitest";

const autoclean = true;
const repositoryTypes = (
  process.env.DTT_REPO ? process.env.DTT_REPO.split(",") : ["datatruck"]
) as RepositoryConfigTypeType[];
const dataFormats = (
  process.env.DTT_DATA_FORMAT
    ? process.env.DTT_DATA_FORMAT.split(",")
    : ["sql", "csv"]
) as ("sql" | "csv")[];

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
      const sql = createMysqlCli({
        verbose: !!verbose,
        hostname: "127.0.0.1",
        username: "root",
        password: "root",
        port: 3307,
      });

      try {
        await sql.run(`DROP DATABASE IF EXISTS ${dbName}`);
        const sourceData: Record<string, any[][]> = {
          table1: [
            [1, null],
            [2, "a"],
          ],
          table2: [[3, "b"]],
          emptytable: [],
        };

        await sql.createDatabase({ name: dbName });
        const quote = (v: string | null) => JSON.stringify(v);
        for (const table of Object.keys(sourceData)) {
          await sql.run(
            `
        CREATE TABLE ${table} (
          id INT(11) NOT NULL AUTO_INCREMENT,
          value VARCHAR(50) NULL COLLATE 'utf8_general_ci',
          PRIMARY KEY (id) USING BTREE
        )
        COLLATE='utf8_general_ci'
        ENGINE=InnoDB
      `,
            dbName,
          );
          for (const row of sourceData[table]) {
            await sql.run(
              `INSERT INTO ${table} VALUES (${row.map(quote)})`,
              dbName,
            );
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

        for (const table in sourceData) {
          const rows = await sql.fetchAll(
            `SELECT * FROM ${table}`,
            restoredDbName,
          );
          expect(rows.length).toBe(sourceData[table].length);
        }
      } finally {
        if (autoclean) {
          await sql.run(`DROP DATABASE IF EXISTS ${dbName}`);
          await sql.run(`DROP DATABASE IF EXISTS ${restoredDbName}`);
        }
      }
    },
  );
});
