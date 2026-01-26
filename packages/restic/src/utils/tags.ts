const prefix = "dt";
const prefixSep = "-";
const valueSep = ":";
const fullPrefix = `${prefix}${prefixSep}`;

export function stringifyTags(inTags: Record<string, any>) {
  const tags: string[] = [];
  for (const [key, value] of Object.entries(inTags)) {
    const tagName = key === prefix ? key : `${prefix}${prefixSep}${key}`;
    tags.push(value === true ? tagName : `${tagName}${valueSep}${value}`);
  }
  return tags;
}

export function parseTagPrefix(tag: string) {
  if (tag === prefix) {
    return tag;
  } else if (tag.startsWith(fullPrefix)) {
    return tag.slice(fullPrefix.length);
  }
}

export function parseTags(inTags: string[]): Record<string, any> {
  const tags: Record<string, any> = {};
  for (const tag of inTags) {
    const str = parseTagPrefix(tag);
    if (!str) {
      continue;
    } else if (str.includes(valueSep)) {
      const [tagName, tagValue] = str.split(valueSep);
      tags[tagName] = tagValue ?? "";
    } else {
      tags[str] = true;
    }
  }
  return tags;
}
