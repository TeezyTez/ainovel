const esc = value => value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const text = value => typeof value === 'string' ? value : '';

// Actions take precedence over atmosphere. English cues use word boundaries so
// words such as "train" or "painting" do not accidentally suggest rain.
const cues = [
  ['dialogue', /交谈|对话|谈话|询问|追问|提问|问候|问起|问道|问一句|问店主|问他|问她|回答|答道|说道|开口|聊天|讲述|告诉|\b(?:ask|asked|asks|asking|talk|talked|talking|speak|speaking|said|reply|replied|conversation)\b/giu],
  ['journey', /走向|走进|走出|走过|走到|步行|赶路|前行|出发|启程|沿着|行走|踏上|乘车|骑马|航行|穿过|\b(?:walk|walked|walking|travel|travelled|traveling|journey|depart|departed)\b/giu],
  ['discovery', /查看|翻看|翻开|打开|打量|观察|寻找|搜寻|调查|检查|辨认|线索|笔迹|信封|\b(?:inspect|inspected|examine|examined|search|searched|discover|discovered|clue|letter)\b/giu],
  ['rain', /雨|伞|\b(?:rain|rains|rained|raining|rainy|drizzle|umbrella)\b/giu],
];

function sceneMotif(input, context) {
  const action = text(input).slice(0, 1600);
  for (const [motif, pattern] of cues) {
    pattern.lastIndex = 0;
    if (pattern.test(action)) return motif;
  }
  // The caller supplies only the latest published prose. Inspect its recent end
  // without rendering any of it or traversing the story/world state.
  const recent = text(context).slice(-1600);
  let found = 'ink', latest = -1;
  for (const [motif, pattern] of cues) {
    pattern.lastIndex = 0;
    for (const match of recent.matchAll(pattern)) {
      if (match.index > latest) { found = motif; latest = match.index; }
    }
  }
  return found;
}

function publicLocation(value) {
  const bounded = text(value).slice(0, 256).replace(/\s+/g, ' ').trim();
  const letters = Array.from(bounded);
  return esc(letters.slice(0, 30).join('') + (letters.length > 30 ? '…' : ''));
}

const scenes = {
  rain: `<path class="story-waiting-ground" d="M11 38q18-2 32 0t42-1"/><path class="story-rain-drop" d="m25 8-3 8m23-12-3 8m24-5-3 8m21-9-3 8"/><path class="story-rain-drop story-rain-late" d="m17 17-3 8m22-10-3 8m23-4-3 8m21-12-3 8"/><ellipse class="story-rain-ripple" cx="43" cy="37" rx="9" ry="2"/>`,
  dialogue: `<path class="story-waiting-ground" d="M13 36q12-3 23 0m25 0q12-3 22 0"/><path class="story-dialogue-thread" pathLength="100" d="M31 23c8-11 24-11 34 0"/><circle class="story-dialogue-point" cx="27" cy="27" r="4"/><circle class="story-dialogue-point story-dialogue-late" cx="69" cy="27" r="4"/><path class="story-waiting-ground" d="m25 15-2-3m48 3 2-3"/>`,
  journey: `<path class="story-waiting-ground" d="M9 36q14-7 27-4m26-18q11-5 24-1"/><path class="story-journey-track" d="M15 31c15-21 29 19 43-2S73 12 83 18"/><path class="story-journey-trail" pathLength="100" d="M15 31c15-21 29 19 43-2S73 12 83 18"/><circle class="story-journey-point" cx="15" cy="31" r="2"/>`,
  discovery: `<path class="story-waiting-ground" d="M13 32q7-3 13-1m46-14 10-2m-9 19 8 2"/><circle class="story-discovery-ring" cx="48" cy="25" r="7"/><circle class="story-discovery-ring story-discovery-late" cx="48" cy="25" r="7"/><path class="story-discovery-mark" d="m48 20 1.5 3.5L53 25l-3.5 1.5L48 30l-1.5-3.5L43 25l3.5-1.5Z"/>`,
  ink: `<path class="story-ink-line" pathLength="100" d="M15 15c13-2 23 2 36 0s22 2 29 0"/><path class="story-ink-line story-ink-second" pathLength="100" d="M15 25c10-2 20 2 32 0s23 2 31 0"/><path class="story-ink-line story-ink-third" pathLength="100" d="M15 35c11-2 20 2 32 0s12 1 17 0"/>`,
};

export function storyWaiting({input = '', context = '', location = '', compact = false} = {}) {
  const motif = sceneMotif(input, context), place = publicLocation(location);
  return `<div class="story-waiting${compact ? ' story-waiting-compact' : ''}" data-story-motif="${motif}" role="status" aria-live="polite" aria-atomic="true"><svg class="story-waiting-scene" viewBox="0 0 96 48" width="96" height="48" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${scenes[motif]}</svg><span class="story-waiting-copy"><span class="story-waiting-label">${compact ? '稍等片刻' : '故事正在继续'}</span>${place ? `<span class="story-waiting-location">${place}</span>` : ''}</span></div>`;
}
