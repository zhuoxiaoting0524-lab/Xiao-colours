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
    url: article.url,
    source: article.source,
    country: article.country,
    language: article.language,
    publishedAt: article.publishedAt,
  };
}

export function clusterNewsEvents(articles) {
  const clusters = [];
  const sorted = [...articles].sort((a, b) => (b.publishedAt?.valueOf() || 0) - (a.publishedAt?.valueOf() || 0));

  sorted.forEach((article) => {
    const articleTime = article.publishedAt?.valueOf() || 0;
    const cluster = clusters.find((candidate) => {
      const candidateTime = candidate.members[0].publishedAt?.valueOf() || 0;
      if (articleTime && candidateTime && Math.abs(articleTime - candidateTime) > 7 * 24 * 60 * 60 * 1000) return false;
      return candidate.members.some((member) => titleSimilarity(article.title, member.title) >= 0.72);
    });

    if (cluster) cluster.members.push(article);
    else clusters.push({ members: [article] });
  });

  return clusters.map(({ members }, index) => {
    const representative = [...members].sort((a, b) => representativeScore(b) - representativeScore(a))[0];
    const relatedSources = members
      .map(relatedSource)
      .sort((a, b) => (b.publishedAt?.valueOf() || 0) - (a.publishedAt?.valueOf() || 0));
    const countries = [...new Set(members
      .map((member) => member.country)
      .filter((country) => country && country !== "来源地未知"))];

    return {
      ...representative,
      eventId: `${normalizedTitle(representative.title).slice(0, 72)}-${index}`,
      originalTitle: representative.title,
      category: dominantCategory(members),
      eventUpdatedAt: relatedSources[0]?.publishedAt || representative.publishedAt,
      relatedSources,
      sourceCount: new Set(relatedSources.map((source) => source.source)).size,
      countries,
    };
  }).sort((a, b) => (b.eventUpdatedAt?.valueOf() || 0) - (a.eventUpdatedAt?.valueOf() || 0));
}
