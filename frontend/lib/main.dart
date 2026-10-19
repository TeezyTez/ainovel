import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'experience/experience_client.dart';
import 'experience/experience_controller.dart';
import 'experience/experience_journal.dart';
import 'experience/experience_preferences_screen.dart';
import 'portal_product_screen.dart';
import 'portal/portal_theme.dart';
import 'portal/portal_service_client.dart';
import 'experience/workspace_session.dart';
import 'ui/theme/elselife_theme.dart';

void main() {
  // Capture the product hash before Flutter's Navigator initializes its root.
  final initialPortalPath = Uri.base.fragment;
  runApp(ElseLifeApp(initialPortalPath: initialPortalPath.isEmpty ? '/' : initialPortalPath));
}

class ElseLifeApp extends StatefulWidget {
  const ElseLifeApp({super.key, this.initialPortalPath});
  final String? initialPortalPath;
  @override
  State<ElseLifeApp> createState() => _ElseLifeAppState();
}

class _ElseLifeAppState extends State<ElseLifeApp> {
  final navigator = GlobalKey<NavigatorState>();
  late final WorkspaceSession session;
  late final ExperienceClient api;
  late final ExperienceController experience;
  late final Future<void> _ready;
  @override
  void initState() {
    super.initState();
    const configured = String.fromEnvironment('ELSELIFE_API_BASE');
    final journal = LocalExperienceJournal();
    session = WorkspaceSession(
      appearanceJournal: journal,
      backendUrl: configured.isEmpty ? Uri.base.origin : configured,
    );
    api = ExperienceClient(baseUrl: () => session.backendUrl);
    experience = ExperienceController(
      session: session,
      api: api,
      journal: journal,
    );
    session.addListener(_changed);
    _ready = _boot();
  }

  Future<void> _boot() async {
    await session.hydrate();
    if (mounted) await experience.initialize();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    session.removeListener(_changed);
    experience.dispose();
    api.close();
    session.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    navigatorKey: navigator,
    initialRoute: '/',
    title: 'elselife · 人生复本',
    debugShowCheckedModeBanner: false,
    theme: portalThemeData(session.themeId),
    darkTheme: portalThemeData('ink'),
    themeMode: session.themeId == 'system' ? ThemeMode.system : session.themeId == 'ink' ? ThemeMode.dark : ThemeMode.light,
    themeAnimationDuration: session.reduceMotion
        ? Duration.zero
        : ElseLifeMotion.theme,
    themeAnimationCurve: ElseLifeMotion.standard,
    locale: const Locale('zh'),
    supportedLocales: const [Locale('zh')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    builder: (context, child) =>
        ElseLifeMotionScope(reducedMotion: session.reduceMotion, child: child!),
    home: PortalProductScreen(
      controller: experience,
      initialPath: widget.initialPortalPath,
      ready: _ready,
      artifactClient: () => PortalServiceClient(() => session.backendUrl),
      onPreferences: () {
        navigator.currentState!.push(
          MaterialPageRoute<void>(
            builder: (_) => ExperiencePreferencesScreen(controller: experience),
          ),
        );
      },
    ),
  );
}
