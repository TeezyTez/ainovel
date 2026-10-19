// Exact presentation-only grammar from src/rich-request.js. Quoted dialogue,
// hypothetical questions and mixed story actions deliberately stay in the story.
String? readerRichRequest(String input, {bool hasArtifact = false}) {
  if (input.length > 2000) return null;
  final text = input.trim();
  final s = text
      .replaceFirst(RegExp(r'[。！？!?]+$'), '')
      .replaceFirst(RegExp(r'^请'), '');
  bool matches(String pattern, String value, {bool insensitive = false}) =>
      RegExp(pattern, caseSensitive: !insensitive).hasMatch(value);
  if (s.isEmpty ||
      matches(r'''[\n“”「」『』"'；;]''', s) ||
      matches(
        r'(?:然后|之后|并且|接着|(?:再|并|就)(?:去|问|找|走|调查|前往|出发|告诉|交给)|如果|假如|要是|是否|是不是|会不会|会怎样|会怎么样|会发生什么|会有什么|[吗么]$)',
        s,
      ))
    return null;
  const format =
      r'(?:表格|比较表|对照表|人物关系|关系图|流程图|路线图|示意图|SVG|图像|插画|柱状图|数据图|时间线|卡片|面板|试算|滑块|(?:可交互|可操作).*(?:工具|界面))';
  final request = s.replaceFirst(RegExp(r'^(?:帮我|给我|我想(?:要)?)'), '');
  final surface = RegExp(
    r'^(?:把|给)?(?:这个|这张|这幅|当前的|刚才的)(关系图|路线图|流程图|图|界面|面板|表格|卡片)(.*)$',
  ).firstMatch(request);
  final change = surface?.group(2) ?? request;
  final refinement =
      matches(r'^只显示[^，,。！？!?：:]{1,80}$', change) ||
      matches(
        r'^(?:不要|别)显示[^，,。！？!?：:]{0,80}(?:项|信息|线索|记录|数值|字段|列|行)$',
        change,
      ) ||
      matches(r'^按(?:时间|名称|类别|人物|来源)(?:升序|降序)?排序$', change) ||
      surface != null &&
          (matches(r'^(?:里|中)?的(?:文字|字体|字)(?:放大|缩小)(?:一点)?$', change) ||
              matches(r'^看不清[，,]\s*(?:文字|字体|字)(?:大|放大)(?:一点)?$', change) ||
              surface.group(1) == '表格' &&
                  matches(r'^(?:加|增加|添加)一列[^，,。！？!?：:]{1,20}$', change));
  if (hasArtifact && refinement) return text;
  if (matches(r'(?:不要|别(?:画|把|给|做|改|加|放|生成|绘))', s)) return null;
  final presentation =
      matches(r'^(?:画|绘制|生成|展示|显示|整理成|做成|做个|做一(?:个|张)|看看|看一下)', request) ||
      matches(r'^把.+(?:画成|绘制成|整理成|做成|转换成|列成|显示成)', request) ||
      matches(r'^(?:用|以).{0,20}(?:比较|对比|整理|显示|展示|列出|梳理|描绘|画出|呈现)', request);
  final followup = RegExp(
    r'^(?:把)?(?:这个|这张|这幅|当前的|刚才的)(关系图|路线图|流程图|图|界面|面板|表格|卡片)?(?:改成|变成|转换成|放大|缩小|加上|加入|增加|添加|调整|修改)([^，,。！？!?：:]*)$',
  ).firstMatch(request);
  if (hasArtifact &&
      followup != null &&
      (followup.group(1) != null ||
          matches(format, followup.group(2)!, insensitive: true) ||
          matches(r'^(?:按人|按类别|按时间|分组|排序|筛选|横向|纵向)', followup.group(2)!)))
    return text;
  if (matches(
    r'^(?:比较|对比)(?:一下)?(?:(?:这几条|这些|两条|两种|几条|几种)[^，,。！？!?：:]*(?:路线|道路|方案|路)|[^，,。！？!?：:]{1,20}(?:路线|路)(?:和|与)[^，,。！？!?：:]{1,20}(?:路线|路))$',
    request,
  ))
    return text;
  if (const [
        '智能交互',
        '智能整理当前处境',
        '关系图',
        '流程图',
        '比较表',
        '时间线',
        'SVG示意图',
      ].contains(s) ||
      presentation && matches(format, s, insensitive: true))
    return text;
  return null;
}
