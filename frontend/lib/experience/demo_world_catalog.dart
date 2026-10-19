/// Demo world choices for the formal experience draft.
///
/// Selecting a world only returns a seed to the host page. The host remains
/// responsible for saving that seed as a local draft; this widget never sends
/// a request or presents an opening as a committed story page.
library;

import 'package:flutter/material.dart';

@immutable
class DemoWorldPreset {
  const DemoWorldPreset({
    required this.id,
    required this.title,
    required this.tagline,
    required this.participation,
    required this.seed,
    required this.imageAsset,
  });

  final String id;
  final String title;
  final String tagline;
  final String participation;
  final String seed;
  final String imageAsset;
}

/// Public premise only. Character secrets and the demo's opening text are
/// intentionally absent; the formal experience service generates its own page.
const demoWorldPresets = <DemoWorldPreset>[
  DemoWorldPreset(
    id: 'fog-harbor',
    title: '雾港来信',
    tagline: '七年后，你收到一封由自己发出的电报。',
    participation: '作为返港的前电报员，核实来处、先叙旧，或暂不追问。',
    imageAsset: 'assets/worlds/cinema-harbor.jpg',
    seed: '请以近代架空的海港城市“雾港”为背景，展开一段可自由参与的经历。'
        '我是离乡七年后返港的前电报员，一封署着我名字的迟来电报与我有关；'
        '旧码头正在改建，旧档搬迁和故人的日常也在继续。'
        '我可以核实电报来处、先与旧友叙话，或暂不追问。'
        '离乡缘由、关系亲疏与电报真相都尚未确定。'
        '这里没有已被证实的超自然现象，港务档案查阅需登记授权，'
        '人物只知道自己合理获知之事。请从这些设定生成开场，保留我的选择。',
  ),
  DemoWorldPreset(
    id: 'mountain',
    title: '山门之外',
    tagline: '一封不该打开的信，在你手中自己展开了。',
    participation: '作为外门送信弟子，决定如何保管、说明和送达这封信。',
    imageAsset: 'assets/worlds/cinema-mountain.jpg',
    seed: '请以人与术法共居的山中社会为背景展开经历。'
        '我是初到山中的外门送信弟子，负责一封写给何砚的信；'
        '信封在我手中自行展开，但我还没决定是否继续读信，也没有接受额外誓约。'
        '山中也有菜圃用水与日常劳作；术法需要材料与练习，'
        '正式誓约必须明确同意，信中信息不会自动让旁人知晓。'
        '我可以妥善保管并送达信件、询问如何处理术印，或暂缓介入。'
        '请基于这些事实生成开场，不预设我已做出的选择。',
  ),
  DemoWorldPreset(
    id: 'thursday',
    title: '星期四书店',
    tagline: '她来取你答应留下的书，可你从未见过她。',
    participation: '作为临时店主，核对预留记录，或诚实说明仍需了解情况。',
    imageAsset: 'assets/worlds/cinema-books.jpg',
    seed: '请在当代城市旧街的一间独立书店展开经历。'
        '我是临时接手书店的店主，今天是接手第三天。'
        '雨天有位我从未见过的顾客来取据称被预留的书；'
        '她的说法不等于我已亲自承诺。'
        '我可以询问书名和预留经过、核对交接记录，也可以坦诚说明还需时间。'
        '书店日常仍在继续，租约将近，兼职店员也有自己的考试安排。'
        '这里没有超自然现象，预留、付款与赠送都需要当事人同意，'
        '误会的解释也不保证立刻被原谅。请生成开场并让我自行决定回应。',
  ),
  DemoWorldPreset(
    id: 'truth-teahouse',
    title: '真话城的第一壶茶',
    tagline: '客人想买一份道歉的礼物，却还没想好要说什么。',
    participation: '作为开业首日的茶铺店主，介绍茶、询问需要，或照常做生意。',
    imageAsset: 'assets/worlds/cinema-tea.jpg',
    seed: '请在一座无法故意说出违背自己当下信念的话的架空小城展开经历。'
        '我是茶铺店主，今天第一天营业；一位顾客想买茶作为道歉礼物，'
        '却尚未选定或付款。我可以介绍茶、询问他的需要，'
        '也可以先处理店务或不介入私事。'
        '这里的人依然可能记错、误解、沉默或拒绝回答；'
        '无人因此能读心或直接辨认真相。'
        '交易、代送和道歉都需当事人明确同意，道歉不保证获得原谅。'
        '请据此生成开场，保留我的选择。',
  ),
];

/// Horizontally scrolling choices for the new-world view.
///
/// Example host callback: `onSeedSelected: (seed) => _input.text = seed`.
/// The existing input listener can then call `ExperienceController.saveDraft`.
class DemoWorldCatalog extends StatelessWidget {
  const DemoWorldCatalog({
    super.key,
    required this.onSeedSelected,
  });

  final ValueChanged<String> onSeedSelected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('精选世界', style: theme.textTheme.titleLarge),
        const SizedBox(height: 4),
        Text(
          '选择后只会填入草稿，你可以修改，再决定是否进入。',
          style: theme.textTheme.bodySmall,
        ),
        const SizedBox(height: 16),
        SizedBox(
          height: 336,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: demoWorldPresets.length,
            separatorBuilder: (_, _) => const SizedBox(width: 12),
            itemBuilder: (context, index) {
              final preset = demoWorldPresets[index];
              return SizedBox(
                width: 288,
                child: _DemoWorldCard(
                  preset: preset,
                  onTap: () => onSeedSelected(preset.seed),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _DemoWorldCard extends StatelessWidget {
  const _DemoWorldCard({required this.preset, required this.onTap});

  final DemoWorldPreset preset;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: theme.colorScheme.outlineVariant),
      ),
      child: InkWell(
        key: ValueKey('demo-world-${preset.id}'),
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              height: 144,
              width: double.infinity,
              child: Image.asset(
                preset.imageAsset,
                fit: BoxFit.cover,
                excludeFromSemantics: true,
                errorBuilder: (context, error, stackTrace) => ColoredBox(
                  color: theme.colorScheme.surfaceContainerHighest,
                  child: Center(
                    child: Icon(
                      Icons.landscape_outlined,
                      size: 40,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        preset.title,
                        style: theme.textTheme.titleMedium,
                      ),
                      const SizedBox(height: 6),
                      Text(
                        preset.tagline,
                        style: theme.textTheme.bodyMedium,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        preset.participation,
                        style: theme.textTheme.bodySmall,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        '填入草稿  →',
                        style: theme.textTheme.labelLarge?.copyWith(
                          color: theme.colorScheme.primary,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
