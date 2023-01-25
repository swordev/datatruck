// @ts-check
const ncu = require("npm-check-updates");
/** @type {ncu.RunOptions} */
const options = {
  root: true,
  workspaces: true,
  target: (dep) => {
    if (dep === "chalk" || dep === "commander" || dep === "pretty-bytes")
      return "patch";
    return "latest";
  },
};
module.exports = options;
