// Entry-point descriptions are separate from the versioned legacy worlds.
const EXPERIENCES = {
  'fog-harbor': {
    promise:'在潮声与旧友之间，查清一封迟来的电报，也决定怎样与往事相处。',
    premise:'你曾是雾港电报员，离乡七年后返港。这是开局已确定的身份与经历；离乡原因、与谁亲近、是否追查都由你决定。',
    pressure:'署着你名字的电报比你先到，林见微正等你回应；旧档搬迁与朋友各自的生活也在继续。',
    participation:'电报直接与你有关。你可以核实来处、先叙旧，或暂时不追问。',
    possibilities:['问清电报何时、由谁送到','听林见微说明旧电报局的情况','先在旅馆坐一会儿，让他人继续自己的事'],
    closure:'弄清一条线索、与一个人把话说完，或决定把疑问留待以后，都可以成为这段经历的收尾。'
  },
  mountain: {
    promise:'把一封意外展开的信送到该去的地方，在山中日常里体会承诺的分量。',
    premise:'你是负责传信的外门弟子，手中有一封写着“何砚亲启”的信；它自行展开。你尚未接受额外誓约，也未决定继续读信。',
    pressure:'信封的术印出了问题，苏照愿意帮忙，却还要赶下山的车。',
    participation:'信正在你手中。如何保管、说明和送达，是你可以掌握的一小段事情。',
    possibilities:['请苏照看看术印，先不继续读信','询问信件该如何妥善送达','暂缓调查，让苏照先安排她的行程'],
    closure:'妥善交接这封信、查清一次故障，或明确自己愿意承担到哪一步，就能告一段落。'
  },
  thursday: {
    promise:'在一间旧书店里，慢慢理顺误会，让一次取书有个妥当的交代。',
    premise:'你临时接手书店，今天是第三天。眼前的顾客你从未见过；她说有人替她留书，并不等于你已作过这项承诺。',
    pressure:'顾客等着取书，预留记录还没理清，熟悉店务的唐雨也有自己的考试安排。',
    participation:'你正照看柜台，可以帮她核对，也可以诚实说明还不了解情况。',
    possibilities:['请顾客描述书名和预留经过','在唐雨方便时核对交接记录','先请顾客稍候，按自己的节奏整理柜台'],
    closure:'找到书、说清误会，或约定一个双方愿意接受的后续，都足以结束这一小段日常。'
  }
};

const nonempty = value => typeof value === 'string' && value.trim().length > 0;

/** Return public entry-point copy, without deriving anything from NPC secrets. */
export function getExperience(world = {}) {
  world = world || {};
  const fallback = {
    promise:nonempty(world.description) ? world.description : '进入一个处境，决定自己愿意怎样参与。',
    premise:nonempty(world.identity) ? `你的开局身份是：${world.identity}。其他过往以已确认的设定为准。` : '身份与过往以你确认的世界设定为准。',
    pressure:'从开场中正在发生的事情开始；没有说明的承诺和紧迫期限不自动成立。',
    participation:'你可以先观察、提出行动，也可以暂时不介入。',
    possibilities:['先看清眼前的处境','与在场的人说一句话','暂时不介入，让眼前的事情自然继续'],
    closure:'在一个小问题得到交代，或你觉得可以停下时，为这一段留下收尾。'
  };
  // Edited versions and copies should not inherit an obsolete preset premise.
  const preset = !world.custom && (world.version === undefined || world.version === 1)
    && Object.hasOwn(EXPERIENCES, world.id) ? EXPERIENCES[world.id] : {};
  const supplied = world.experience && typeof world.experience === 'object' ? world.experience : {};
  const result = {...fallback, ...preset};
  for (const key of ['promise','premise','pressure','participation','closure']) {
    if (nonempty(supplied[key])) result[key] = supplied[key];
  }
  const possibilities = Array.isArray(supplied.possibilities) ? supplied.possibilities.filter(nonempty) : [];
  result.possibilities = [...(possibilities.length ? possibilities : result.possibilities)];
  return result;
}

// Adapted concept seed from the user's product brief; not validated play data.
export const ADDITIONAL_WORLDS = [{
  id:'truth-teahouse',version:1,title:'真话城的第一壶茶',
  tagline:'客人想买一份道歉的礼物，却还没想好要说什么。',
  description:'在一座无法故意说谎的城里，你的茶铺第一天开门。人们依然会误会、沉默，也会认真挑选一句愿意说出口的话。第一位顾客想带茶去道歉；你可以帮他选茶，听听他的困扰，或只照常做生意。',
  tags:['日常奇想','茶铺生活','表达与边界'],pace:'从容 · 一桩小事',era:'架空的当代小城',
  rules:[
    '城中任何人（包括玩家）都无法有意说出违背自己当下信念的话；这不保证其信念正确，也不赋予任何人读心或辨认真相的能力。',
    '人可以记错、误解、表达不完整、保持沉默或拒绝回答。沉默不等于承认；不能据此强制披露隐私。',
    '人物只知道自己亲历、听闻或查证的事情；他人的秘密、动机与尚未发生的选择不会自动成为共同知识。',
    '开场的顾客仅表达购买意向，尚未选定、付款或收下任何商品；成交、赠送、代送、代写署名与其他承诺都需明确同意。',
    '玩家已确认的开局事实只有茶铺店主身份与开业第一天；不预设其曾经伤害谁、许过诺、与顾客相识或愿意介入私事。',
    '道歉不保证获得原谅。人物可以改变想法或离开；玩家只卖茶、拒绝介入或暂时观察，都不会被叙述为失职。'
  ],
  characters:[
    {
      id:'qiao',name:'乔安',role:'街口修伞匠',
      public:'说话慢，袖口留着缝伞线。他想挑一份道歉的礼物，进门时没有拿任何商品。',
      goal:'在妹妹今晚离城前，为昨天失约的事亲口道歉；是否送茶还没决定。',
      history:'昨天答应陪妹妹去取行李，临时留下修理一把旧伞，没有及时告知她。妹妹后来自己取走了行李。',
      secret:'留下修的其实是已故父亲的伞，他还没准备好向旁人解释。只知道妹妹说过“今天想一个人待会儿”，不知道她是否愿意见面。'
    },
    {
      id:'wen',name:'温芷',role:'送茶样的焙茶师',
      public:'提着标好批次的茶样，准备核对送货数量。她习惯先问口味，再谈贵贱。',
      goal:'核清今天的茶样清单，午前回作坊照看新一炉茶。',
      history:'按这间茶铺的到货清单送来试饮茶样；熟悉茶叶产地、价格和冲泡方式，与乔安兄妹没有私交。',
      secret:'这批焙火较轻的茶是她第一次独立完成，她担心评价，但不会谎称其产地或品质。不知道乔安为何失约，也不知道他妹妹的口味。'
    },
    {
      id:'shi',name:'石岚',role:'隔壁刻字铺的店主',
      public:'来问能否买一杯热茶，手里拿着待送的木牌。她愿意聊天，也会直说现在没有空。',
      goal:'买杯茶暖手，按时把木牌送到街尾的新店。',
      history:'在这条街做了多年刻字生意，认得乔安是修伞匠，仅有几次普通买卖往来。',
      secret:'今天是她和旧搭档分开经营满一年，她不想在新店开张时谈自己的旧事。不知道乔安兄妹昨天发生了什么，也不会凭表情猜中。'
    }
  ],
  opening:'开业第一天，门口的木牌还带着新漆味。水壶将沸，柜台上三只茶罐排得齐整，价签旁留着一小块空地方。\n\n一个袖口缠着线头的男人停在门边。“我想买点茶，送给一个被我失约的人。”他看看价签，没有伸手拿东西。“算是道歉吧。但我不知道，她现在愿不愿意见我。”\n\n送茶样的温芷把清单放到柜台另一端：“先看口味也行，不一定要买最贵的。”她还等着核对数量。隔壁的石岚探进头来，问一杯热茶多少钱，手里的木牌仍用布包着。\n\n男人往旁边让了让，没有催你。在这座城里，真话可以只说一半，也可以暂时不说。你可以接着问、只介绍茶，或先处理清单和热水；这份道歉不必由你接手。',
  openingPreview:'“算是道歉吧。但我不知道，她现在愿不愿意见我。”',
  location:'真话城 · 新开的茶铺',identity:'开业第一天的茶铺店主',
  goal:'按自己的方式照看茶铺，决定愿意参与眼前的小事到哪一步。',
  seed:'在不能有意说出违背自己信念的话的城市，茶铺开业首日遇到一位想买道歉礼物的顾客。',
  custom:false,demoCompatible:false,
  narrative:{perspective:'第二人称',length:'适中',style:'具体、温和而克制，保留沉默与误会，不替玩家许诺',pace:'从容'},
  experience:{
    promise:'做一壶茶，听一句不容易说出口的话，决定一位店主愿意帮到哪里。',
    premise:'你是茶铺店主，今天第一天营业。城里的人不能故意说出违背自身信念的话，却仍会误会，也有权沉默。你尚未接受委托或卖出这份礼物。',
    pressure:'第一位顾客想买茶道歉，迟迟拿不定主意；送货清单和另一杯热茶也等着处理，没有必须替他解决的任务。',
    participation:'他把买茶的请求带到你的柜台。你可以帮他挑茶、询问需要，或只处理店里的日常。',
    possibilities:['介绍茶的口味与价格，让顾客自己选择','问他希望这份礼物传达什么，允许他不答','先核对清单、招待另一位客人，不介入道歉'],
    closure:'卖出一份双方确认的茶、帮顾客说清一句话，或平静地送他离开，都能为开业的这一小段收尾。'
  }
}];
