import 'experience_models.dart';

/// Port of src/interaction-context.js interactionQuery, preserving its narrow
/// local-query grammar so quoted dialogue and compound actions reach the model.
Json? readerContextQuery(String input) {
  const filters = {
    '人物': 'person',
    '人物资料': 'person',
    '线索': 'clue',
    '物品': 'item',
    '背包': 'item',
    '地点': 'location',
    '资源': 'resource',
    '约定': 'agreement',
    '事件': 'event',
    '经历': 'event',
    '事实': 'fact',
  };
  final s = input
      .trim()
      .replaceFirst(RegExp(r'^请'), '')
      .replaceFirst(RegExp(r'[。！？!?]$'), '');
  bool matches(String pattern) => RegExp(pattern).hasMatch(s);
  if (matches('[\n“”「」『』"，,；;]')) return null;
  if (filters.containsKey(s)) return {'kind': 'list', 'filter': filters[s]};
  if (matches(r'^(?:查看|显示|打开|看看)?(?:人物关系|人物关系图|关系图)$'))
    return {'kind': 'relationships', 'filter': 'person'};
  if (matches(r'^(?:查看|显示|打开|看看)?(?:时间线|大事记|约定与时间)$'))
    return {'kind': 'timeline'};
  final presentation = RegExp(
    r'^(?:用|以)(表格|卡片|关系图|时间线)(?:形式)?(?:显示|展示|列出)?(.+)$',
  ).firstMatch(s);
  if (presentation != null) {
    final type = presentation[1],
        target = presentation[2]!.replaceFirst(RegExp(r'^我的'), '');
    if (filters.containsKey(target))
      return {
        'kind': type == '关系图'
            ? 'relationships'
            : type == '时间线'
            ? 'timeline'
            : 'list',
        'filter': filters[target],
        'view': {
          '表格': 'table',
          '卡片': 'cards',
          '关系图': 'auto',
          '时间线': 'auto',
        }[type],
      };
  }
  final display = matches(r'(?:然后|之后|后去|并且|再去)')
      ? null
      : RegExp(r'^(?:显示|给我看看)(?:我的)?([^。！？!?]{1,60})$').firstMatch(s);
  if (display != null)
    return {
      'kind': 'list',
      if (filters.containsKey(display[1]))
        'filter': filters[display[1]]
      else
        'query': display[1],
    };
  if (matches(r'^(?:我身上有什么|我带了什么|我的背包里有什么)$'))
    return {'kind': 'list', 'filter': 'item'};
  final owned = RegExp(
    r'^(?:我|现在|目前)?(?:有|持有)?(?:哪些|什么)(物品|线索|约定|资源|人物)$',
  ).firstMatch(s);
  if (owned != null) return {'kind': 'list', 'filter': filters[owned[1]]};
  if (matches(
    r'^(我现在怎么样|我现在的情况|现在什么情况|看看现在的情况|我在哪|我在哪里|当前处境|查看情况|看看情况|查看我的状态)$',
  ))
    return {'kind': 'overview'};
  if (matches(r'^(现在几点|现在是什么时候|故事时间|查看时间|查看时间线|查看约定和时间)$'))
    return {'kind': 'timeline'};
  if (matches(r'^(比较|对比|对照)(一下)?(这两个|这两项|这两条|选中的资料|已选资料)$'))
    return {'kind': 'compare'};
  final compare = RegExp(
    r'^(?:比较|对比|对照)([^，。！？“”「」\n]{1,100})(?:和|与)([^，。！？“”「」\n]{1,100})$',
  ).firstMatch(s);
  if (compare != null)
    return {
      'kind': 'compare',
      'names': [compare[1], compare[2]],
    };
  final list = RegExp(r'^(?:查看|看看|显示|打开)(?:有哪些|已知的|已知)?(.+)$').firstMatch(s);
  if (list != null && filters.containsKey(list[1]))
    return {'kind': 'list', 'filter': filters[list[1]]};
  final named = RegExp(
    r'^(?:查看|看看)([^，。！？“”「」\n]{1,100})的(?:资料|记录|情况)$',
  ).firstMatch(s);
  if (named != null) return {'kind': 'list', 'query': named[1]};
  return null;
}
