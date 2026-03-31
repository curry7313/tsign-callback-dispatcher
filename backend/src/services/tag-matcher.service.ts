import { TSignCallbackMessage, ALL_KNOWN_MSG_TYPES } from '../types/callback.types';
import { TagMatchRule, TagValue, UnknownMsgTypePolicy, BuiltInTagMissPolicy } from '../types/config.types';
import { getTagsConfig } from './config.service';
import logger from './logger.service';

// ── Constants ──
const REGEX_MAX_LENGTH = 200;
const REGEX_CACHE_MAX_SIZE = 500;
const REDOS_PATTERN = /(\.\*){3,}|(\+\+)|(\*\*)|(\?\?)|((\\.|\[.*?\])\{[^}]*,[^}]*\}){2,}/;

// Regex cache to avoid recompiling on every match
const regexCache = new Map<string, RegExp>();

function isSafeRegex(pattern: string): boolean {
  if (pattern.length > REGEX_MAX_LENGTH) return false;
  if (REDOS_PATTERN.test(pattern)) return false;
  return true;
}

function getCachedRegex(pattern: string): RegExp | null {
  let re = regexCache.get(pattern);
  if (!re) {
    if (!isSafeRegex(pattern)) {
      logger.warn(`Rejected potentially unsafe regex pattern: ${pattern.substring(0, 50)}...`);
      return null;
    }
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      logger.warn(`Invalid regex pattern: ${pattern.substring(0, 50)}`);
      return null;
    }
    regexCache.set(pattern, re);
    if (regexCache.size > REGEX_CACHE_MAX_SIZE) {
      const firstKey = regexCache.keys().next().value;
      if (firstKey !== undefined) regexCache.delete(firstKey);
    }
  }
  return re;
}

function getNestedValue(obj: Record<string, unknown>, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function matchRule(value: unknown, rule: TagMatchRule): boolean {
  if (value === undefined || value === null) {
    return rule.operator === 'exists' ? false : false;
  }

  const strValue = String(value);

  switch (rule.operator) {
    case 'exact':
      return strValue === String(rule.value);

    case 'contains':
      return strValue.includes(String(rule.value));

    case 'regex': {
      const regex = getCachedRegex(String(rule.value));
      if (!regex) return false;
      return regex.test(strValue);
    }

    case 'in': {
      const values = Array.isArray(rule.value) ? rule.value : [rule.value];
      return values.includes(strValue);
    }

    case 'exists':
      return true;

    default:
      return false;
  }
}

export function matchTags(message: TSignCallbackMessage, rules: TagMatchRule[]): string[] {
  const matchedTags = new Set<string>();

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const value = getNestedValue(message as unknown as Record<string, unknown>, rule.field);
    const isMatch = matchRule(value, rule);

    if (isMatch) {
      rule.tags.forEach((tag) => matchedTags.add(tag));
      logger.debug(`Rule "${rule.name}" matched: field=${rule.field}, value=${value}`);
    }
  }

  return Array.from(matchedTags);
}

interface DispatchFilterConfig {
  tags: TagValue[];
  matchRules: TagMatchRule[];
  msgTypes?: string[];
  unknownMsgTypePolicy?: UnknownMsgTypePolicy;
  builtInTagMissPolicy?: BuiltInTagMissPolicy;
}

/**
 * Check if message passes the msgType filter.
 * Returns true if message should continue, false if it should be discarded.
 */
function passesMsgTypeFilter(message: TSignCallbackMessage, config: DispatchFilterConfig): boolean {
  if (!config.msgTypes || config.msgTypes.length === 0) return true;

  const isKnownType = ALL_KNOWN_MSG_TYPES.has(message.MsgType);
  if (!isKnownType) {
    const policy = config.unknownMsgTypePolicy || 'dispatch';
    if (policy === 'discard') {
      logger.debug(`Unknown MsgType "${message.MsgType}" discarded by policy for config`);
      return false;
    }
    logger.debug(`Unknown MsgType "${message.MsgType}" dispatched by policy`);
    return true;
  }

  return config.msgTypes.includes(message.MsgType);
}

/**
 * Resolve the field path for a tag.
 * For built-in tags, use tagDef.fieldPath.
 * For non-built-in tags whose key contains '.', the key itself is the field path.
 */
function resolveFieldPath(
  configTag: TagValue,
  tagDef: { builtIn?: boolean; fieldPath?: string } | undefined
): string | undefined {
  if (tagDef?.builtIn && tagDef.fieldPath) return tagDef.fieldPath;
  if (tagDef?.fieldPath) return tagDef.fieldPath;
  // key itself looks like a nested field path (e.g. "MsgData.FlowCallbackStatus")
  if (configTag.key.includes('.')) return configTag.key;
  return undefined;
}

/**
 * Check if all tags with a resolvable field path match the message.
 * Returns true if all such tags pass, false if any causes discard.
 *
 * This covers:
 * - Built-in tags (builtIn: true + fieldPath)
 * - Custom tags whose key is a nested field path (e.g. "MsgData.xxx")
 * - Custom tags with an explicit fieldPath
 */
function passesBuiltInTags(
  message: TSignCallbackMessage,
  configTags: TagValue[],
  tagDefMap: Map<string, { builtIn?: boolean; fieldPath?: string }>,
  builtInTagMissPolicy: BuiltInTagMissPolicy
): boolean {
  for (const configTag of configTags) {
    const tagDef = tagDefMap.get(configTag.key);
    const fieldPath = resolveFieldPath(configTag, tagDef);
    if (!fieldPath) continue;

    const msgValue = getNestedValue(message as unknown as Record<string, unknown>, fieldPath);
    const fieldMissing = msgValue === undefined || msgValue === null || String(msgValue).trim() === '';

    if (fieldMissing) {
      if (builtInTagMissPolicy === 'discard') {
        logger.debug(`Tag "${configTag.key}" field "${fieldPath}" missing or empty in message, discarded by policy`);
        return false;
      }
      logger.debug(`Tag "${configTag.key}" field "${fieldPath}" missing or empty in message, dispatched by policy`);
      continue;
    }

    if (configTag.value) {
      const strMsgValue = String(msgValue);
      const matchMode = configTag.matchMode || 'exact';
      const isMatch = matchMode === 'prefix'
        ? strMsgValue.startsWith(configTag.value)
        : strMsgValue === configTag.value;

      if (!isMatch) {
        logger.debug(
          `Tag "${configTag.key}" value mismatch (${matchMode}): expected="${configTag.value}", got="${msgValue}"`
        );
        return false;
      }
    }

    logger.debug(`Tag "${configTag.key}" matched: value="${msgValue}"`);
  }
  return true;
}

/** shouldDispatch 的返回结果 */
export interface DispatchDecision {
  /** 是否应该分发 */
  dispatch: boolean;
  /** 不分发时的跳过原因（人类可读） */
  skipReason?: string;
}

export async function shouldDispatch(
  message: TSignCallbackMessage,
  config: DispatchFilterConfig
): Promise<DispatchDecision> {
  // Step 1: Message type filter
  if (!passesMsgTypeFilter(message, config)) {
    const isKnown = ALL_KNOWN_MSG_TYPES.has(message.MsgType);
    const reason = isKnown
      ? `消息类型 "${message.MsgType}" 不在该目标的允许类型列表中`
      : `未知消息类型 "${message.MsgType}"，策略为丢弃`;
    return { dispatch: false, skipReason: reason };
  }

  // Step 2: If no tags configured, dispatch all
  if (config.tags.length === 0 && config.matchRules.length === 0) return { dispatch: true };

  // Step 3: Built-in tag matching
  const tagsConfig = await getTagsConfig();
  const tagDefMap = new Map(tagsConfig.tags.map((t) => [t.key, t]));
  const missPolicy = config.builtInTagMissPolicy || 'dispatch';

  if (config.tags.length > 0) {
    if (!passesBuiltInTags(message, config.tags, tagDefMap, missPolicy)) {
      // 找出具体是哪个内置标签不匹配
      const mismatchDetails = getBuiltInMismatchDetail(message, config.tags, tagDefMap, missPolicy);
      return { dispatch: false, skipReason: mismatchDetails };
    }
  }

  // Step 4: Match tags from rules
  const messageTags = matchTags(message, config.matchRules);

  // If only built-in tags (no matchRules), all built-in passed → dispatch
  if (config.matchRules.length === 0) return { dispatch: true };

  // If no tags configured, any matched rule tag is sufficient
  if (config.tags.length === 0) {
    if (messageTags.length > 0) return { dispatch: true };
    return { dispatch: false, skipReason: '自定义规则均未匹配到消息中的字段值' };
  }

  // Step 5: Non-built-in tags must match via matchRules
  const nonBuiltInTagKeys = config.tags
    .filter((t) => !tagDefMap.get(t.key)?.builtIn)
    .map((t) => t.key);

  if (nonBuiltInTagKeys.length === 0) return { dispatch: true };

  const matched = nonBuiltInTagKeys.some((key) => messageTags.includes(key));
  if (matched) return { dispatch: true };

  return {
    dispatch: false,
    skipReason: `标签 [${nonBuiltInTagKeys.join(', ')}] 未匹配（消息提取到的标签: [${messageTags.join(', ') || '无'}]）`,
  };
}

/**
 * 生成标签不匹配的具体描述
 */
function getBuiltInMismatchDetail(
  message: TSignCallbackMessage,
  configTags: TagValue[],
  tagDefMap: Map<string, { builtIn?: boolean; fieldPath?: string }>,
  builtInTagMissPolicy: BuiltInTagMissPolicy
): string {
  for (const configTag of configTags) {
    const tagDef = tagDefMap.get(configTag.key);
    const fieldPath = resolveFieldPath(configTag, tagDef);
    if (!fieldPath) continue;

    const msgValue = getNestedValue(message as unknown as Record<string, unknown>, fieldPath);
    const fieldMissing = msgValue === undefined || msgValue === null || String(msgValue).trim() === '';

    if (fieldMissing && builtInTagMissPolicy === 'discard') {
      return `标签 "${configTag.key}" 对应字段 "${fieldPath}" 在消息中为空/缺失，策略为丢弃`;
    }

    if (!fieldMissing && configTag.value) {
      const strMsgValue = String(msgValue);
      const matchMode = configTag.matchMode || 'exact';
      const isMatch = matchMode === 'prefix'
        ? strMsgValue.startsWith(configTag.value)
        : strMsgValue === configTag.value;

      if (!isMatch) {
        return `标签 "${configTag.key}"（${matchMode === 'prefix' ? '前缀' : '精确'}匹配）不匹配：期望 "${configTag.value}"，实际 "${strMsgValue}"`;
      }
    }
  }
  return '标签不匹配';
}
