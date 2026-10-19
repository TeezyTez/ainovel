/// Exact local commands from reader-input.js/local-commands.js.
/// Story time and epilogue controls require the formal operation contract.
class ReaderInputCommand {
  const ReaderInputCommand(this.action, {this.value});
  final String action;
  final String? value;
}

ReaderInputCommand? readerInputCommand(String input) {
  final value = input.trim().replaceFirst(RegExp(r'[。！!]+$'), '');
  final explicit = value.replaceFirst(RegExp(r'^请'), '');
  const commands = {
    '继续': 'continue',
    '继续读': 'continue',
    '接着读': 'continue',
    '往下读': 'continue',
    '重试': 'retry',
    '重新发送': 'retry',
    '恢复进度': 'recover',
    '恢复已确认结果': 'recover',
    '核对进度': 'recover',
    '故事选项': 'tools',
    '更多选项': 'tools',
    '查看存档': 'branches',
    '查看分支': 'branches',
    '保存': 'save',
    '保存进度': 'save',
  };
  if (commands.containsKey(explicit))
    return ReaderInputCommand(commands[explicit]!);
  final named = RegExp(
    r'^保存为[：:\s]*(.{1,100})$',
    unicode: true,
  ).firstMatch(explicit);
  if (named != null) return ReaderInputCommand('save', value: named.group(1));
  if (RegExp(r'^(?:请)?(?:把)?(?:字|字号|字体)(?:调|变)?大(?:一点|些)?$').hasMatch(value))
    return const ReaderInputCommand('font', value: '2');
  if (RegExp(r'^(?:请)?(?:把)?(?:字|字号|字体)(?:调|变)?小(?:一点|些)?$').hasMatch(value))
    return const ReaderInputCommand('font', value: '-2');
  if (RegExp(r'^(?:打开|切换到|换成)?(?:深色|夜间)模式$').hasMatch(value))
    return const ReaderInputCommand('theme', value: 'dark');
  if (RegExp(r'^(?:打开|切换到|换成)?(?:浅色|日间)模式$').hasMatch(value))
    return const ReaderInputCommand('theme', value: 'light');
  const local = {
    '查看人物': 'information',
    '看看人物': 'information',
    '查看物品': 'information',
    '查看情况': 'information',
    '看看情况': 'information',
    '打开历史': 'history',
    '查看经历': 'history',
    '查看笔记': 'notes',
    '打开阅读设置': 'preferences',
    '怎么操作': 'help',
  };
  return local.containsKey(value) ? ReaderInputCommand(local[value]!) : null;
}
