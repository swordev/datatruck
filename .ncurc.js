/** @type {import("npm-check-updates").RunOptions} */
module.exports = {
  workspaces: true,
  root: true,
  dep: "dev,optional,prod,bundle",
  target: (name) => {
    if (
      [
        "@types/node",
        // require ESM
        "chalk",
      ].includes(name)
    ) {
      return "minor";
    } else {
      return "latest";
    }
  },
};
