import 'dart:async';
import 'package:flutter/material.dart';
import '../experience/experience_models.dart';
import 'portal_preferences.dart';
import 'portal_icon.dart';

class PortalSettings extends StatefulWidget {
  const PortalSettings({super.key, required this.preferences, required this.checkModel,
    required this.exportAll, required this.importAll, required this.clearDemo,
    required this.exportEvents, required this.onContentPreferences,
    this.initialSection=0,this.onSectionChanged,this.eventCount=0});
  final PortalPreferences preferences;
  final Future<Json> Function() checkModel;
  final Future<void> Function() exportAll, importAll, clearDemo, exportEvents;
  final VoidCallback onContentPreferences;
  final int initialSection,eventCount;
  final ValueChanged<int>? onSectionChanged;
  @override
  State<PortalSettings> createState() => _PortalSettingsState();
}
class _PortalSettingsState extends State<PortalSettings> {
  int section = 0;
  bool busy = false;
  String? notice;
  Json? model;
  PortalPreferences get p => widget.preferences;
  static const labels = ['界面外观', '新故事偏好', '生成服务', '数据与备份'];
  static const icons = ['typography', 'spark', 'orbit', 'database'];
  @override
  void initState() { super.initState(); section=widget.initialSection.clamp(0,3);p.addListener(_changed); unawaited(_checkModel()); }
  void _changed() { if (mounted) setState(() {}); }
  @override
  void dispose() { p.removeListener(_changed); super.dispose(); }
  Future<void> _checkModel() async {
    try { final result = await widget.checkModel(); if (mounted) setState(() => model = result); }
    catch (_) { if (mounted) setState(() => model = {'available': false}); }
  }
  Future<void> _run(Future<void> Function() action, String message) async {
    setState(() { busy = true; notice = null; });
    try { await action(); if (mounted) setState(() => notice = message); }
    catch (error) { if (mounted) setState(() => notice = error is FormatException ? error.message : error is StateError ? error.message : '操作未完成，原数据仍保留，请稍后重试。'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Row(crossAxisAlignment:CrossAxisAlignment.start,children:[Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
      Row(children:[Container(width:22,height:1,decoration:const BoxDecoration(gradient:LinearGradient(colors:[Color(0xffa998d1),Color(0xff86bdc8),Color(0xffcfb48a)]))),const SizedBox(width:10),Text('YOUR PREFERENCES', style: TextStyle(fontFamily:'SpaceGrotesk',fontSize: 10, letterSpacing: 1.5, color: Theme.of(context).colorScheme.onSurfaceVariant))]),
      const SizedBox(height:12),Text('设置', style: TextStyle(fontFamily:'NotoSerifSC',fontSize: MediaQuery.sizeOf(context).width < 600 ? 32 : 44, height:1.45,fontWeight: FontWeight.w500,letterSpacing:-1.4)),
      const SizedBox(height:12),Text('调整阅读与创作偏好，照顾好每一段经历。',style:TextStyle(fontSize:13,height:1.8,color:Theme.of(context).colorScheme.onSurfaceVariant)),
    ])),if(MediaQuery.sizeOf(context).width>600)Padding(padding:const EdgeInsets.only(top:36),child:Text(p.error==null?'修改自动保存':p.error!,style:const TextStyle(fontSize:12)))]),
    if(MediaQuery.sizeOf(context).width<=600)Padding(padding:const EdgeInsets.only(top:8),child:Text(p.error==null?'修改自动保存':p.error!,style:const TextStyle(fontSize:12))),
    if(p.error!=null)TextButton(onPressed:p.retry,child:const Text('重试保存')),
    const SizedBox(height:25),const Divider(height:1),const SizedBox(height:36),
    if (notice != null) Padding(padding: const EdgeInsets.only(bottom: 16), child: Text(notice!, semanticsLabel: notice)),
    LayoutBuilder(builder: (context, constraints) {
      final screenWidth=MediaQuery.sizeOf(context).width;
      final compact=screenWidth<=800;
      final formSurface=Color.lerp(Theme.of(context).colorScheme.surface,const Color(0xffa998d1),.03)!;
      final formBorder=Color.lerp(Theme.of(context).dividerColor,const Color(0xffa998d1),.22)!;
      final buttons = [for (var i = 0; i < labels.length; i++)
        TextButton.icon(style: TextButton.styleFrom(alignment: Alignment.centerLeft, minimumSize:const Size(0,48),padding: const EdgeInsets.symmetric(vertical:12,horizontal:13),
          shape:RoundedRectangleBorder(borderRadius:BorderRadius.circular(12),side:BorderSide(color:section==i?Theme.of(context).dividerColor:Colors.transparent)),
          backgroundColor: section == i ? formSurface : Colors.transparent),
          onPressed: () {setState(() => section = i);widget.onSectionChanged?.call(i);}, icon: PortalIcon(icons[i], size: 19), label: Text(labels[i],style:TextStyle(fontSize:screenWidth<=360?12:13)))];
      final nav = compact ? Wrap(spacing:8,runSpacing:8,children:[for(final button in buttons) SizedBox(width:screenWidth<=600?(constraints.maxWidth-8)/2:(constraints.maxWidth-24)/4,child:button)])
        : Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[for(final button in buttons) Padding(padding:const EdgeInsets.only(bottom:7),child:button)]);
      final panel = DecoratedBox(decoration: BoxDecoration(color: formSurface,
        border: Border.all(color: formBorder), borderRadius: BorderRadius.circular(18), boxShadow: [BoxShadow(color: Theme.of(context).colorScheme.onSurface.withValues(alpha: .035), blurRadius: 28, offset: const Offset(0, 8), spreadRadius: -12)]),
        child: Material(type: MaterialType.transparency, child: Padding(padding: screenWidth<=600?const EdgeInsets.symmetric(horizontal:21,vertical:24):const EdgeInsets.fromLTRB(32,30,32,32), child: _panel())));
      if (compact) return Column(children: [nav, const SizedBox(height: 25), panel]);
      return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [SizedBox(width: 186, child: nav), const SizedBox(width: 42), Expanded(child: panel)]);
    }),
  ]);
  Widget _panel() => switch (section) {
    1 => _narrative(), 2 => _service(), 3 => _data(), _ => _reading(),
  };
  Widget _title(String value, [String? description]) => Padding(padding: const EdgeInsets.only(bottom: 22), child:
    Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(value, style: const TextStyle(fontFamily:'NotoSerifSC',fontSize: 26,height:1.55,fontWeight: FontWeight.w500,letterSpacing:-.65)),
      if (description != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(description)),const Divider(height:42)]));
  Widget _choice(String key,Map<String,String> choices)=>DropdownButtonFormField<String>(key:ValueKey('$key:${p.text(key)}'),initialValue:p.text(key),isExpanded:true,
    decoration:InputDecoration(contentPadding:const EdgeInsets.symmetric(horizontal:14,vertical:12),filled:true,
      border:OutlineInputBorder(borderRadius:BorderRadius.circular(12))),
    style:TextStyle(fontFamily:'NotoSansSC',fontSize:15,color:Theme.of(context).colorScheme.onSurface),
    items:[for(final entry in choices.entries)DropdownMenuItem(value:entry.key,child:Text(entry.value))],
    onChanged:(v){if(v!=null)unawaited(p.setValue(key,v));});
  Widget _select(String key, String label, Map<String, String> choices) => Padding(padding: const EdgeInsets.symmetric(vertical:17), child:
    LayoutBuilder(builder:(context,constraints)=>constraints.maxWidth<420 ? Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(label),const SizedBox(height:10),_choice(key,choices)])
      : Row(children:[Expanded(child:Text(label)),const SizedBox(width:22),SizedBox(width:250,child:_choice(key,choices))])));
  Widget _range(String key, String label, double min, double max, int divisions, String unit) => Padding(
    padding: const EdgeInsets.symmetric(vertical:17),child:LayoutBuilder(builder:(context,constraints){
      final control=Row(children:[Expanded(child:Slider(value:p.number(key),min:min,max:max,divisions:divisions,label:'${p.number(key)}',onChanged:(v)=>unawaited(p.setValue(key,v)))),
        SizedBox(width:53,child:Text('${p.number(key).toStringAsFixed(key=='lineHeight'?2:0)}$unit',style:const TextStyle(fontFamily:'SpaceGrotesk',fontSize:12)))]);
      if(constraints.maxWidth<420)return Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(label),const SizedBox(height:10),control]);
      return Row(children:[Expanded(child:Text(label)),const SizedBox(width:22),SizedBox(width:250,child:control)]);
    }));
  Widget _reading() => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    _title('界面外观'), _select('theme', '主题', {'light':'浅色','dark':'深色','system':'跟随系统'}),
    _range('fontSize','字号',16,30,14,'px'), _range('lineHeight','行距',1.5,2.5,20,''), _range('width','正文宽度',480,880,20,'px'),
    Container(padding: const EdgeInsets.all(24), margin: const EdgeInsets.symmetric(vertical: 16),
      decoration: BoxDecoration(color: Theme.of(context).colorScheme.primary.withValues(alpha: .04), borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('预览', style: TextStyle(fontSize: 11)), const SizedBox(height: 12),
        Text('雨停的时候，街上的灯刚好亮起。你把书翻过一页，决定再多坐一会儿。', style: TextStyle(fontSize: p.fontSize, height: p.lineHeight,
          fontFamily: p.fontFamily == 'serif' ? 'NotoSerifSC' : p.fontFamily == 'sans' ? 'NotoSansSC' : null))])),
    ExpansionTile(tilePadding: EdgeInsets.zero, title: const Text('字体、排版与交互习惯'), children: [
      _select('fontFamily','字体',{'serif':'宋体／衬线','sans':'黑体／无衬线','system':'系统字体'}),
      _select('paragraphGap','段落间距',{'normal':'适中','wide':'宽松','compact':'紧凑'}),
      _select('readingMode','阅读方式',{'continuous':'连续滚动','paged':'按回合翻页'}),
      for (final row in [['showTime','显示故事时间','在阅读页显示故事内的时间'],['restReminder','休息提醒','连续阅读半小时后轻轻提醒'],['reducedMotion','减少动画','减少过渡与动态效果'],['sendEnter','Enter 发送','Shift + Enter 始终可以换行']])
        SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(row[1]), subtitle: Text(row[2]), value: p.enabled(row[0]), onChanged: (v) => unawaited(p.setValue(row[0], v))),
    ]),
  ]);
  Widget _narrative() => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    _title('新故事偏好','仅用于新故事。'),
    LayoutBuilder(builder:(context,constraints)=>Wrap(spacing:22,runSpacing:25,children:[
      for (final row in [ ['perspective','视角','第二人称','第一人称','第三人称'], ['length','篇幅','简短','适中','舒展'],
        ['pace','节奏','从容','适中','紧凑'], ['style','文风','细腻克制','明快简洁','诗意留白','朴素日常']])
        SizedBox(width:constraints.maxWidth<450?constraints.maxWidth:(constraints.maxWidth-22)/2,child:Column(crossAxisAlignment:CrossAxisAlignment.start,
          children:[Text(row[1],style:const TextStyle(fontSize:13)),const SizedBox(height:9),_choice(row[0],{for(final value in row.skip(2))value:value})]))])),
    const Divider(height: 36), TextButton(onPressed: widget.onContentPreferences, child: const Text('管理已确认的内容偏好')),
  ]);
  Widget _service() => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    _title('生成服务'), Wrap(spacing: 24, runSpacing: 16, crossAxisAlignment: WrapCrossAlignment.center, children: [
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(model == null ? '正在检查连接…' : model!['available'] == true ? '已配置 · ${model!['provider'] ?? '模型服务'}' : '模型未连接', style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 10), Text(model?['model']?.toString() ?? '可以回顾已有经历。')]),
      OutlinedButton(onPressed: busy ? null : () => _run(_checkModel, '已更新服务配置状态。'), child: const Text('检查连接'))]),
    const SizedBox(height: 24), ExpansionTile(tilePadding: EdgeInsets.zero, title: const Text('连接与服务端配置'), children: const [
      Padding(padding: EdgeInsets.all(12), child: Text('本机 Codex 登录可直接使用现有账号授权。密钥与登录凭据保留在服务端，不会发送到浏览器。\n\n连接检查确认服务配置；实际生成结果以故事中的响应为准。'))]),
  ]);
  Widget _action(String title, String description, String label, Future<void> Function() action, String success) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 25), child:LayoutBuilder(builder:(context,constraints){
      final copy=Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(title,style:const TextStyle(fontWeight:FontWeight.w500,fontSize:14)),const SizedBox(height:7),Text(description,style:TextStyle(fontSize:13,height:1.9,color:Theme.of(context).colorScheme.onSurfaceVariant))]);
      final button=OutlinedButton(onPressed:busy?null:()=>_run(action,success),child:Text(label));
      return MediaQuery.sizeOf(context).width<=600?Column(crossAxisAlignment:CrossAxisAlignment.start,children:[copy,const SizedBox(height:15),button]):Row(children:[Expanded(child:copy),const SizedBox(width:22),button]);
    }));
  Widget _data() => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    _title('数据与备份','故事保存在这台设备，暂不支持云同步。'),
    _action('导出记录','导出本机世界、故事、草稿、分支与阅读标记。','导出本机记录',widget.exportAll,'已导出本机记录。'),
    const Divider(), _action('导入记录','导入之前保存的 JSON 文件。','导入记录',widget.importAll,'导入操作已结束。'),
    ExpansionTile(tilePadding: EdgeInsets.zero, title: const Text('备份与迁移说明'), children: const [Padding(padding: EdgeInsets.all(12), child:
      Text('备份包含本机创作设置与正式故事记录。世界文件可能包含作者的幕后设定，分享时请在故事选项中选择「导出正文」。'))]),
    ExpansionTile(tilePadding: EdgeInsets.zero, title: const Text('整理数据'), children: [_action('整理演示故事','移入回收箱后仍可恢复。','演示故事移入回收箱',widget.clearDemo,'已整理演示故事。')]),
    ExpansionTile(tilePadding: EdgeInsets.zero, title: const Text('诊断记录'), children: [_action('本机交互事件','仅记录本机交互事件，不包含剧情或输入内容。\n已记录 ${widget.eventCount} 条事件','导出事件记录',widget.exportEvents,'已导出事件记录。')]),
  ]);
}
