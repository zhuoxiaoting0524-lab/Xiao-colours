const UPDATED_AT = "2026-11-10";

const TOPICS = [
  {
    key: "Hometown", zh: "家乡",
    part1: [
      ["Where is your hometown?", "你的家乡在哪里？"], ["What do you like most about your hometown?", "你最喜欢家乡的什么？"],
      ["Has your hometown changed much in recent years?", "近年来你的家乡变化大吗？"], ["Is your hometown a good place for young people?", "你的家乡适合年轻人生活吗？"],
      ["What kind of transport do people use in your hometown?", "家乡的人通常使用什么交通工具？"], ["Would you like to live in your hometown in the future?", "将来你想住在家乡吗？"],
      ["What would you improve about your hometown?", "你希望改善家乡的什么？"],
    ],
    part2: [
      ["Describe a place in your hometown that you often recommend to visitors.", "描述一个你常推荐给游客的家乡地点。", ["where it is", "what people can do there", "when you last visited it", "why you recommend it"]],
      ["Describe a change that has improved your hometown.", "描述一项让家乡变得更好的变化。", ["what changed", "when it happened", "who benefited", "why it was positive"]],
      ["Describe a memorable day you spent in your hometown.", "描述你在家乡度过的一个难忘日子。", ["when it was", "where you went", "who you were with", "why you remember it"]],
    ],
    part3: [
      ["Why do some people feel strongly attached to their hometown?", "为什么有些人对家乡有强烈的归属感？"], ["How can small cities attract young professionals?", "小城市如何吸引年轻专业人士？"],
      ["Should historic areas be protected even if housing is needed?", "即使需要住房，也应该保护历史街区吗？"], ["What makes a city comfortable to live in?", "什么因素让一座城市宜居？"],
      ["How might hometowns change as remote work becomes common?", "随着远程办公普及，家乡可能如何变化？"],
    ],
  },
  {
    key: "Work", zh: "工作",
    part1: [
      ["What kind of work would you like to do?", "你想从事什么工作？"], ["What skills are important in your work or studies?", "你的工作或学习需要哪些重要技能？"],
      ["Do you prefer working alone or with others?", "你更喜欢独自工作还是与他人合作？"], ["What part of a working day do you enjoy most?", "一天工作中你最喜欢哪个部分？"],
      ["How do you stay focused when you have a difficult task?", "面对困难任务时你如何保持专注？"], ["Would you like to work from home?", "你愿意在家工作吗？"],
      ["What job did you want when you were a child?", "小时候你想做什么工作？"],
    ],
    part2: [
      ["Describe a person whose way of working you admire.", "描述一个你欣赏其工作方式的人。", ["who the person is", "what work they do", "what you observed", "why you admire them"]],
      ["Describe a challenging task you completed successfully.", "描述一项你成功完成的挑战性任务。", ["what the task was", "why it was difficult", "what you did", "how you felt afterwards"]],
      ["Describe a useful skill you learned for work or study.", "描述一项你为工作或学习掌握的实用技能。", ["what it is", "how you learned it", "when you use it", "why it is useful"]],
    ],
    part3: [
      ["How is technology changing the skills employers need?", "科技如何改变雇主需要的技能？"], ["Why do people change careers more often today?", "为什么如今人们更频繁地转换职业？"],
      ["Should companies allow flexible working hours?", "公司应该允许弹性工作时间吗？"], ["What makes a workplace fair?", "什么使工作场所公平？"],
      ["Is job satisfaction more important than a high salary?", "工作满意度比高薪更重要吗？"],
    ],
  },
  {
    key: "Study", zh: "学习",
    part1: [
      ["What are you studying at the moment?", "你目前在学习什么？"], ["Why did you choose this subject?", "你为什么选择这个学科？"],
      ["Where do you study best?", "你在哪里学习效率最高？"], ["Do you prefer practical lessons or lectures?", "你更喜欢实践课还是讲座？"],
      ["How do you organise your study time?", "你如何安排学习时间？"], ["Which subject did you enjoy at school?", "上学时你喜欢哪门学科？"],
      ["Is there anything new you would like to learn?", "你还想学习什么新东西？"],
    ],
    part2: [
      ["Describe a lesson that you found especially useful.", "描述一堂你觉得特别有用的课。", ["what the lesson was", "who taught it", "what you learned", "why it was useful"]],
      ["Describe a time when you helped someone learn something.", "描述一次你帮助别人学习的经历。", ["who you helped", "what they wanted to learn", "how you helped", "what happened"]],
      ["Describe a subject you would like to study in the future.", "描述一门你未来想学习的学科。", ["what it is", "why it interests you", "how you would study it", "how it could help you"]],
    ],
    part3: [
      ["How should schools prepare students for uncertain careers?", "学校应如何帮助学生应对不确定的职业未来？"], ["What are the advantages of learning with classmates?", "与同学一起学习有什么优势？"],
      ["Should exams be the main way to measure learning?", "考试应该是衡量学习的主要方式吗？"], ["How can adults remain motivated to learn?", "成年人如何保持学习动力？"],
      ["Will online learning replace traditional classrooms?", "在线学习会取代传统课堂吗？"],
    ],
  },
  {
    key: "Travel", zh: "旅行",
    part1: [
      ["Do you enjoy travelling?", "你喜欢旅行吗？"], ["What kind of places do you prefer to visit?", "你更喜欢参观什么样的地方？"],
      ["How do you usually plan a trip?", "你通常如何计划旅行？"], ["Do you prefer travelling alone or with someone?", "你喜欢独自旅行还是结伴旅行？"],
      ["What do you always take on a trip?", "旅行时你一定会带什么？"], ["Which journey do you remember well?", "哪段旅程让你印象深刻？"],
      ["Is there a country you hope to visit?", "你希望去哪个国家？"],
    ],
    part2: [
      ["Describe a journey that did not go as planned.", "描述一次没有按计划进行的旅程。", ["where you were going", "what went wrong", "what you did", "what you learned"]],
      ["Describe a place you visited that surprised you.", "描述一个让你感到惊喜的旅行地。", ["where it was", "why you went", "what surprised you", "whether you would return"]],
      ["Describe a trip you would like to take with another person.", "描述一次你想和别人一起进行的旅行。", ["where you would go", "who you would go with", "what you would do", "why this trip appeals to you"]],
    ],
    part3: [
      ["How does tourism affect local communities?", "旅游业如何影响当地社区？"], ["Why are some destinations becoming overcrowded?", "为什么一些旅游目的地变得过度拥挤？"],
      ["Should tourists pay extra to protect natural areas?", "游客应该为保护自然区域额外付费吗？"], ["How might virtual reality change travel?", "虚拟现实可能如何改变旅行？"],
      ["What responsibilities do travellers have?", "旅行者应承担哪些责任？"],
    ],
  },
  {
    key: "Technology", zh: "科技",
    part1: [
      ["Which piece of technology do you use most often?", "你最常使用哪种科技产品？"], ["Is it easy for you to learn new apps?", "你容易学会使用新应用吗？"],
      ["How has technology changed your daily routine?", "科技如何改变了你的日常生活？"], ["Do you ever take a break from your phone?", "你会暂时远离手机吗？"],
      ["What technology would you like to own?", "你想拥有什么科技产品？"], ["Do older and younger people use technology differently?", "老年人和年轻人使用科技的方式不同吗？"],
      ["Which online service is most useful to you?", "哪种在线服务对你最有用？"],
    ],
    part2: [
      ["Describe a digital tool that made a task easier for you.", "描述一个让任务变得更容易的数字工具。", ["what it is", "when you started using it", "how it helps", "whether it has any drawbacks"]],
      ["Describe a time when technology caused a problem.", "描述一次科技造成问题的经历。", ["what technology was involved", "what happened", "how you solved it", "what you learned"]],
      ["Describe a technology skill you would like to improve.", "描述一项你想提高的科技技能。", ["what it is", "why you need it", "how you could practise", "how it would benefit you"]],
    ],
    part3: [
      ["How should personal data be protected online?", "个人数据在网上应该如何受到保护？"], ["Can technology make people less independent?", "科技会让人们变得不够独立吗？"],
      ["Who should be responsible for teaching digital literacy?", "谁应该负责教授数字素养？"], ["How can society reduce the digital divide?", "社会如何缩小数字鸿沟？"],
      ["Should new technologies be regulated before widespread use?", "新科技在广泛使用前应该受到监管吗？"],
    ],
  },
  {
    key: "People", zh: "人物",
    part1: [
      ["Who do you spend most of your free time with?", "你大部分空闲时间和谁一起度过？"], ["What qualities do you value in a friend?", "你看重朋友的哪些品质？"],
      ["Do you find it easy to meet new people?", "你容易结识新朋友吗？"], ["Who did you admire when you were younger?", "小时候你崇拜谁？"],
      ["How do you keep in touch with distant friends?", "你如何与远方的朋友保持联系？"], ["Do you prefer a few close friends or a large group?", "你更喜欢少数亲密朋友还是一大群朋友？"],
      ["What makes someone a good listener?", "什么样的人算是好的倾听者？"],
    ],
    part2: [
      ["Describe someone who gave you useful advice.", "描述一个给过你实用建议的人。", ["who the person is", "what the advice was", "when you received it", "how it helped you"]],
      ["Describe a person who is good at bringing people together.", "描述一个善于凝聚大家的人。", ["who they are", "where you know them from", "what they do", "why this ability matters"]],
      ["Describe an interesting conversation you had with someone.", "描述一次有趣的谈话。", ["who you spoke with", "where it happened", "what you discussed", "why it was memorable"]],
    ],
    part3: [
      ["Why are role models important for young people?", "榜样为什么对年轻人重要？"], ["How have friendships changed because of social media?", "社交媒体如何改变了友谊？"],
      ["What qualities should community leaders have?", "社区领导者应该具备哪些品质？"], ["Why do people sometimes avoid asking for help?", "为什么人们有时不愿寻求帮助？"],
      ["Can people from different generations understand each other well?", "不同世代的人能很好地理解彼此吗？"],
    ],
  },
  {
    key: "Environment", zh: "环境",
    part1: [
      ["Are there many green spaces near your home?", "你家附近有很多绿地吗？"], ["What do you do to reduce waste?", "你会做什么来减少浪费？"],
      ["Do you enjoy spending time in nature?", "你喜欢亲近自然吗？"], ["Is air quality a concern where you live?", "你居住的地方需要担心空气质量吗？"],
      ["How often do you reuse or recycle things?", "你多久会重复使用或回收物品？"], ["What kind of weather do you prefer?", "你喜欢什么样的天气？"],
      ["Would you change your habits to help the environment?", "你愿意改变习惯来保护环境吗？"],
    ],
    part2: [
      ["Describe a natural place that you would like to protect.", "描述一个你想保护的自然地点。", ["where it is", "what it looks like", "what threatens it", "why it should be protected"]],
      ["Describe an environmentally friendly habit you developed.", "描述一个你养成的环保习惯。", ["what the habit is", "when you started", "why you chose it", "how easy it is to maintain"]],
      ["Describe a time when weather affected your plans.", "描述一次天气影响你计划的经历。", ["what you planned", "what the weather was like", "what you changed", "how you felt"]],
    ],
    part3: [
      ["Should environmental action depend mainly on individuals or governments?", "环保行动主要应该依靠个人还是政府？"], ["How can cities encourage people to use less energy?", "城市如何鼓励人们减少能源使用？"],
      ["Why is it difficult to change environmental habits?", "为什么改变环保习惯很困难？"], ["Can economic growth and environmental protection coexist?", "经济增长与环境保护能共存吗？"],
      ["How should schools teach children about climate change?", "学校应该如何向孩子教授气候变化？"],
    ],
  },
  {
    key: "Daily Life", zh: "日常生活",
    part1: [
      ["What is the busiest part of your day?", "一天中你最忙的时段是什么时候？"], ["Do you prefer mornings or evenings?", "你更喜欢早晨还是晚上？"],
      ["How often do you cook for yourself?", "你多久为自己做一次饭？"], ["What helps you relax after a busy day?", "忙碌一天后什么能帮助你放松？"],
      ["Is your daily routine different at weekends?", "你的周末作息和平日不同吗？"], ["What small task do you often postpone?", "你经常拖延哪件小事？"],
      ["Would you like to change anything about your routine?", "你想改变日常作息中的什么？"],
    ],
    part2: [
      ["Describe a routine that helps you feel organised.", "描述一个让你更有条理的日常习惯。", ["what the routine is", "when you do it", "how you developed it", "why it helps"]],
      ["Describe a simple meal that you enjoy making.", "描述一道你喜欢制作的简单餐食。", ["what it is", "what ingredients you need", "how you make it", "why you enjoy it"]],
      ["Describe a day when you were especially productive.", "描述你效率特别高的一天。", ["when it was", "what you needed to do", "how you organised the day", "why it went well"]],
    ],
    part3: [
      ["Why do modern lifestyles often feel rushed?", "为什么现代生活常让人觉得匆忙？"], ["How can communities support a healthier daily life?", "社区如何支持更健康的日常生活？"],
      ["Are routines helpful or limiting?", "固定作息是有帮助还是有限制？"], ["Why do convenience services appeal to busy people?", "便利服务为什么吸引忙碌的人？"],
      ["How might daily life change in the next twenty years?", "未来二十年日常生活可能如何变化？"],
    ],
  },
  {
    key: "Education", zh: "教育",
    part1: [
      ["Did you enjoy your first years at school?", "你喜欢刚上学的那几年吗？"], ["Which teacher influenced you most?", "哪位老师对你影响最大？"],
      ["Do you like learning through books?", "你喜欢通过书本学习吗？"], ["What makes a lesson interesting?", "什么能让一堂课变得有趣？"],
      ["Should students wear school uniforms?", "学生应该穿校服吗？"], ["Were you good at doing homework on time?", "你以前能按时完成作业吗？"],
      ["What would you like schools to teach more of?", "你希望学校多教授什么？"],
    ],
    part2: [
      ["Describe a teacher who made a subject interesting.", "描述一位让某个学科变得有趣的老师。", ["who the teacher was", "what they taught", "how they taught", "why you remember them"]],
      ["Describe an educational activity outside the classroom.", "描述一次课堂外的教育活动。", ["what it was", "where it happened", "what you did", "what you learned"]],
      ["Describe a school rule that you think was useful.", "描述一条你认为有用的校规。", ["what the rule was", "why it existed", "how students reacted", "why you think it was useful"]],
    ],
    part3: [
      ["What should be the main purpose of education?", "教育的主要目的应该是什么？"], ["How can teachers support students with different abilities?", "教师如何支持能力不同的学生？"],
      ["Should universities focus more on employment skills?", "大学应该更重视就业技能吗？"], ["How does family background affect education?", "家庭背景如何影响教育？"],
      ["What can governments do to make education more equal?", "政府可以如何让教育更加公平？"],
    ],
  },
  {
    key: "Society", zh: "社会",
    part1: [
      ["Do you often follow local news?", "你经常关注本地新闻吗？"], ["What public service do you use most?", "你最常使用哪种公共服务？"],
      ["Do people in your area know their neighbours?", "你所在地区的人认识邻居吗？"], ["Have you ever volunteered in your community?", "你参加过社区志愿活动吗？"],
      ["What makes a neighbourhood feel safe?", "什么能让社区给人安全感？"], ["Do you enjoy public events?", "你喜欢公共活动吗？"],
      ["What social change have you noticed recently?", "你最近注意到什么社会变化？"],
    ],
    part2: [
      ["Describe a community event that brought people together.", "描述一次让人们聚在一起的社区活动。", ["what the event was", "where it happened", "who took part", "why it was valuable"]],
      ["Describe a public place that serves an important purpose.", "描述一个发挥重要作用的公共场所。", ["where it is", "who uses it", "what happens there", "why it matters"]],
      ["Describe a social issue that you learned more about.", "描述一个你进一步了解过的社会问题。", ["what the issue is", "how you learned about it", "why it matters", "what could improve the situation"]],
    ],
    part3: [
      ["What helps people trust public institutions?", "什么能帮助人们信任公共机构？"], ["How can cities reduce loneliness?", "城市如何减少孤独感？"],
      ["Should volunteering be encouraged at school?", "学校应该鼓励志愿服务吗？"], ["Why do social inequalities persist?", "社会不平等为什么持续存在？"],
      ["How can ordinary people influence positive social change?", "普通人如何推动积极的社会变化？"],
    ],
  },
];

const questions = [];
for (const topic of TOPICS) {
  topic.part1.forEach(([questionEn, questionZh], index) => questions.push({
    id: `p1-${topic.key.toLowerCase().replaceAll(" ", "-")}-${index + 1}`,
    part: 1, topic: topic.key, topicZh: topic.zh, questionEn, questionZh,
    cuePoints: [], difficulty: index < 2 ? "easy" : "medium", sourceType: "XiaoColour original practice question",
    createdAt: UPDATED_AT, updatedAt: UPDATED_AT,
  }));
  topic.part2.forEach(([questionEn, questionZh, cuePoints], index) => questions.push({
    id: `p2-${topic.key.toLowerCase().replaceAll(" ", "-")}-${index + 1}`,
    part: 2, topic: topic.key, topicZh: topic.zh, questionEn, questionZh,
    cuePoints, difficulty: "medium", sourceType: "XiaoColour original cue card",
    createdAt: UPDATED_AT, updatedAt: UPDATED_AT,
  }));
  topic.part3.forEach(([questionEn, questionZh], index) => questions.push({
    id: `p3-${topic.key.toLowerCase().replaceAll(" ", "-")}-${index + 1}`,
    part: 3, topic: topic.key, topicZh: topic.zh, questionEn, questionZh,
    cuePoints: [], difficulty: index < 2 ? "medium" : "hard", sourceType: "XiaoColour original discussion question",
    createdAt: UPDATED_AT, updatedAt: UPDATED_AT,
  }));
}

export const SPEAKING_QUESTIONS = Object.freeze(questions);
export const SPEAKING_TOPICS = Object.freeze(TOPICS.map(({ key, zh }) => ({ key, zh })));

if (SPEAKING_QUESTIONS.length !== 150) throw new Error("Speaking question bank must contain exactly 150 questions");
