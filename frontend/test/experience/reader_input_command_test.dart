import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/reader_input_command.dart';

void main() {
  test('only exact source commands bypass story input', () {
    expect(readerInputCommand('请继续读！！')?.action, 'continue');
    expect(readerInputCommand('保存为：码头重逢')?.value, '码头重逢');
    expect(readerInputCommand('把字号调大一点')?.value, '2');
    expect(readerInputCommand('换成夜间模式')?.value, 'dark');
    expect(readerInputCommand('打开历史')?.action, 'history');
    for (final text in [
      '他说“继续读”',
      '可以把字调大一点吗？',
      '我查看人物的来信',
      '继续读，然后离开',
      '保存为',
      '请打开历史',
    ]) {
      expect(readerInputCommand(text), isNull, reason: text);
    }
  });
}
