/// The atlas shares the homepage implementation so filtering, persistence and
/// source layout cannot diverge between discovery routes.
library;

import 'package:flutter/material.dart';
import '../experience/demo_world_catalog.dart';
import '../experience/experience_journal.dart';
import 'portal_home.dart';
import 'portal_world_studio_data.dart';

class PortalDiscover extends StatelessWidget {
  const PortalDiscover({
    super.key,
    required this.onOpenWorld,
    required this.onCreate,
    this.journal,
    this.backendUrl = '',
    this.workspaceId,
    this.customWorlds = const [],
    this.onOpenCustomWorld,
  });
  final ValueChanged<DemoWorldPreset> onOpenWorld;
  final VoidCallback onCreate;
  final ExperienceJournal? journal;
  final String backendUrl;
  final String? workspaceId;
  final List<PortalWorldVersion> customWorlds;
  final ValueChanged<PortalWorldVersion>? onOpenCustomWorld;
  @override
  Widget build(BuildContext context) => PortalHome(
    onExplore: () {},
    onCreate: onCreate,
    onOpenShelf: () {},
    onOpenWorld: onOpenWorld,
    journal: journal,
    backendUrl: backendUrl,
    workspaceId: workspaceId,
    customWorlds: customWorlds,
    onOpenCustomWorld: onOpenCustomWorld,
    catalogOnly: true,
  );
}
