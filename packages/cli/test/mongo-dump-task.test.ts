import { createCommands } from "../src/utils/datatruck/command";
import { parseStringList } from "../src/utils/string";
import { makeConfig, makeRepositoryConfig, testRepositoryTypes } from "./util";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { describe, expect, it } from "vitest";

const repositoryTypes = parseStringList(
  process.env.DTT_REPO,
  testRepositoryTypes,
  true,
);

const dataFormats = parseStringList(
  process.env.DTT_DATA_FORMAT,
  ["defaults" as const],
  process.env.CI ? ["defaults"] : true,
);

describe(
  "mongo-dump-task",
  {
    timeout: 300_000,
  },
  () => {
    it.each(
      repositoryTypes.flatMap((repositoryType) =>
        dataFormats.map((dataFormat) => ({
          repositoryType,
          dataFormat,
        })),
      ),
    )("backup and restore $repositoryType", async ({ repositoryType }) => {
      const verbose = 1;
      const dbName = `tmp_dtt_db`;
      const mongoServer = await MongoMemoryServer.create({
        auth: {
          enable: true,
          extraUsers: [
            {
              createUser: "test",
              pwd: "test",
              roles: [{ role: "root", db: "admin" }],
            },
          ],
        },
      });
      const port = Number(new URL(mongoServer.getUri()).port);
      try {
        const client = new MongoClient(`mongodb://test:test@127.0.0.1:${port}`);

        const db = client.db(dbName);
        const sourceData: Record<string, Record<string, any>[]> = {
          col1: [
            { _id: 1, value: null },
            { _id: 2, value: "a" },
            { _id: 3, value: '"with\' quotes"' },
            { _id: 4, value: '"with\nline\r\nsalts"' },
            { _id: 5, value: '"\ttext' },
            { _id: 6, value: null },
            { _id: 7, value: "a\nb" },
            { _id: 8, value: "»finish" },
          ],
          col2: [{ _id: 3, value: "b" }],
        };

        for (const collection of Object.keys(sourceData)) {
          for (const row of sourceData[collection]) {
            db.collection(collection).insertOne(row);
          }
        }

        const config = await makeConfig({
          repositories: [await makeRepositoryConfig(repositoryType)],
          packages: [
            {
              name: "main/mongo-dump",
              repositoryNames: [repositoryType],
              task: {
                name: "mongo-dump",
                config: {
                  uri: {
                    database: dbName,
                    host: "127.0.0.1",
                    port,
                    username: "test",
                    password: "test",
                  },
                  targetDatabase: {
                    name: `${dbName}_{snapshotId}`,
                  },
                },
              },
            },
          ],
        });

        const dtt = createCommands({ config, verbose });
        await dtt.init({});
        await dtt.backup({});
        const snapshots = await dtt.snapshots({});
        expect(snapshots).toHaveLength(1);
        const [snapshot] = snapshots;

        await dtt.restore({ id: snapshot.id });

        const restoredDbName = `${dbName}_${snapshot.id}`;
        const collections = (await client.db(restoredDbName).collections())
          .map((col) => col.collectionName)
          .sort();

        expect(collections.join()).toBe(Object.keys(sourceData).sort().join());

        for (const collection in sourceData) {
          const rows = await client
            .db(restoredDbName)
            .collection(collection)
            .aggregate([{ $sort: { _id: 1 } }])
            .toArray();

          expect(JSON.stringify(rows)).toBe(
            JSON.stringify(sourceData[collection]),
          );
        }
      } finally {
        await mongoServer.stop();
      }
    });
  },
);
