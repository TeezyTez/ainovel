/// Public catalogue copy from the demo's worlds.js and situations.js.
/// This is only a starting-situation preview. Go owns formal story pages.
library;

import 'dart:convert';

class PortalWorldCharacter {
  const PortalWorldCharacter(this.name, this.publicDescription);

  final String name;
  final String publicDescription;
}

class PortalWorldData {
  const PortalWorldData({
    required this.description,
    required this.tags,
    required this.era,
    required this.opening,
    required this.rules,
    required this.characters,
    required this.identity,
    required this.location,
    required this.premise,
    required this.possibilities,
  });

  final String description;
  final List<String> tags;
  final String era;
  final String opening;
  final List<String> rules;
  final List<PortalWorldCharacter> characters;
  final String identity;
  final String location;
  final String premise;
  final List<String> possibilities;

  factory PortalWorldData.fromJson(Map<String, dynamic> value) => PortalWorldData(
    description: value['description'] as String,
    tags: List<String>.from(value['tags'] as List),
    era: value['era'] as String,
    opening: value['opening'] as String,
    rules: List<String>.from(value['rules'] as List),
    characters: [
      for (final raw in value['characters'] as List)
        PortalWorldCharacter(
          (raw as Map<String, dynamic>)['name'] as String,
          raw['publicDescription'] as String,
        ),
    ],
    identity: value['identity'] as String,
    location: value['location'] as String,
    premise: value['premise'] as String,
    possibilities: List<String>.from(value['possibilities'] as List),
  );
}

/// Only publicly shown fields were copied. NPC secrets/goals/histories are absent.
final Map<String, PortalWorldData> portalWorldDataById = {
  for (final raw in jsonDecode(_publicWorldJson) as List)
    (raw as Map<String, dynamic>)['id'] as String: PortalWorldData.fromJson(raw),
};

const _publicWorldJson = r'''[{"id":"fog-harbor","description":"回到一座靠潮水计时的港城。旧码头将被改建，旧朋友各有难处，而一封迟来的电报，让一段未被好好告别的往事重新有了下文。你可以调查，也可以先听人把话说完。","tags":["近代架空","港口生活","往事与关系"],"era":"近代架空的海港城市","opening":"你离开雾港的第七年，旧码头又响了一次钟。\n\n周泊把一封电报推到你面前。纸还潮着，发报人一栏却写着你的名字。“昨夜两点送来的。可你是今天早晨才下的船。”\n\n门外有人收起雨伞。林见微没有坐下：“在你拿着它去问别人之前，我想先确认一件事。你还记得，旧电报局为什么关门吗？”","rules":["没有已被证实的超自然现象；线索需要核实。","原始港务档案受保护，查阅需要登记与授权。","人物只知道亲历、获知或有证据支持的事情。"],"characters":[{"name":"林见微","publicDescription":"谨慎，重视职责。下班后要去接做复健的母亲。"},{"name":"周泊","publicDescription":"记得老住客喝茶的习惯，正在给漏雨的屋顶筹钱。"},{"name":"陈渡","publicDescription":"手上常有桐油味，每天下午去旧码头测水深。"}],"identity":"返回故乡的前电报员","location":"雾港 · 临潮旅馆","premise":"你曾是雾港电报员，离乡七年后返港。这是开局已确定的身份与经历；离乡原因、与谁亲近、是否追查都由你决定。","possibilities":["问清电报何时、由谁送到","听林见微说明旧电报局的情况","先在旅馆坐一会儿，让他人继续自己的事"]},{"id":"mountain","description":"你是初到山中的送信弟子。山上有术法，也有缺水的菜圃、迟到的工钱和不能轻许的承诺。送完一封信，未必比学会一道法术容易。","tags":["东方幻想","山中日常","承诺与代价"],"era":"人与术法共居的山中社会","opening":"午后的山道没有风，信封却在你掌心轻轻展开，像一片听见雨声的叶子。封面写着“何砚亲启”，纸上露出半句：西渠若仍不开……\n\n苏照从石阶下赶来，背篓里装着交接用的旧账。“先别把它按回去，折坏了术印，就说不清是谁开的。”她看了一眼天色，“我可以陪你查，但今日还得赶上下山的车。”","rules":["术法需要材料与练习，不能凭空满足任何愿望。","正式誓约必须明确同意，履约要付出约定的时间与劳作。","信中内容不因玩家读过就被其他人自动知晓。"],"characters":[{"name":"苏照","publicDescription":"做事利落，正在筹备一场长期请假。"},{"name":"何砚","publicDescription":"不擅说漂亮话，随身带着记水量的小册子。"},{"name":"陆迟","publicDescription":"修补信封上的术印，认真到有些固执。"}],"identity":"负责传递书信的外门弟子","location":"青岚山 · 山门石阶","premise":"你是负责传信的外门弟子，手中有一封写着“何砚亲启”的信；它自行展开。你尚未接受额外誓约，也未决定继续读信。","possibilities":["请苏照看看术印，先不继续读信","询问信件该如何妥善送达","暂缓调查，让苏照先安排她的行程"]},{"id":"thursday","description":"你临时接手一家旧书店。雨天的顾客、迟迟未整理的订书本、临近续约的房租，各自占据柜台的一角。这里没有必须拯救的世界，只有几个值得认真对待的人。","tags":["现代日常","成年人际","重新连接"],"era":"当代城市的一条旧街","opening":"星期四下午，雨刚好落在你翻转营业牌的时候。接手书店的第三天，你仍分不清哪盏灯的开关藏在哪个书架后面。\n\n一位穿灰色外套的女人收起伞，在柜台前等你放下胶带。“我来取那本书。”她说，“你答应替我留到今天。”\n\n你没有见过她。唐雨正在一旁收拾备考资料，抬头看了看墙上的钟。","rules":["这个世界没有超自然现象。","预留、付款与赠送需要当事人同意，不能替别人作承诺。","误会可以被解释，解释不保证立即获得原谅。"],"characters":[{"name":"许知秋","publicDescription":"在社区做口述记录，下周要去外地工作。"},{"name":"唐雨","publicDescription":"正在准备资格考试，对每本书的摆放都很熟悉。"},{"name":"高远","publicDescription":"替整条街收错送的快递，偶尔来借一把椅子。"}],"identity":"临时接手旧书店的店主","location":"旧街 · 星期四书店","premise":"你临时接手书店，今天是第三天。眼前的顾客你从未见过；她说有人替她留书，并不等于你已作过这项承诺。","possibilities":["请顾客描述书名和预留经过","在唐雨方便时核对交接记录","先请顾客稍候，按自己的节奏整理柜台"]},{"id":"truth-teahouse","description":"在一座无法故意说谎的城里，你的茶铺第一天开门。人们依然会误会、沉默，也会认真挑选一句愿意说出口的话。第一位顾客想带茶去道歉；你可以帮他选茶，听听他的困扰，或只照常做生意。","tags":["日常奇想","茶铺生活","表达与边界"],"era":"架空的当代小城","opening":"开业第一天，门口的木牌还带着新漆味。水壶将沸，柜台上三只茶罐排得齐整，价签旁留着一小块空地方。\n\n一个袖口缠着线头的男人停在门边。“我想买点茶，送给一个被我失约的人。”他看看价签，没有伸手拿东西。“算是道歉吧。但我不知道，她现在愿不愿意见我。”\n\n送茶样的温芷把清单放到柜台另一端：“先看口味也行，不一定要买最贵的。”她还等着核对数量。隔壁的石岚探进头来，问一杯热茶多少钱，手里的木牌仍用布包着。\n\n男人往旁边让了让，没有催你。在这座城里，真话可以只说一半，也可以暂时不说。你可以接着问、只介绍茶，或先处理清单和热水；这份道歉不必由你接手。","rules":["城中任何人（包括玩家）都无法有意说出违背自己当下信念的话；这不保证其信念正确，也不赋予任何人读心或辨认真相的能力。","人可以记错、误解、表达不完整、保持沉默或拒绝回答。沉默不等于承认；不能据此强制披露隐私。","人物只知道自己亲历、听闻或查证的事情；他人的秘密、动机与尚未发生的选择不会自动成为共同知识。","开场的顾客仅表达购买意向，尚未选定、付款或收下任何商品；成交、赠送、代送、代写署名与其他承诺都需明确同意。","玩家已确认的开局事实只有茶铺店主身份与开业第一天；不预设其曾经伤害谁、许过诺、与顾客相识或愿意介入私事。","道歉不保证获得原谅。人物可以改变想法或离开；玩家只卖茶、拒绝介入或暂时观察，都不会被叙述为失职。"],"characters":[{"name":"乔安","publicDescription":"说话慢，袖口留着缝伞线。他想挑一份道歉的礼物，进门时没有拿任何商品。"},{"name":"温芷","publicDescription":"提着标好批次的茶样，准备核对送货数量。她习惯先问口味，再谈贵贱。"},{"name":"石岚","publicDescription":"来问能否买一杯热茶，手里拿着待送的木牌。她愿意聊天，也会直说现在没有空。"}],"identity":"开业第一天的茶铺店主","location":"真话城 · 新开的茶铺","premise":"你是茶铺店主，今天第一天营业。城里的人不能故意说出违背自身信念的话，却仍会误会，也有权沉默。你尚未接受委托或卖出这份礼物。","possibilities":["介绍茶的口味与价格，让顾客自己选择","问他希望这份礼物传达什么，允许他不答","先核对清单、招待另一位客人，不介入道歉"]}]''';
