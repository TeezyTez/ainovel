import 'package:flutter/foundation.dart';
import '../experience/experience_journal.dart';

@immutable
class PortalHomeSavedState {
  const PortalHomeSavedState(this.favorites, this.hidden);
  final Set<String> favorites, hidden;
}

/// Catalog preferences are device data and never become generated story facts.
class PortalHomePreferences {
  PortalHomePreferences({
    required this.journal,
    required String backendUrl,
    String? workspaceId,
  }) : scope = experienceScope(backendUrl, workspaceId, 'portal', 'discovery');
  final ExperienceJournal journal;
  final String scope;
  Future<PortalHomeSavedState> load() async {
    final data = await journal.read(scope);
    Set<String> ids(String prefix) => {
      for (final entry in data.entries)
        if (entry.key.startsWith(prefix) && entry.value == true)
          entry.key.substring(prefix.length),
    };
    return PortalHomeSavedState(ids('favorite:'), ids('hidden:'));
  }

  Future<void> saveWorld(
    String id, {
    required bool favorite,
    required bool enabled,
  }) => journal.patch(scope, {
    '${favorite ? 'favorite' : 'hidden'}:$id': enabled,
  });
}
