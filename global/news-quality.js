import {
  HIGH_PRIORITY,
  LOW_PRIORITY,
  MEDIUM_PRIORITY,
  PUBLIC_IMPACT,
} from "./config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const STOP_WORDS = new Set([
  "about", "after", "amid", "and", "are", "as", "at", "be", "been", "before", "but", "by",
  "for", "from", "has", "have", "how", "in", "into", "is", "it", "its", "new", "of", "on",
  "over", "says", "that", "the", "their", "this", "to", "under", "was", "were", "will", "with",
]);

function normalizedTitle(title) {
  return String(title || "")
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(title) {
  return normalizedTitle(title)
    .split(" ")
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
    .map((token) => {
      if (!/^[a-z]+$/i.test(token)) return token;
      if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
      if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
      if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
      if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
      return token;
    });
}

function characterBigrams(title) {
  const compact = normalizedTitle(title).replaceAll(" ", "");
  if (compact.length < 2) return new Set(compact ? [compact] : []);
  const grams = new Set();
  for (let index = 0; index < compact.length - 1; index += 1) {
    grams.add(compact.slice(index, index + 2));
  }
  return grams;
}

function intersectionSize(left, right) {
  let count = 0;
  left.forEach((value) => {
    if (right.has(value)) count += 1;
  });
  return count;
}

function textSimilarity(leftText, rightText) {
  const leftTokens = new Set(titleTokens(leftText));
  const rightTokens = new Set(titleTokens(rightText));
  const shared = intersectionSize(leftTokens, rightTokens);
  const union = new Set([...leftTokens, ...rightTokens]).size;
  if (!union || shared < 3) return 0;
  return Math.max(shared / union, shared / Math.min(leftTokens.size, rightTokens.size));
}

export function titleSimilarity(leftTitle, rightTitle) {
  const leftNormalized = normalizedTitle(leftTitle);
  const rightNormalized = normalizedTitle(rightTitle);
  if (!leftNormalized || !rightNormalized) return 0;
  if (leftNormalized === rightNormalized) return 1;

  const leftTokens = new Set(titleTokens(leftTitle));
  const rightTokens = new Set(titleTokens(rightTitle));
  const sharedTokens = intersectionSize(leftTokens, rightTokens);
  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  const tokenJaccard = unionSize ? sharedTokens / unionSize : 0;
  const tokenContainment = Math.min(leftTokens.size, rightTokens.size)
    ? sharedTokens / Math.min(leftTokens.size, rightTokens.size)
    : 0;

  const leftBigrams = characterBigrams(leftTitle);
  const rightBigrams = characterBigrams(rightTitle);
  const sharedBigrams = intersectionSize(leftBigrams, rightBigrams);
  const dice = leftBigrams.size + rightBigrams.size
    ? (2 * sharedBigrams) / (leftBigrams.size + rightBigrams.size)
    : 0;

  if (sharedTokens >= 3 && tokenContainment >= 0.72) return Math.max(tokenContainment, dice);
  if (sharedTokens >= 4 && tokenContainment >= 0.45) return Math.max(0.74, tokenContainment, dice);
  if (sharedTokens >= 4 && tokenJaccard >= 0.52) return Math.max(tokenJaccard, dice);
  return dice >= 0.82 ? dice : Math.max(tokenJaccard, dice * 0.8);
}

function isChineseArticle(article) {
  return /chinese|中文|mandarin/i.test(article.language || "") || /[\u3400-\u9fff]/u.test(article.title || "");
}

function representativeScore(article) {
  return (isChineseArticle(article) ? 6 : 0)
    + (article.image ? 2 : 0)
    + (article.country && article.country !== "来源地未知" ? 1 : 0)
    + ((article.publishedAt?.valueOf() || 0) / 1e15);
}

function dominantCategory(members) {
  const counts = members.reduce((result, member) => {
    result[member.category] = (result[member.category] || 0) + 1;
    return result;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || members[0].category;
}

function relatedSource(article) {
  return {
    title: article.title,
    summary: article.summary || "",
    url: article.url,
    source: article.source,
    country: article.country,
    language: article.language,
    publishedAt: article.publishedAt,
    apiRank: article.apiRank ?? null,
  };
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function categoryImpact(category) {
  return {
    disaster: 26,
    politics: 20,
    economy: 19,
    energy: 16,
    ai: 15,
    technology: 13,
    international: 10,
  }[category] || 8;
}

function sourceBreadthScore(count) {
  if (count >= 7) return 25;
  if (count === 6) return 24;
  if (count === 5) return 22;
  if (count === 4) return 19;
  if (count === 3) return 15;
  if (count === 2) return 10;
  return count === 1 ? 4 : 0;
}

function recencyScore(date, now) {
  const age = now - (date?.valueOf() || 0);
  if (!date || age < 0 || age > DAY_MS) return 0;
  if (age <= 60 * 60 * 1000) return 15;
  if (age <= 6 * 60 * 60 * 1000) return 13;
  if (age <= 12 * 60 * 60 * 1000) return 11;
  return 8;
}

const REGION_PATTERNS = [
  ["美国", /\b(united states|u\.?s\.?a?|america(?:n)?)\b|美国|美方/i],
  ["中国", /\b(china|chinese|beijing)\b|中国|中方|北京/i],
  ["俄罗斯", /\b(russia|russian|moscow|kremlin)\b|俄罗斯|俄方|莫斯科/i],
  ["乌克兰", /\b(ukraine|ukrainian|kyiv)\b|乌克兰|基辅/i],
  ["以色列与巴勒斯坦", /\b(israel|israeli|palestine|palestinian|gaza|hamas)\b|以色列|巴勒斯坦|加沙/i],
  ["伊朗", /\b(iran|iranian|tehran)\b|伊朗|德黑兰/i],
  ["欧洲", /\b(european union|europe|eu)\b|欧盟|欧洲/i],
  ["印度", /\b(india|indian|new delhi)\b|印度|新德里/i],
  ["日本", /\b(japan|japanese|tokyo)\b|日本|东京/i],
  ["朝鲜半岛", /\b(north korea|south korea|korean|pyongyang|seoul)\b|朝鲜|韩国|首尔|平壤/i],
  ["英国", /\b(united kingdom|britain|british|u\.?k\.?)\b|英国|英方/i],
  ["法国", /\b(france|french|paris)\b|法国|巴黎/i],
  ["德国", /\b(germany|german|berlin)\b|德国|柏林/i],
  ["印度尼西亚", /\b(indonesia|indonesian|jakarta)\b|印度尼西亚|印尼|雅加达/i],
  ["巴西", /\b(brazil|brazilian|brasilia)\b|巴西|巴西利亚/i],
  ["墨西哥", /\b(mexico|mexican)\b|墨西哥/i],
  ["加拿大", /\b(canada|canadian|ottawa)\b|加拿大|渥太华/i],
  ["中东", /\b(middle east|saudi arabia|syria|yemen|iraq|lebanon)\b|中东|沙特|叙利亚|也门|伊拉克|黎巴嫩/i],
  ["非洲", /\b(africa|african|sudan|ethiopia|nigeria|kenya|south africa)\b|非洲|苏丹|埃塞俄比亚|尼日利亚|肯尼亚|南非/i],
  ["拉丁美洲", /\b(latin america|argentina|chile|colombia|venezuela|peru)\b|拉丁美洲|阿根廷|智利|哥伦比亚|委内瑞拉|秘鲁/i],
];

function mentionedRegions(article) {
  const text = [article.title, ...(article.relatedSources || []).map((source) => source.title)]
    .filter(Boolean)
    .join(" ");
  return REGION_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

function relevanceScore(apiRank) {
  if (!Number.isFinite(apiRank)) return 0;
  if (apiRank <= 10) return 10;
  if (apiRank <= 25) return 9;
  if (apiRank <= 50) return 8;
  if (apiRank <= 100) return 6;
  if (apiRank <= 175) return 4;
  return 2;
}

function internationalScopeScore(regionCount, sourceCountryCount, signalText) {
  if (/\b(united nations|nato|g7|g20|world bank|imf|international court)\b|联合国|北约|七国集团|二十国集团|世界银行|国际货币基金组织/i.test(signalText)) return 10;
  if (regionCount >= 3) return 10;
  if (regionCount === 2) return 8;
  if (sourceCountryCount >= 3) return 6;
  if (sourceCountryCount === 2) return 4;
  return 0;
}

function attentionNote({ regions, sources, hasHighSignal, hasMediumSignal, category }) {
  const statements = [];
  if (regions.length >= 2) {
    statements.push(`标题明确涉及${regions.slice(0, 3).join("、")}，属于跨地区事件`);
  } else if (regions.length === 1 && (hasHighSignal || hasMediumSignal)) {
    statements.push(`报道涉及${regions[0]}及具有公共影响的重大事件`);
  } else if (hasHighSignal || hasMediumSignal) {
    const topic = category === "disaster" ? "重大自然灾害"
      : category === "economy" ? "重要经济变化"
        : category === "politics" || category === "international" ? "国际政治或安全事件"
          : "具有公共影响的事件";
    statements.push(`报道主题属于${topic}`);
  }
  if (sources.size > 1) statements.push(`已聚合 ${sources.size} 个独立媒体来源，可交叉核对后续进展`);
  return statements.length ? `${statements.join("；")}。` : "";
}

function articleSignalText(article) {
  return [
    article.title,
    article.summary,
    ...(article.relatedSources || []).flatMap((source) => [source.title, source.summary]),
  ].filter(Boolean).join(" ");
}

export function scoreNewsImportance(article, now = Date.now()) {
  const signalText = articleSignalText(article);
  const hasHighSignal = HIGH_PRIORITY.test(signalText);
  const hasMediumSignal = MEDIUM_PRIORITY.test(signalText);
  const hasPublicImpactSignal = PUBLIC_IMPACT.test(signalText);
  const isLowPriority = LOW_PRIORITY.test(signalText) && !hasHighSignal;
  const sources = new Set((article.relatedSources || [{ source: article.source }])
    .map((source) => source.source)
    .filter(Boolean));
  const sourceCountries = new Set((article.relatedSources || [{ country: article.country }])
    .map((source) => source.country)
    .filter((country) => country && country !== "来源地未知"));
  const latestDate = article.eventUpdatedAt || article.publishedAt;
  const regions = mentionedRegions(article);
  const bestApiRank = Math.min(...(article.relatedSources || [article])
    .map((source) => source.apiRank)
    .filter(Number.isFinite));
  const gdeltRank = Number.isFinite(bestApiRank) ? bestApiRank : null;

  const components = {
    impact: hasHighSignal ? 30 : hasMediumSignal ? 24 : categoryImpact(article.category),
    sources: sourceBreadthScore(sources.size),
    recency: recencyScore(latestDate, now),
    relevance: relevanceScore(gdeltRank),
    internationalScope: internationalScopeScore(regions.length, sourceCountries.size, signalText),
    publicRelevance: hasPublicImpactSignal
      ? 10
      : ["politics", "economy", "disaster"].includes(article.category)
        ? 8
        : ["energy", "ai", "technology"].includes(article.category) ? 5 : 0,
    lowPriorityPenalty: isLowPriority ? 35 : 0,
  };
  const score = Math.max(0, Math.min(100, Math.round(
    components.impact
      + components.sources
      + components.recency
      + components.relevance
      + components.internationalScope
      + components.publicRelevance
      - components.lowPriorityPenalty,
  )));
  const age = now - (latestDate?.valueOf() || 0);
  const substantive = hasHighSignal
    || hasMediumSignal
    || hasPublicImpactSignal
    || regions.length > 1;
  const eligible = age >= 0 && age <= DAY_MS && !isLowPriority && substantive && score >= 44;
  const reasons = [
    sources.size > 1 ? `${sources.size} 个独立媒体来源` : "单一媒体来源",
    regions.length > 1 ? `标题涉及 ${regions.length} 个地区` : "未用地区配额加分",
    gdeltRank ? `GDELT 相关性候选第 ${gdeltRank} 位` : "无外部相关性位次",
    hasHighSignal ? "重大事件关键词" : hasMediumSignal ? "重要事件关键词" : "主题影响度",
  ];

  return {
    score,
    eligible,
    components,
    reasons,
    regions,
    attentionNote: attentionNote({ regions, sources, hasHighSignal, hasMediumSignal, category: article.category }),
  };
}

export function rankNewsEvents(articles, now = Date.now()) {
  return [...articles]
    .map((article) => ({
      ...article,
      importance: scoreNewsImportance(article, now),
    }))
    .sort((left, right) => {
      const scoreDifference = right.importance.score - left.importance.score;
      if (scoreDifference) return scoreDifference;
      const sourceDifference = (right.sourceCount || 1) - (left.sourceCount || 1);
      if (sourceDifference) return sourceDifference;
      return (right.eventUpdatedAt?.valueOf() || right.publishedAt?.valueOf() || 0)
        - (left.eventUpdatedAt?.valueOf() || left.publishedAt?.valueOf() || 0);
    });
}

export function selectTopEvents(articles, limit = 5, now = Date.now()) {
  return rankNewsEvents(articles, now)
    .filter((article) => article.importance.eligible)
    .slice(0, limit);
}

export function clusterNewsEvents(articles) {
  const clusters = [];
  const sorted = [...articles].sort((a, b) => (b.publishedAt?.valueOf() || 0) - (a.publishedAt?.valueOf() || 0));

  sorted.forEach((article) => {
    const articleTime = article.publishedAt?.valueOf() || 0;
    const cluster = clusters.find((candidate) => {
      const candidateTime = candidate.members[0].publishedAt?.valueOf() || 0;
      if (articleTime && candidateTime && Math.abs(articleTime - candidateTime) > 7 * 24 * 60 * 60 * 1000) return false;
      return candidate.members.some((member) => {
        const titleScore = titleSimilarity(article.title, member.title);
        if (titleScore >= 0.72) return true;
        if (!article.summary || !member.summary || titleScore < 0.48) return false;
        return textSimilarity(article.summary, member.summary) >= 0.68;
      });
    });

    if (cluster) cluster.members.push(article);
    else clusters.push({ members: [article] });
  });

  return clusters.map(({ members }) => {
    const representative = [...members].sort((a, b) => representativeScore(b) - representativeScore(a))[0];
    const relatedSources = members
      .map(relatedSource)
      .sort((a, b) => (b.publishedAt?.valueOf() || 0) - (a.publishedAt?.valueOf() || 0));
    const countries = [...new Set(members
      .map((member) => member.country)
      .filter((country) => country && country !== "来源地未知"))];

    const event = {
      ...representative,
      eventId: `event-${stableHash(normalizedTitle(representative.title))}`,
      originalTitle: representative.title,
      summary: representative.summary || members.find((member) => member.summary)?.summary || "",
      category: dominantCategory(members),
      eventUpdatedAt: relatedSources[0]?.publishedAt || representative.publishedAt,
      relatedSources,
      sourceCount: new Set(relatedSources.map((source) => source.source)).size,
      countries,
      apiRank: Math.min(...relatedSources.map((source) => source.apiRank).filter(Number.isFinite), Infinity),
    };
    if (!Number.isFinite(event.apiRank)) event.apiRank = null;
    return {
      ...event,
      importance: scoreNewsImportance(event),
    };
  }).sort((a, b) => (b.eventUpdatedAt?.valueOf() || 0) - (a.eventUpdatedAt?.valueOf() || 0));
}
