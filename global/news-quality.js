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
    disaster: 30,
    politics: 23,
    economy: 22,
    energy: 19,
    ai: 17,
    technology: 15,
    international: 8,
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

function regionalCoverageScore(count) {
  if (count >= 4) return 10;
  if (count === 3) return 7;
  if (count === 2) return 5;
  return count === 1 ? 2 : 0;
}

function recencyScore(date, now) {
  const age = now - (date?.valueOf() || 0);
  if (!date || age < 0 || age > DAY_MS) return 0;
  if (age <= 60 * 60 * 1000) return 20;
  if (age <= 6 * 60 * 60 * 1000) return 18;
  if (age <= 12 * 60 * 60 * 1000) return 15;
  return 10;
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

  const components = {
    impact: hasHighSignal ? 35 : hasMediumSignal ? 27 : categoryImpact(article.category),
    sources: sourceBreadthScore(sources.size),
    recency: recencyScore(latestDate, now),
    coverage: regionalCoverageScore(sourceCountries.size),
    publicRelevance: hasPublicImpactSignal
      ? 10
      : ["politics", "economy", "disaster"].includes(article.category)
        ? 8
        : ["energy", "ai", "technology"].includes(article.category) ? 5 : 0,
    lowPriorityPenalty: isLowPriority ? 32 : 0,
  };
  const score = Math.max(0, Math.min(100, Math.round(
    components.impact
      + components.sources
      + components.recency
      + components.coverage
      + components.publicRelevance
      - components.lowPriorityPenalty,
  )));
  const age = now - (latestDate?.valueOf() || 0);
  const substantive = hasHighSignal
    || hasMediumSignal
    || hasPublicImpactSignal
    || ["politics", "economy", "disaster", "energy", "ai", "technology"].includes(article.category);
  const eligible = age >= 0 && age <= DAY_MS && !isLowPriority && substantive && score >= 44;
  const reasons = [
    sources.size > 1 ? `${sources.size} 个独立媒体来源` : "单一媒体来源",
    sourceCountries.size > 1 ? `${sourceCountries.size} 个媒体来源地区关注` : "单一媒体来源地区",
    hasHighSignal ? "重大事件关键词" : hasMediumSignal ? "重要事件关键词" : "主题影响度",
  ];

  return { score, eligible, components, reasons };
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
    };
    return {
      ...event,
      importance: scoreNewsImportance(event),
    };
  }).sort((a, b) => (b.eventUpdatedAt?.valueOf() || 0) - (a.eventUpdatedAt?.valueOf() || 0));
}
