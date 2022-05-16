const { writeFileSync } = require("fs");
const { schema } = require("./../lib/JsonSchema/JsonSchema");

const paths = [
  `${__dirname}/../lib/config.schema.json`,
  `${__dirname}/../../datatruck/lib/config.schema.json`,
];
for (const path of paths) writeFileSync(path, JSON.stringify(schema, null, 2));
