import { FileChanges, TestRepositoryType } from "./util";

export const fileChanges: (type: TestRepositoryType) => FileChanges[] = (
  type,
) =>
  [
    {
      file1: "contents",
      // https://github.com/restic/restic/issues/3760
      ...(type === "restic" && {
        empty: "",
      }),
    },
    {},
    { file1: "contents2" },
    { file1: false },
    {
      folder1: {
        ...(type === "git" && {
          empty: "",
        }),
      },
    },
    {
      folder1: {
        "file1.json": JSON.stringify({ hello: "world" }),
        folder2: {
          folder3: {
            folder4: {
              folder5: {
                folder6: {
                  ".file": "*",
                },
              },
            },
          },
        },
      },
    },
    {
      folder1: {
        folder2: {
          folder3: {
            ...Array.from({ length: 20 })
              .fill(0)
              .map((v, i) => `file_${i}`)
              .reduce(
                (result, name) => {
                  result[name] = `filename: ${name}`;
                  return result;
                },
                {} as Record<string, string>,
              ),
          },
        },
      },
    },
    {
      folder1: {
        "file.bin": Buffer.from([1, 2, 3, 4]),
      },
    },
  ] as FileChanges[];
