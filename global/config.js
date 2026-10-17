export const GDELT_API = "https://api.gdeltproject.org/api/v2/doc/doc";
export const GDELT_CONTEXT_API = "https://api.gdeltproject.org/api/v2/context/context";

export const USGS_FEEDS = {
  "1h": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson",
  "1d": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson",
  "1w": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson",
};

export const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
export const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
export const AUTO_REFRESH_MS = 15 * 60 * 1000;
export const CACHE_KEY = "global-pulse-news-v6";
export const READER_CACHE_KEY = "global-pulse-reader-v2";

export const CATEGORY_CONFIG = {
  all: { label: "全球焦点", tone: "blue" },
  international: { label: "国际政治", tone: "cyan" },
  politics: { label: "国际政治", tone: "blue" },
  economy: { label: "全球经济", tone: "cyan" },
  technology: { label: "科技创新", tone: "blue" },
  ai: { label: "人工智能", tone: "cyan" },
  energy: { label: "能源", tone: "yellow" },
  disaster: { label: "自然灾害", tone: "red" },
};

export const CLASSIFICATION_RULES = [
  ["ai", /\b(ai|artificial intelligence|generative ai|machine learning|openai|chatgpt|llm|large language model|deepseek|anthropic)\b|人工智能|生成式.?ai|大模型|机器学习/i],
  ["disaster", /\b(earthquake|flood|wildfire|hurricane|cyclone|tsunami|eruption|disaster|storm|landslide)\b|地震|洪水|山火|飓风|海啸|灾害|滑坡/i],
  ["energy", /\b(oil|gas|energy|opec|nuclear|solar|wind power|renewable|electricity)\b|石油|天然气|能源|核电|太阳能|风电/i],
  ["technology", /\b(technology|semiconductor|chip|cyber|robot|software|spacecraft|satellite)\b|科技|芯片|半导体|网络安全|机器人|卫星/i],
  ["economy", /\b(economy|economic|inflation|recession|interest rate|market|stocks?|gdp|bank|tariff|trade|export|import)\b|经济|通胀|衰退|利率|市场|股市|银行|关税|贸易/i],
  ["politics", /\b(election|government|president|minister|parliament|policy|congress|senate)\b|选举|政府|总统|部长|议会|政策/i],
  ["international", /\b(diplomacy|summit|united nations|foreign policy|ceasefire|sanction|military|conflict|war|border)\b|外交|峰会|联合国|停火|制裁|军事|冲突|战争|边境/i],
];

export const GDELT_QUERY = "(war OR ceasefire OR sanctions OR election OR summit OR inflation OR tariff OR earthquake OR flood OR wildfire OR hurricane OR \"artificial intelligence\" OR semiconductor OR \"United Nations\")";

export const HIGH_PRIORITY = /\b(invasion|airstrike|missile|tsunami|hurricane|cyclone|mass evacuation|ceasefire|state of emergency|major explosion|full-scale war|civil war|world war|war (?:in|between|with|against)|(?:ukraine|gaza|israel|russia|sudan|iran|yemen|syria) war|nuclear|sovereign default|debt default|market crash)\b|入侵|空袭|导弹|海啸|飓风|大规模撤离|停火|紧急状态|重大爆炸|战争|核|主权违约|债务违约|崩盘/i;
export const MEDIUM_PRIORITY = /\b(armed conflict|military conflict|conflict (?:in|between|with)|military operation|sanctions?|earthquake|major flood|wildfire|recession|tariffs?|cyberattack|outbreak|mass protest)\b|武装冲突|军事冲突|军事行动|制裁|地震|重大洪水|山火|衰退|关税|网络攻击|疫情|大规模抗议/i;
export const PUBLIC_IMPACT = /\b(election|president|prime minister|government|parliament|central bank|interest rate|inflation|gdp|trade deal|summit|united nations|breakthrough|launch|regulation|peace talks|humanitarian|casualties)\b|选举|总统|总理|政府|议会|央行|利率|通胀|国内生产总值|贸易协议|峰会|联合国|突破|发布|监管|和谈|人道主义|伤亡/i;
export const LOW_PRIORITY = /\b(celebrity|entertainment|gossip|recipe|fashion|horoscope|lottery|giveaway|book review|travel tips?|wedding|scholarships?|football|soccer|basketball|tennis|cricket|newsletter|podcast|opinion|editorial|press release|cardroom|online poker|player base|trustee election|school board|local election|municipal election|city council|count(?:y|ies)|updated? wildfire tracker|launches? (?:an? )?updated? tracker)\b|明星|娱乐|八卦|食谱|时尚|星座|彩票|赠品|书评|旅行攻略|婚礼|奖学金|足球|篮球|网球|新闻稿|校董选举|地方选举|市议会|县/i;

export const TIME_WINDOWS = {
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
};

export const COUNTRY_COORDS = {
  Argentina: [-38.4, -63.6], Australia: [-25.3, 133.8], Austria: [47.5, 14.6],
  Bangladesh: [23.7, 90.4], Belgium: [50.5, 4.5], Bolivia: [-16.3, -63.6],
  Brazil: [-14.2, -51.9], Bulgaria: [42.7, 25.5], Cambodia: [12.6, 105],
  Cameroon: [7.4, 12.4], Canada: [56.1, -106.3], Chile: [-35.7, -71.5],
  China: [35.9, 104.2], Colombia: [4.6, -74.3], Croatia: [45.1, 15.2],
  Cuba: [21.5, -77.8], "Czech Republic": [49.8, 15.5], Denmark: [56.3, 9.5],
  "Dominican Republic": [18.7, -70.2], Ecuador: [-1.8, -78.2], Egypt: [26.8, 30.8],
  Estonia: [58.6, 25], Ethiopia: [9.1, 40.5], Finland: [61.9, 25.7],
  France: [46.2, 2.2], Germany: [51.2, 10.5], Ghana: [7.9, -1],
  Greece: [39.1, 21.8], Hungary: [47.2, 19.5], India: [20.6, 79],
  Indonesia: [-0.8, 113.9], Iran: [32.4, 53.7], Iraq: [33.2, 43.7],
  Ireland: [53.1, -8.2], Israel: [31, 34.9], Italy: [41.9, 12.6],
  Japan: [36.2, 138.3], Jordan: [30.6, 36.2], Kazakhstan: [48, 67],
  Kenya: [-0.02, 37.9], Kuwait: [29.3, 47.5], Latvia: [56.9, 24.6],
  Lebanon: [33.9, 35.9], Lithuania: [55.2, 23.9], Malaysia: [4.2, 101.98],
  Mexico: [23.6, -102.6], Morocco: [31.8, -7.1], Myanmar: [21.9, 95.96],
  Nepal: [28.4, 84.1], Netherlands: [52.1, 5.3], "New Zealand": [-40.9, 174.9],
  Nigeria: [9.1, 8.7], Norway: [60.5, 8.5], Pakistan: [30.4, 69.3],
  Panama: [8.5, -80.8], Peru: [-9.2, -75], Philippines: [12.9, 121.8],
  Poland: [51.9, 19.1], Portugal: [39.4, -8.2], Qatar: [25.4, 51.2],
  Romania: [45.9, 24.97], Russia: [61.5, 105.3], "Saudi Arabia": [23.9, 45.1],
  Serbia: [44, 21], Singapore: [1.35, 103.8], Slovakia: [48.7, 19.7],
  Slovenia: [46.2, 15], "South Africa": [-30.6, 22.9], "South Korea": [35.9, 127.8],
  Spain: [40.5, -3.7], "Sri Lanka": [7.9, 80.8], Sweden: [60.1, 18.6],
  Switzerland: [46.8, 8.2], Syria: [35, 38.99], Taiwan: [23.7, 121],
  Tanzania: [-6.4, 34.9], Thailand: [15.9, 100.99], Tunisia: [33.9, 9.5],
  Turkey: [39, 35.2], Ukraine: [48.4, 31.2], "United Arab Emirates": [23.4, 53.8],
  "United Kingdom": [55.4, -3.4], "United States": [37.1, -95.7], Uruguay: [-32.5, -55.8],
  Venezuela: [6.4, -66.6], Vietnam: [14.1, 108.3], Yemen: [15.6, 48.5], Zimbabwe: [-19, 29.2],
};
