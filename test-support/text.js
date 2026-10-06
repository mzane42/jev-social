export function stripMarkup(value, separator = "") {
  const source = String(value ?? "");
  let output = "";
  let insideTag = false;
  for (const character of source) {
    if (!insideTag && character === "<") {
      insideTag = true;
      output += separator;
      continue;
    }
    if (insideTag) {
      if (character === ">") insideTag = false;
      continue;
    }
    output += character;
  }
  return output;
}

export function markdownLinkTargets(value) {
  const source = String(value ?? "");
  const targets = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("](", cursor);
    if (start < 0) break;
    const end = source.indexOf(")", start + 2);
    if (end < 0) break;
    targets.push(source.slice(start + 2, end));
    cursor = end + 1;
  }
  return targets;
}
