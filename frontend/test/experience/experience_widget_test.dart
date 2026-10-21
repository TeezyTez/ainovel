import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_models.dart';
import 'package:elselife_frontend/experience/experience_screen.dart';
import 'package:elselife_frontend/experience/experience_preferences_screen.dart';
import '../support/experience_fixture.dart';
import '../support/elselife_test_app.dart';

void main() {
  Future<ExperienceController> mount(
    WidgetTester tester, {
    bool long = false,
  }) async {
    final api = FakeExperienceApi();
    if (long) api.passage = List.filled(90, '长文阅读，雨声在屋檐下延续。').join('\n\n');
    final c = ExperienceController(
      session: testSession(),
      api: api,
      journal: MemoryJournal(),
    );
    await c.initialize();
    if (long) await c.open('experience-a', branch: 'main');
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox.shrink());
      c.dispose();
      c.session.dispose();
    });
    await tester.pumpWidget(
      elseLifeTestApp(
        home: ExperienceScreen(controller: c, onPreferences: () {}),
      ),
    );
    await tester.pumpAndSettle();
    return c;
  }

  testWidgets('选择 demo 世界只保存创建草稿，明确提交之前不创建经历', (tester) async {
    final c = await mount(tester);
    final api = c.api as FakeExperienceApi;
    final choice = find.byKey(const ValueKey('demo-world-fog-harbor'));
    await tester.ensureVisible(choice);
    await tester.tap(choice);
    await tester.pumpAndSettle();
    expect(c.draft, contains('雾港'));
    expect(c.current, isNull);
    expect(api.creates, isEmpty);
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('experience-input')))
          .controller!
          .text,
      c.draft,
    );
  });

  testWidgets('书架搜索只筛选可见经历，不修改正式书架', (tester) async {
    final c = await mount(tester);
    final search = find.byKey(const ValueKey('experience-shelf-search'));
    await tester.ensureVisible(search);
    await tester.enterText(search, '找不到');
    await tester.pumpAndSettle();
    expect(find.text('没有匹配的经历。'), findsOneWidget);
    expect(c.shelf.single.title, '测试经历');
    await tester.enterText(search, '测试');
    await tester.pumpAndSettle();
    expect(find.text('测试经历'), findsOneWidget);
    await tester.enterText(search, '找不到');
    await tester.pumpAndSettle();
    await c.open('experience-a');
    await tester.pumpAndSettle();
    await c.newSeed();
    await tester.pumpAndSettle();
    expect(find.text('测试经历'), findsOneWidget);
  });

  testWidgets('创建成功后正式act输入是空草稿而非seed值，已提交seed不复活', (tester) async {
    final c = await mount(tester);
    final input = find.byKey(const ValueKey('experience-input'));
    await tester.enterText(input, '雨后的小镇');
    await tester.pumpAndSettle();
    await tester.tap(find.text('进入世界'));
    await tester.pumpAndSettle();
    expect(c.current, isNotNull);
    expect(tester.widget<TextField>(input).controller!.text, isEmpty);
    await tester.enterText(input, '我问阿禾');
    await tester.pumpAndSettle();
    expect(c.draft, '我问阿禾');
    await c.cancel();
    await c.newSeed();
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(input).controller!.text, isEmpty);
  });

  testWidgets('复制 Markdown 只使用正式页且不提交新行动', (tester) async {
    final c = await mount(tester, long: true);
    final api = c.api as FakeExperienceApi;
    String? copiedMarkdown;
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') {
        copiedMarkdown =
            (call.arguments as Map<Object?, Object?>)['text'] as String?;
      }
      return null;
    });
    addTearDown(
      () => messenger.setMockMethodCallHandler(SystemChannels.platform, null),
    );
    await tester.tap(find.text('分支与历史'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('复制当前分支正文（Markdown）'));
    await tester.pumpAndSettle();
    expect(copiedMarkdown, contains(c.current!.pages.single.text));
    expect(api.sent, isEmpty);
  });

  testWidgets('中文composing CtrlEnter及按钮均不提交；Enter默认换行，不是聊天send', (
    tester,
  ) async {
    final c = await mount(tester);
    final api = c.api as FakeExperienceApi;
    final input = find.byKey(const ValueKey('experience-input'));
    await tester.tap(input);
    tester.testTextInput.updateEditingValue(
      const TextEditingValue(
        text: '中文输入',
        selection: TextSelection.collapsed(offset: 4),
        composing: TextRange(start: 0, end: 4),
      ),
    );
    await tester.pumpAndSettle();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.tap(find.text('进入世界'));
    await tester.pump();
    expect(api.creates, isEmpty);
    final field = tester.widget<TextField>(input);
    expect(field.textInputAction, TextInputAction.newline);
    tester.testTextInput.updateEditingValue(
      const TextEditingValue(
        text: '中文输入',
        selection: TextSelection.collapsed(offset: 4),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('进入世界'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(api.creates.single['seed'], '中文输入');
    expect(c.operation?.status, 'pending');
    await c.cancel(); // 此夹具的controller由外部owner持有，清理其轮询。
    await tester.pumpAndSettle();
  });
  testWidgets('移动长文、字号/位置保存；重绘与新正文不抢滚动或编辑焦点', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final c = await mount(tester, long: true);
    final input = find.byKey(const ValueKey('experience-input'));
    await tester.tap(input);
    await tester.enterText(input, '另一个念头');
    await tester.pumpAndSettle();
    final editable = tester.widget<EditableText>(
      find.byType(EditableText).first,
    );
    final element = tester.element(find.byType(EditableText).first);
    final scroll = tester
        .widget<Scrollbar>(find.byType(Scrollbar).first)
        .controller!;
    scroll.jumpTo(400);
    await tester.pumpAndSettle();
    expect(c.offset, 400);
    final readingAnchor = c.readingAnchor!.toJson();
    expect(editable.focusNode.hasFocus, isTrue);
    c.session.themeId = 'ink';
    await c.saveReading(size: 22);
    await tester.pumpAndSettle();
    expect(tester.element(find.byType(EditableText).first), same(element));
    expect(editable.focusNode.hasFocus, isTrue);
    expect(c.readingAnchor!.toJson(), readingAnchor);
    final afterFont = scroll.offset;
    expect(afterFont, greaterThan(400));
    expect(editable.controller.text, '另一个念头');
    await c.send();
    await tester.pumpAndSettle();
    expect(scroll.offset, closeTo(afterFont, 1));
    expect(editable.focusNode.hasFocus, isTrue);
    expect(tester.takeException(), isNull);
  });
  testWidgets('构造60页每页2000字长历史恢复位置，字号与新页不跳末尾', (tester) async {
    tester.view.physicalSize = const Size(800, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final text = ('雨停以后阿禾沿着旧路走回书铺。' * 134).substring(0, 2000);
    final pages = [
      for (var revision = 1; revision <= 60; revision++)
        {
          'revision': revision,
          'mode': 'read',
          'input': '',
          'text': text,
          'story_time': '长历史$revision',
          'created_at': '2026-10-13T00:00:00Z',
          'suggestions': <String>[],
          'outcome': 'continues',
        },
    ];
    expect(text.length, 2000);
    final api = FakeExperienceApi()
      ..viewOverride = {...testView(revision: 60), 'pages': pages};
    final journal = MemoryJournal();
    final c = ExperienceController(
      session: testSession(),
      api: api,
      journal: journal,
    );
    addTearDown(() {
      c.dispose();
      c.session.dispose();
    });
    await c.initialize();
    await c.open('experience-a');
    await c.saveReading(size: 18, position: 2600);
    await tester.pumpWidget(
      elseLifeTestApp(
        home: ExperienceScreen(controller: c, onPreferences: () {}),
      ),
    );
    await tester.pumpAndSettle();
    ScrollPosition position() => tester
        .widget<Scrollbar>(find.byType(Scrollbar).first)
        .controller!
        .position;
    expect(position().pixels, closeTo(2600, 1));
    expect(position().maxScrollExtent, greaterThan(10000));
    await tester.tap(find.byTooltip('增大阅读字号'));
    await tester.pumpAndSettle();
    final afterFont = position().pixels;
    expect(afterFont, greaterThan(2600));
    expect(c.readingAnchor, isNotNull);
    final readingAnchor = c.readingAnchor!.toJson();
    api.viewOverride = {
      ...api.viewOverride!,
      'revision': 61,
      'pages': [
        ...pages,
        {...pages.last, 'revision': 61},
      ],
    };
    await c.send(explicitMode: 'read');
    await tester.pumpAndSettle();
    expect(position().pixels, closeTo(afterFont, 1));
    expect(c.readingAnchor!.toJson(), readingAnchor);
    await c.saveReading(position: afterFont);
    await tester.pumpWidget(const SizedBox.shrink());
    await c.open('experience-a');
    await tester.pumpWidget(
      elseLifeTestApp(
        home: ExperienceScreen(controller: c, onPreferences: () {}),
      ),
    );
    await tester.pumpAndSettle();
    expect(c.fontSize, 19);
    expect(position().pixels, closeTo(afterFont, 1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('已知资料正文是可访问静态文字而非无label输入，关系同样可读', (tester) async {
    final semantics = tester.ensureSemantics();
    final c = await mount(tester, long: true);
    c.current = ExperienceView({
      ...testView(),
      'information': [
        {
          'id': 'belief',
          'kind': 'belief',
          'name': '人物相信',
          'text': '阿禾相信井下空无一物（这是错误信念，不是世界真相）',
          'related_ids': ['npc'],
        },
        {
          'id': 'public',
          'kind': 'fact',
          'name': '事实',
          'text': '书铺今日照常开门',
          'related_ids': <String>[],
        },
        {
          'id': 'npc',
          'kind': 'person',
          'name': '阿禾',
          'text': '旧书铺守门人；拒绝也是正式故事结果。',
          'related_ids': ['belief'],
        },
      ],
    });
    await c.saveReading(size: c.fontSize);
    await tester.pumpAndSettle();
    await tester.tap(find.text('已知资料'));
    await tester.pumpAndSettle();
    for (final item in c.current!.information) {
      final data = tester.getSemantics(find.text(item.text)).getSemanticsData();
      expect(data.label, contains(item.text));
      expect(data.label.split(item.text), hasLength(2), reason: '正文仅朗读一次');
      expect(data.value, isEmpty);
    }
    expect(
      tester.getSemantics(find.text('关联：阿禾')).getSemanticsData().label,
      contains('关联：阿禾'),
    );
    expect((c.api as FakeExperienceApi).sent, isEmpty);
    semantics.dispose();
  });

  testWidgets('资料展开没有POST，取消接手状态可见，草稿保留', (tester) async {
    final c = await mount(tester, long: true);
    final api = c.api as FakeExperienceApi;
    await tester.tap(find.text('已知资料'));
    await tester.pumpAndSettle();
    expect(find.text('正在下雨'), findsOneWidget);
    expect(api.sent, isEmpty);
    Navigator.of(tester.element(find.text('正在下雨'))).pop();
    await tester.pumpAndSettle();
    api.status = 'generating';
    await c.saveDraft('准备接手');
    await c.send();
    await tester.pump();
    expect(find.text('故事正在继续'), findsOneWidget);
    await tester.ensureVisible(find.byTooltip('停止生成'));
    await tester.tap(find.byTooltip('停止生成'));
    await tester.pumpAndSettle();
    expect(find.text('已停止，输入已保留。'), findsOneWidget);
    expect(c.draft, '准备接手');
    expect(api.cancels, 1);
  });
  testWidgets('本地seed存失败可见且可编辑；没有示例小说', (tester) async {
    final c = await mount(tester, long: false);
    final j = c.journal as MemoryJournal;
    j.failWrite = true;
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '世界仍在',
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('草稿未能保存到本机'), findsOneWidget);
    expect((c.api as FakeExperienceApi).creates, isEmpty);
  });
  testWidgets('大字号移动键盘与模型不可用可见，不以示例正文补缺口', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(() {
      tester.view.reset();
      tester.platformDispatcher.clearTextScaleFactorTestValue();
    });
    final c = await mount(tester, long: true);
    c.operation = ExperienceOperation({
      ...testOperation('none', status: 'failed'),
      'error_code': 'model_unavailable',
    });
    await c.saveReading(size: c.fontSize);
    await tester.pumpAndSettle();
    expect(find.textContaining('模型暂不可用'), findsOneWidget);
    tester.view.viewInsets = const FakeViewPadding(bottom: 280);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('偏好冲突保留草稿，重读后明确重交使用当前五字段expected', (tester) async {
    final api = FakeExperienceApi();
    final original = <String, dynamic>{
      'dimension': '节奏',
      'value': '慢',
      'source': 'explicit',
      'evidence': '原表达',
      'version': 'v1',
    };
    api.prefs = [original];
    final c = ExperienceController(
      session: testSession(),
      api: api,
      journal: MemoryJournal(),
    );
    addTearDown(() {
      c.dispose();
      c.session.dispose();
    });
    await tester.pumpWidget(
      elseLifeTestApp(home: ExperiencePreferencesScreen(controller: c)),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('节奏'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('preference-value')), '快一些');
    api.conflict = true;
    await tester.tap(find.text('保存明确偏好'));
    await tester.pumpAndSettle();
    expect(api.changes.single['expected'], original);
    expect(find.textContaining('拟保存：快一些'), findsOneWidget);
    final newer = <String, dynamic>{
      ...original,
      'value': '适中',
      'version': 'v2',
    };
    api.prefs = [newer];
    api.conflict = false;
    await tester.tap(find.text('重新读取 / 核对保存'));
    await tester.pumpAndSettle();
    expect(find.textContaining('拟保存：快一些'), findsOneWidget);
    expect(api.changes, hasLength(1));
    await tester.tap(find.text('核对后以当前版本保存草稿'));
    await tester.pumpAndSettle();
    expect(api.changes, hasLength(2));
    expect(api.changes.last['expected'], newer);
    expect((api.changes.last['expected'] as Map).keys.toSet(), {
      'dimension',
      'value',
      'source',
      'evidence',
      'version',
    });
    expect(api.prefs.single['value'], '快一些');
    expect(find.textContaining('保留的待确认草稿：'), findsNothing);
  });

  testWidgets('偏好保存前切换backend阻止跨workspace发送，草稿留在原scope', (tester) async {
    final api = FakeExperienceApi();
    final journal = MemoryJournal();
    final c = ExperienceController(
      session: testSession(),
      api: api,
      journal: journal,
    );
    addTearDown(() {
      c.dispose();
      c.session.dispose();
    });
    await tester.pumpWidget(
      elseLifeTestApp(home: ExperiencePreferencesScreen(controller: c)),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('添加明确内容偏好'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('preference-value')), '原工作区草稿');
    journal.gate = Completer<void>();
    await tester.tap(find.text('保存明确偏好'));
    await tester.pump();
    expect(api.changes, isEmpty);
    c.session.backendUrl = 'https://other.test';
    await tester.pump();
    journal.gate!.complete();
    await tester.pumpAndSettle();
    expect(api.changes, isEmpty);

    await tester.pumpAndSettle();
    expect(find.textContaining('拟保存：原工作区草稿'), findsNothing);
    c.session.backendUrl = 'https://world.test';
    await tester.pumpAndSettle();
    expect(find.textContaining('拟保存：原工作区草稿'), findsOneWidget);
    expect(api.changes, isEmpty);
  });

  testWidgets('本次正文输入与虚构对白不写长期偏好，反馈原文不跨backend', (tester) async {
    final c = await mount(tester, long: true);
    final api = c.api as FakeExperienceApi;
    await tester.enterText(
      find.byKey(const ValueKey('experience-input')),
      '只这一次温柔些；角色说“我喜欢冒险”',
    );
    await tester.pumpAndSettle();
    await c.send();
    expect(api.sent.single['input'], '只这一次温柔些；角色说“我喜欢冒险”');
    expect(api.changes, isEmpty);
    expect(api.prefs, isEmpty);
    await tester.pumpWidget(
      elseLifeTestApp(home: ExperiencePreferencesScreen(controller: c)),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('reader-feedback-text')),
      '我的原反馈',
    );
    await tester.pumpAndSettle();
    c.session.backendUrl = 'https://other.test';
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('reader-feedback-text')))
          .controller!
          .text,
      isEmpty,
    );
    c.session.backendUrl = 'https://world.test';
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('reader-feedback-text')))
          .controller!
          .text,
      '我的原反馈',
    );
    expect(api.changes, isEmpty);
  });

  for (final failure in ['network', 'storage-after-write']) {
    testWidgets('偏好$failure结果未知不丢待确认稿、不自动重试', (tester) async {
      final api = FakeExperienceApi();
      final journal = MemoryJournal();
      final c = ExperienceController(
        session: testSession(),
        api: api,
        journal: journal,
      );
      addTearDown(() {
        c.dispose();
        c.session.dispose();
      });
      await tester.pumpWidget(
        elseLifeTestApp(home: ExperiencePreferencesScreen(controller: c)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('添加明确内容偏好'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('preference-value')),
        '我明确要保留的原句',
      );
      api.preferenceTimeout = failure == 'network';
      if (failure == 'storage-after-write') {
        api.afterPreferenceWrite = () => journal.failWrite = true;
      }
      await tester.tap(find.text('保存明确偏好'));
      await tester.pumpAndSettle();
      expect(api.changes, hasLength(1));
      expect(find.textContaining('保存结果未确认'), findsOneWidget);
      expect(find.textContaining('拟保存：我明确要保留的原句'), findsOneWidget);
      expect(
        tester
            .widget<TextButton>(find.widgetWithText(TextButton, '核对后以当前版本保存草稿'))
            .onPressed,
        isNull,
      );
      expect(journal.rows.values.single['change'], isNotNull);
      await tester.pump(const Duration(seconds: 2));
      expect(api.changes, hasLength(1));
      journal.failWrite = false;
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpWidget(
        elseLifeTestApp(home: ExperiencePreferencesScreen(controller: c)),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('拟保存：我明确要保留的原句'), findsOneWidget);
      expect(api.changes, hasLength(1));
    });
  }

  testWidgets('反馈理解只给候选不自动写，编辑后明确确认才保存', (tester) async {
    tester.view.physicalSize = const Size(1100, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = FakeExperienceApi()
      ..interpretation = {
        'status': 'draft',
        'explanation': '两个可选表达',
        'proposals': [
          {
            'dimension': '节奏',
            'value': '慢一点',
            'explanation': '只在本次',
            'quote': '今天想温柔些但别替我定性',
          },
          {
            'dimension': '情绪',
            'value': '温柔',
            'explanation': '候选不是人格',
            'quote': '今天想温柔些但别替我定性',
          },
        ],
      };
    final c = ExperienceController(
      session: testSession(),
      api: api,
      journal: MemoryJournal(),
    );
    addTearDown(() {
      c.dispose();
      c.session.dispose();
    });
    await tester.pumpWidget(
      elseLifeTestApp(home: ExperiencePreferencesScreen(controller: c)),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('reader-feedback-text')),
      '今天想温柔些但别替我定性',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('可选：让服务端解读（最多一次）'));
    await tester.pumpAndSettle();
    expect(api.changes, isEmpty);
    await tester.tap(find.text('纠正并确认今后口味').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('preference-value')), '温柔但不迁就');
    expect(api.changes, isEmpty);
    await tester.tap(find.text('保存明确偏好'));
    await tester.pumpAndSettle();
    expect(api.changes.single['expression'], '今天想温柔些但别替我定性');
    expect(api.changes.single['value'], '温柔但不迁就');
    expect(api.changes.single['confirmation'], 'accepted_model_draft');
    expect(api.prefs.single['source'], 'explicit');
  });

  testWidgets('本地工作区明确偏好能添加/移除，全量PUT不用故事操作', (tester) async {
    final c = ExperienceController(
      session: testSession(),
      api: FakeExperienceApi(),
      journal: MemoryJournal(),
    );
    addTearDown(() {
      c.dispose();
      c.session.dispose();
    });
    await tester.pumpWidget(
      elseLifeTestApp(home: ExperiencePreferencesScreen(controller: c)),
    );
    await tester.pumpAndSettle();
    expect(find.text('还没有内容偏好。这是合法起点。'), findsOneWidget);
    await tester.tap(find.text('添加明确内容偏好'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('preference-value')), '轻松的日常');
    await tester.tap(find.text('保存明确偏好'));
    await tester.pumpAndSettle();
    final api = c.api as FakeExperienceApi;
    expect(api.prefs.single['source'], 'explicit');
    expect(api.prefs.single['value'], '轻松的日常');
    await tester.tap(find.byTooltip('移除 内容风格'));
    await tester.pumpAndSettle();
    expect(api.prefs, isEmpty);
    expect(api.sent, isEmpty);
    // Keyed change, never a whole-list rewrite with implicit source promotion.
    expect(api.changes, hasLength(2));
    expect(api.changes.first['dimension'], '内容风格');
    expect(api.changes.first['expected'], isNull);
    expect(api.changes.first['value'], '轻松的日常');
    expect(api.changes.first.containsKey('preferences'), isFalse);
    expect(api.changes.last['dimension'], '内容风格');
    expect(api.changes.last['value'], isNull);
    expect(api.changes.last['expected'], isNotNull);
  });
}
