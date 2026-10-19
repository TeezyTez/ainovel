import 'package:flutter_test/flutter_test.dart';
import 'package:elselife_frontend/experience/workspace_session.dart';
import '../support/experience_fixture.dart';

void main() {
  test(
    'appearance persists per backend/workspace and storage failures are visible',
    () async {
      final journal = MemoryJournal();
      final first = WorkspaceSession(
        backendUrl: 'http://localhost:18081',
        appearanceJournal: journal,
      );
      first.themeId = 'ink';
      first.reduceMotion = true;
      await first.pendingWrites;
      first.dispose();
      final restored = WorkspaceSession(
        backendUrl: 'http://localhost:18081',
        appearanceJournal: journal,
      );
      await restored.hydrate();
      expect(restored.themeId, 'ink');
      expect(restored.reduceMotion, isTrue);
      restored.backendUrl = 'http://localhost:18082';
      await restored.hydrate();
      expect(restored.themeId, 'mist');
      expect(restored.reduceMotion, isFalse);
      journal.failWrite = true;
      restored.themeId = 'ink';
      await restored.pendingWrites;
      expect(restored.appearanceError, isNotNull);
      restored.dispose();
    },
  );
}
