/// Synthetic Flutter layout events, not physical device or model-quality tests.
library;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/experience_controller.dart';
import 'package:elselife_frontend/experience/experience_screen.dart';
import 'package:elselife_frontend/experience/reader_reading_anchor.dart';
import 'package:elselife_frontend/experience/experience_journal.dart';
import 'package:elselife_frontend/portal/portal_preferences.dart';
import '../support/experience_fixture.dart';
import '../support/elselife_test_app.dart';

class _CountingJournal extends MemoryJournal {
  int writes = 0;

  @override
  Future<void> patch(String scope, Map<String, dynamic> values) {
    writes++;
    return super.patch(scope, values);
  }
}

RenderBox textRender(WidgetTester tester, String text) {
  RenderBox? result;
  void visit(RenderObject render) {
    if (render is RenderParagraph && render.text.toPlainText() == text ||
        render is RenderEditable && render.text?.toPlainText() == text) {
      result = render as RenderBox;
      return;
    }
    render.visitChildren(visit);
  }

  visit(tester.binding.renderView);
  return result!;
}

TextPosition atPoint(RenderBox render, Offset global) =>
    render is RenderEditable
    ? render.getPositionForPoint(global)
    : (render as RenderParagraph).getPositionForOffset(
        render.globalToLocal(global),
      );

double caretY(RenderBox render, TextPosition position) => render
    .localToGlobal(
      render is RenderEditable
          ? render.getLocalRectForCaret(position).topLeft
          : (render as RenderParagraph).getOffsetForCaret(position, Rect.zero),
    )
    .dy;

void main() {
  test(
    'SYS-025-H2: source identity survives insertion but rejects ambiguous or replaced prose',
    () {
      const source = '开头。\n\n需要继续阅读的旧段落。\n\n结尾。';
      final start = source.indexOf('需要');
      final end = source.indexOf('\n\n结尾');
      final anchor = ReaderReadingAnchor(
        revision: 12,
        pageText: source,
        sourceOffset: start + 3,
        segmentStart: start,
        segmentEnd: end,
        viewportY: -4,
      );
      expect(anchor.resolve(source), start + 3);
      expect(
        anchor.resolve('新增开头。\n\n${source.substring(start)}'),
        '新增开头。\n\n'.length + 3,
      );
      expect(anchor.resolve('同一页号，但正文已全部替换。'), isNull);
      final paragraph = source.substring(start, end);
      expect(anchor.resolve('$paragraph\n\n$paragraph'), isNull);
      expect(
        ReaderReadingAnchor.parse(anchor.toJson())!.toJson(),
        anchor.toJson(),
      );
      expect(
        () => LocalExperienceJournal.validateWorkspaceBackup({
          '["experience-a","main"]': {
            'reading_anchor': {...anchor.toJson(), 'source_offset': -1},
          },
        }),
        throwsFormatException,
      );
    },
  );

  test(
    'SYS-019/SYS-029: reading anchors are local and isolated by branch',
    () async {
      final api = FakeExperienceApi();
      final controller = ExperienceController(
        session: testSession(),
        api: api,
        journal: MemoryJournal(),
      );
      await controller.initialize();
      await controller.open('experience-a');
      const anchor = ReaderReadingAnchor(
        revision: 1,
        pageText: '已提交的原文。',
        sourceOffset: 3,
        segmentStart: 0,
        segmentEnd: 7,
        viewportY: 0,
      );
      await controller.saveReading(
        position: 120,
        anchor: anchor,
        updateAnchor: true,
      );
      await controller.open('experience-a', branch: 'other');
      expect(controller.readingAnchor, isNull);
      expect(controller.offset, 0);
      await controller.open('experience-a', branch: 'main');
      expect(controller.readingAnchor?.toJson(), anchor.toJson());
      expect(api.sent, isEmpty);
      controller.dispose();
      controller.session.dispose();
    },
  );

  testWidgets(
    'SYS-025-H2: replaced source explains fallback instead of reusing the old ordinal',
    (tester) async {
      final api = FakeExperienceApi()..passage = '完全不同的正文。' * 100;
      final journal = MemoryJournal();
      final controller = ExperienceController(
        session: testSession(),
        api: api,
        journal: journal,
      );
      await controller.initialize();
      await controller.open('experience-a');
      const anchor = ReaderReadingAnchor(
        revision: 1,
        pageText: '原先独有的段落。',
        sourceOffset: 3,
        segmentStart: 0,
        segmentEnd: 8,
        viewportY: 0,
      );
      await controller.saveReading(
        position: 400,
        anchor: anchor,
        updateAnchor: true,
      );
      await tester.pumpWidget(
        elseLifeTestApp(
          home: ExperienceScreen(controller: controller, onPreferences: () {}),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('原阅读位置的文字已变化或无法唯一定位，已回到当前分支开头。'), findsOneWidget);
      expect(controller.offset, 0);
      // A later layout may record the new beginning. It must never retain the
      // old text or restore the unrelated third character at the same ordinal.
      final freshAnchor = controller.readingAnchor;
      if (freshAnchor != null) {
        expect(freshAnchor.pageText, api.passage);
        expect(freshAnchor.sourceOffset, 0);
      }
      final saved = ReaderReadingAnchor.parse(
        (await journal.read(controller.scope))['reading_anchor'],
      );
      if (saved != null) {
        expect(saved.pageText, api.passage);
        expect(saved.sourceOffset, 0);
      }
      expect(api.sent, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
      controller.dispose();
      controller.session.dispose();
    },
  );

  for (final portal in [false, true]) {
    testWidgets(
      'SYS-025-H2: ${portal ? 'portal' : 'basic'} keeps original text at viewport after reflow and reopening',
      (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final text = List.generate(
          90,
          (i) => '第${i.toString().padLeft(3, '0')}句话：阿禾沿着雨后的街道走向旧书铺，脚边有一片金色落叶。',
        ).join();
        final api = FakeExperienceApi()..passage = text;
        final journal = MemoryJournal();
        final controller = ExperienceController(
          session: testSession(),
          api: api,
          journal: journal,
        );
        final appearance = PortalPreferences(
          journal: journal,
          backendUrl: controller.session.backendUrl,
          workspaceId: controller.session.workspaceId,
        );
        await appearance.hydrate();
        await controller.initialize();
        await controller.open('experience-a');
        Widget screen() => elseLifeTestApp(
          home: ExperienceScreen(
            controller: controller,
            onPreferences: () {},
            onPortalHome: portal ? () {} : null,
            preferences: appearance,
            generativeUiEnabled: false,
          ),
        );
        await tester.pumpWidget(screen());
        await tester.pumpAndSettle();
        ScrollController scroll() =>
            tester.widget<Scrollbar>(find.byType(Scrollbar).first).controller!;
        scroll().jumpTo(700);
        await tester.pumpAndSettle();
        final render = textRender(tester, text);
        Rect readingViewport() => tester.getRect(
          find.byWidgetPredicate(
            (widget) =>
                widget is SingleChildScrollView &&
                widget.controller == scroll(),
          ),
        );
        final viewport = readingViewport();
        final point = Offset(
          render.localToGlobal(Offset.zero).dx + 2,
          viewport.top + 10,
        );
        final originalPosition = atPoint(render, point);
        final originalY = caretY(render, originalPosition);
        expect(controller.readingAnchor?.sourceOffset, originalPosition.offset);
        expect(
          controller.readingAnchor?.viewportY,
          closeTo(originalY - viewport.top, 1),
        );
        expect(originalPosition.offset, greaterThan(100));
        if (portal) {
          await appearance.setValue('fontSize', 26.0);
          await appearance.setValue('lineHeight', 2.4);
        } else {
          await controller.saveReading(size: 27);
        }
        await tester.pumpAndSettle();
        expect(
          caretY(textRender(tester, text), originalPosition),
          closeTo(originalY, 2),
          reason:
              'The same source character remains visible; pixel offset alone is not a reading anchor.',
        );
        final afterSizeY =
            caretY(textRender(tester, text), originalPosition) -
            readingViewport().top;
        tester.view.physicalSize = const Size(768, 844);
        await tester.pumpAndSettle();
        expect(
          caretY(textRender(tester, text), originalPosition) -
              readingViewport().top,
          closeTo(afterSizeY, 2),
        );
        // Reopening the same branch while mounted must finish restoration,
        // otherwise a later font change silently loses the source location.
        await controller.open('experience-a');
        await tester.pumpAndSettle();
        final beforeSameScopeReflow = caretY(
          textRender(tester, text),
          originalPosition,
        );
        if (portal) {
          await appearance.setValue('fontSize', 21.0);
        } else {
          await controller.saveReading(size: 22);
        }
        await tester.pumpAndSettle();
        expect(
          caretY(textRender(tester, text), originalPosition),
          closeTo(beforeSameScopeReflow, 2),
          reason:
              'Reopening the mounted branch must not leave restoration locked.',
        );
        final beforeClose = caretY(textRender(tester, text), originalPosition);
        await tester.pumpWidget(const SizedBox.shrink());
        await controller.open('experience-a');
        await tester.pumpWidget(screen());
        await tester.pumpAndSettle();
        expect(
          caretY(textRender(tester, text), originalPosition),
          closeTo(beforeClose, 2),
        );
        expect(api.sent, isEmpty);
        await tester.pumpWidget(const SizedBox.shrink());
        appearance.dispose();
        controller.dispose();
        controller.session.dispose();
      },
    );
  }

  testWidgets(
    'SYS-025-H2: deliberate pagination does not report a lost source',
    (tester) async {
      tester.view.physicalSize = const Size(800, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final view = testView(text: '第一段独特原文。');
      final first = Map<String, dynamic>.from((view['pages'] as List).single);
      view['pages'] = [
        first,
        {...first, 'revision': 2, 'text': '第二段独特原文。'},
      ];
      view['revision'] = 2;
      final api = FakeExperienceApi()..viewOverride = view;
      final journal = MemoryJournal();
      final controller = ExperienceController(
        session: testSession(),
        api: api,
        journal: journal,
      );
      final appearance = PortalPreferences(
        journal: journal,
        backendUrl: controller.session.backendUrl,
        workspaceId: controller.session.workspaceId,
      );
      await appearance.hydrate();
      await appearance.setValue('readingMode', 'paged');
      await controller.initialize();
      await controller.open('experience-a');
      await tester.pumpWidget(
        elseLifeTestApp(
          home: ExperienceScreen(
            controller: controller,
            onPreferences: () {},
            onPortalHome: () {},
            preferences: appearance,
            generativeUiEnabled: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await controller.saveDraft('未发送草稿');
      await tester.pumpAndSettle();
      expect(controller.readingAnchor?.revision, 1);
      await tester.tap(find.text('下一页'));
      await tester.pumpAndSettle();
      expect(find.text('第二段独特原文。'), findsOneWidget);
      expect(find.textContaining('原阅读位置的文字已变化'), findsNothing);
      expect(
        controller.readingAnchor?.revision,
        2,
        reason:
            'A page jump with no scroll animation still saves its new source.',
      );
      expect(
        ((await journal.read(controller.scope))['reading_anchor']
            as Map?)?['revision'],
        2,
      );
      expect(controller.draft, '未发送草稿');
      expect(api.sent, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
      appearance.dispose();
      controller.dispose();
      controller.session.dispose();
    },
  );

  for (final reopen in [false, true]) {
    testWidgets(
      'SYS-025-H2: changing reading mode retains the ${reopen ? 'reopened' : 'mounted'} source page',
      (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final firstText = '早些时候的片段。' * 100;
        final secondText = List.generate(
          100,
          (i) => '第 $i 句：阿禾认真地阅读一本旧书。',
        ).join();
        final view = testView(text: firstText);
        final first = Map<String, dynamic>.from((view['pages'] as List).single);
        view['pages'] = [
          first,
          {...first, 'revision': 2, 'text': secondText},
        ];
        view['revision'] = 2;
        final api = FakeExperienceApi()..viewOverride = view;
        final journal = MemoryJournal();
        final controller = ExperienceController(
          session: testSession(),
          api: api,
          journal: journal,
        );
        final appearance = PortalPreferences(
          journal: journal,
          backendUrl: controller.session.backendUrl,
          workspaceId: controller.session.workspaceId,
        );
        await appearance.hydrate();
        await controller.initialize();
        await controller.open('experience-a');
        Widget screen() => elseLifeTestApp(
          home: ExperienceScreen(
            controller: controller,
            onPreferences: () {},
            onPortalHome: () {},
            preferences: appearance,
            generativeUiEnabled: false,
          ),
        );
        await tester.pumpWidget(screen());
        await tester.pumpAndSettle();
        ScrollController scroll() =>
            tester.widget<Scrollbar>(find.byType(Scrollbar).first).controller!;
        Rect viewport() => tester.getRect(
          find.byWidgetPredicate(
            (widget) =>
                widget is SingleChildScrollView &&
                widget.controller == scroll(),
          ),
        );
        scroll().jumpTo(
          textRender(tester, secondText).localToGlobal(Offset.zero).dy -
              viewport().top +
              500,
        );
        await tester.pumpAndSettle();
        final render = textRender(tester, secondText);
        final position = atPoint(
          render,
          Offset(render.localToGlobal(Offset.zero).dx + 2, viewport().top + 10),
        );
        final sourceY = caretY(render, position) - viewport().top;
        expect(controller.readingAnchor?.revision, 2);
        for (final mode in ['paged', 'continuous']) {
          if (reopen && mode == 'paged')
            await tester.pumpWidget(const SizedBox.shrink());
          await appearance.setValue('readingMode', mode);
          if (reopen && mode == 'paged') {
            await controller.open('experience-a');
            await tester.pumpWidget(screen());
          }
          await tester.pumpAndSettle();
          expect(find.text(secondText), findsOneWidget);
          expect(find.textContaining('原阅读位置的文字已变化'), findsNothing);
          expect(
            caretY(textRender(tester, secondText), position) - viewport().top,
            closeTo(sourceY, 2),
          );
          expect(controller.readingAnchor?.revision, 2);
        }
        expect(api.sent, isEmpty);
        await tester.pumpWidget(const SizedBox.shrink());
        appearance.dispose();
        controller.dispose();
        controller.session.dispose();
      },
    );
  }

  testWidgets(
    'SYS-025-H2: a failed local anchor save does not retry on every frame',
    (tester) async {
      final api = FakeExperienceApi()..passage = '已有的长篇阅读正文。' * 200;
      final journal = _CountingJournal();
      final controller = ExperienceController(
        session: testSession(),
        api: api,
        journal: journal,
      );
      await controller.initialize();
      await controller.open('experience-a');
      await tester.pumpWidget(
        elseLifeTestApp(
          home: ExperienceScreen(controller: controller, onPreferences: () {}),
        ),
      );
      await tester.pumpAndSettle();
      journal.failWrite = true;
      await controller.saveReading(size: 27);
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(controller.storageError, isNotNull);
      final writesAfterSettling = journal.writes;
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      final laterWrites = journal.writes;
      journal.failWrite = false;
      await controller.saveDraft('存储恢复后的草稿');
      await tester.pumpAndSettle();
      expect(controller.storageError, isNull);
      expect((await journal.read(controller.scope))['draft'], '存储恢复后的草稿');
      expect(
        (await journal.read(controller.scope))['reading_anchor'],
        isNotNull,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      controller.dispose();
      controller.session.dispose();
      expect(
        laterWrites,
        writesAfterSettling,
        reason: 'An error notification is not consent to retry persistence.',
      );
      expect(api.sent, isEmpty);
    },
  );
}
