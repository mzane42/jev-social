const PLATFORM = "(?:instagram|tiktok|linkedin)";
const ENGLISH_ACTION = "(?:search|find|look\\s+up|research)";
const ENGLISH_POLITE = "(?:(?:could|can|would)\\s+you\\s+)?(?:please\\s+)?";
const TRAILING_ENGLISH_INSTRUCTION =
  "(?:\\s+please)?(?:\\s*[,;:.!?]?\\s*(?:(?:and|then)\\s+)?(?:return|show|give|list|get|open|read|download|compare|analyze)\\b.*)?";
const CHINESE_ACTION = "(?:搜索一下|搜一下|搜索|搜|查找|检索|调研)";
const CHINESE_POLITE = "(?:请)?(?:帮我)?";
const TRAILING_CHINESE_INSTRUCTION =
  "(?:\\s*(?:[，,；;。]\\s*)?(?:(?:然后|并且|并请|并)\\s*)?(?:返回|找出|给我|展示|列出|打开|阅读|下载|比较).*)?";

const PATTERNS = [
  new RegExp(
    `^\\s*${ENGLISH_POLITE}${ENGLISH_ACTION}\\s+(?:me\\s+)?(?:for\\s+)?(.+?)\\s+(?:on|in|from)\\s+${PLATFORM}${TRAILING_ENGLISH_INSTRUCTION}\\s*[.!?]*\\s*$`,
    "i",
  ),
  new RegExp(
    `^\\s*${ENGLISH_POLITE}${ENGLISH_ACTION}\\s+(?:on\\s+)?${PLATFORM}\\s+(?:for\\s+)?(.+?)${TRAILING_ENGLISH_INSTRUCTION}\\s*[.!?]*\\s*$`,
    "i",
  ),
  new RegExp(
    `^\\s*${CHINESE_POLITE}\\s*在\\s*${PLATFORM}\\s*(?:上|里|中)?\\s*${CHINESE_POLITE}\\s*${CHINESE_ACTION}\\s*(.+?)${TRAILING_CHINESE_INSTRUCTION}\\s*$`,
    "i",
  ),
  new RegExp(
    `^\\s*${CHINESE_POLITE}\\s*${CHINESE_ACTION}\\s*${PLATFORM}\\s*(?:上(?:的)?|里(?:的)?|中(?:的)?)?\\s*(.+?)${TRAILING_CHINESE_INSTRUCTION}\\s*$`,
    "i",
  ),
];

/**
 * Convert a natural-language research request into the literal query expected by
 * `socai <platform> search <query>`. Jev still receives the complete request so
 * it can choose the platform and each subsequent operation.
 */
export function extractSearchQuery(request) {
  const normalized = String(request || "").trim();
  for (const pattern of PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[1]) return cleanTopic(match[1]) || normalized;
  }
  return normalized;
}

function cleanTopic(value) {
  return trimQuoteEdges(value.trim())
    .replace(/\s+please$/i, "")
    .replace(/[。.!?？]+$/g, "")
    .trim();
}

function trimQuoteEdges(value) {
  let start = 0;
  let end = value.length;
  while (start < end && "\"'“‘".includes(value[start])) start += 1;
  while (end > start && "\"'”’".includes(value[end - 1])) end -= 1;
  return value.slice(start, end);
}
