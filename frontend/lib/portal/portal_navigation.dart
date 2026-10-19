import 'package:flutter/material.dart';
import 'portal_brand.dart';
import 'portal_icon.dart';

enum PortalSection { discover, shelf, studio, settings }

/// The landing page and interior pages share the same geometry and actions.
class PortalNavigation extends StatelessWidget {
  const PortalNavigation({super.key, required this.section, required this.onHome,
    required this.onDiscover, required this.onShelf, required this.onCreate,
    this.onSettings, this.themeMode = ThemeMode.system, this.onThemeChanged,
    this.recentWorlds = const [], this.bottom = false});
  final PortalSection section;
  final VoidCallback onHome, onDiscover, onShelf, onCreate;
  final VoidCallback? onSettings;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode>? onThemeChanged;
  final List<({String title, String detail, VoidCallback onOpen})> recentWorlds;
  final bool bottom;

  Widget _item(BuildContext context, PortalSection target, String text,
      String icon, VoidCallback? onPressed) {
    final colors = Theme.of(context).colorScheme;
    final selected = target == section;
    final foreground = selected ? colors.primary : colors.onSurfaceVariant;
    return Semantics(selected: selected, child: TextButton(
      key: ValueKey('portal-${bottom ? 'bottom-' : ''}nav-${target.name}'),
      onPressed: onPressed,
      style: TextButton.styleFrom(
        foregroundColor: foreground,
        backgroundColor: selected ? colors.surfaceContainerHigh : Colors.transparent,
        minimumSize: Size(bottom ? double.infinity : 72, bottom ? 54 : 44),
        padding: EdgeInsets.symmetric(horizontal: bottom ? 4 : 14, vertical: bottom ? 6 : 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      child: bottom ? Column(mainAxisSize: MainAxisSize.min, children: [
        PortalIcon(icon, size: 19, color: foreground), const SizedBox(height: 4),
        Text(text, style: const TextStyle(fontSize: 11, height: 1.3)),
      ]) : Text(text, style: const TextStyle(fontSize: 13)),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context), colors = theme.colorScheme;
    final width = MediaQuery.sizeOf(context).width;
    final mobile = width <= 800, small = width <= 620;
    if (bottom) {
      if (!mobile) return const SizedBox.shrink();
      return Container(
        key: const ValueKey('portal-bottom-navigation'),
        height: 64 + MediaQuery.paddingOf(context).bottom,
        padding: EdgeInsets.fromLTRB(8, 5, 8, 5 + MediaQuery.paddingOf(context).bottom),
        decoration: BoxDecoration(color: colors.surface,
          border: Border(top: BorderSide(color: colors.outlineVariant))),
        child: Row(children: [
          Expanded(child: _item(context, PortalSection.discover, '发现', 'compass', onDiscover)),
          Expanded(child: _item(context, PortalSection.shelf, '我的世界', 'layers', onShelf)),
          Expanded(child: _item(context, PortalSection.studio, '创造世界', 'plus', onCreate)),
          Expanded(child: _item(context, PortalSection.settings, '设置', 'settings', onSettings)),
        ]),
      );
    }
    return Container(
      key: const ValueKey('portal-header'),
      height: small ? 68 : mobile ? 72 : 80,
      padding: EdgeInsets.symmetric(horizontal: small ? 22 : width <= 1100 ? 32 : 48),
      decoration: BoxDecoration(color: colors.surface.withValues(alpha: .82),
        border: Border(bottom: BorderSide(color: colors.outlineVariant))),
      child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 1240),
        child: Row(children: [
          Expanded(child: Align(alignment: Alignment.centerLeft, child: FittedBox(fit: BoxFit.scaleDown,
            child: InkWell(onTap: onHome, borderRadius: BorderRadius.circular(8),
              child: Padding(padding: const EdgeInsets.symmetric(vertical: 7), child: Row(mainAxisSize: MainAxisSize.min, children: [
                PortalBrandMark(size: small ? 29 : 34), const SizedBox(width: 10),
                Text('elselife', style: TextStyle(fontFamily: 'SpaceGrotesk',
                  fontSize: small ? 25 : 30, fontWeight: FontWeight.w600,
                  height: 1, letterSpacing: -1.7, color: colors.onSurface)),
              ])),
            ),
          ))),
          if (!mobile) ...[
            _item(context, PortalSection.discover, '发现', 'compass', onDiscover),
            _item(context, PortalSection.shelf, '我的世界', 'layers', onShelf),
            _item(context, PortalSection.settings, '设置', 'settings', onSettings),
            const SizedBox(width: 24),
          ],
          const SizedBox(width: 12),
          SizedBox(width: 112, child: Row(children: [
            PortalIcon(theme.brightness == Brightness.dark ? 'moon' : 'sun', size: 17, color: colors.onSurfaceVariant),
            const SizedBox(width: 8),
            Expanded(child: DropdownButtonHideUnderline(child: DropdownButton<ThemeMode>(
              key: const ValueKey('portal-theme'), value: themeMode, isExpanded: true,
              icon: PortalIcon('chevron-down', size: 15, color: colors.onSurfaceVariant),
              style: TextStyle(color: colors.onSurfaceVariant, fontSize: 12),
              items: const [
                DropdownMenuItem(value: ThemeMode.light, child: Text('浅色')),
                DropdownMenuItem(value: ThemeMode.dark, child: Text('深色')),
                DropdownMenuItem(value: ThemeMode.system, child: Text('跟随系统')),
              ],
              onChanged: onThemeChanged == null ? null : (v) { if (v != null) onThemeChanged!(v); },
            ))),
          ])),
          if (!mobile) ...[
            // Reserve the slot while recent records load to avoid shifting tabs.
            SizedBox(width: 44, child: recentWorlds.isEmpty ? null : PopupMenuButton<int>(
              tooltip: '最近进入的世界', icon: PortalIcon('history', size: 16, color: colors.onSurfaceVariant),
              onSelected: (i) => recentWorlds[i].onOpen(),
              itemBuilder: (_) => [for (var i = 0; i < recentWorlds.length; i++) PopupMenuItem(value: i,
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(recentWorlds[i].title),
                  if (recentWorlds[i].detail.isNotEmpty) Text(recentWorlds[i].detail,
                    style: TextStyle(fontSize: 11, color: colors.onSurfaceVariant)),
                ]))],
            )),
            const SizedBox(width: 16),
            Semantics(selected: section == PortalSection.studio,
              child: OutlinedButton.icon(key: const ValueKey('portal-nav-studio'), onPressed: onCreate,
                style: OutlinedButton.styleFrom(minimumSize: const Size(124, 44),
                  backgroundColor: section == PortalSection.studio ? colors.surfaceContainerHigh : colors.surface),
                icon: const PortalIcon('spark', size: 18), label: const Text('创造世界', style: TextStyle(fontSize: 12)))),
          ],
        ]),
      )),
    );
  }
}
