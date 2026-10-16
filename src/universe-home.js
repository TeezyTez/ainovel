import {icon} from './ui-controls.js';

/** The portal is a brand artwork; real destinations live in the world catalog. */
export function universeHome(){
 return `<section class="universe-journey" aria-label="首页"><div class="universe-stage" data-universe-stage>
  <div class="universe-frame" aria-hidden="true"><span>ELSELIFE / POSSIBILITY FIELD</span><span>每一种可能，都通向你。</span></div>
  <header class="discovery-toolbar"><div class="universe-hero-copy">
   <p class="universe-eyebrow"><i aria-hidden="true"></i> AI 原生互动叙事 <span>BEYOND ONE LIFE</span></p>
   <h1>世界之外，<br><span>另有人生。</span></h1>
   <p class="universe-hero-intro">走进一个世界，成为故事中的人。<br>让每一次选择，生长出属于你的下一幕。</p>
   <div class="universe-hero-actions"><button class="btn primary" type="button" data-universe-explore>探索世界 ${icon('arrow-right')}</button><a class="btn cinema-secondary" href="#/create">创造世界 ${icon('arrow-up-right')}</a></div>
   <p class="universe-hero-note"><span aria-hidden="true"></span>由 AI 延展，由你决定。</p>
  </div></header>
  <div class="universe-art" aria-hidden="true"><div class="universe-still"><svg viewBox="0 0 600 500" focusable="false"><defs><radialGradient id="still-wormhole"><stop offset="0" stop-color="#242035"/><stop offset=".22" stop-color="#5c557b"/><stop offset=".46" stop-color="#aaa1c3" stop-opacity=".7"/><stop offset=".78" stop-color="#b3c9d3" stop-opacity=".35"/><stop offset="1" stop-color="#cbbdd8" stop-opacity="0"/></radialGradient></defs><g transform="translate(305 250) rotate(-28) scale(1 .7)"><ellipse rx="235" ry="205" fill="url(#still-wormhole)"/>${Array.from({length:30},(_,i)=>`<ellipse cx="${32-i}" cy="${-20+i*.6}" rx="${25+i*6.5}" ry="${22+i*5.8}" fill="none" stroke="#9c92b6" stroke-width=".65" opacity="${.5-i*.012}"/>`).join('')}<ellipse cx="32" cy="-20" rx="24" ry="21" fill="#272337"/></g></svg></div><canvas class="universe-canvas"></canvas></div>
  <div class="universe-cursor" aria-hidden="true"><i></i><b></b><span></span><span></span><span></span><span></span><span></span><span></span></div>
  <div class="universe-stage-bottom"><span class="universe-scroll-cue" aria-hidden="true"><i></i> 向下，发现另一种可能</span><span class="universe-art-caption" aria-hidden="true">THE SPACE BETWEEN LIVES <b>↘</b></span><button class="universe-motion-toggle" type="button" data-universe-pause aria-pressed="false" hidden>暂停动态</button></div>
 </div><div class="universe-principles" aria-label="探索方式"><p><span>01</span> 一个世界，无数种展开</p><p><span>02</span> 用自己的话，改变下一幕</p><p><span>03</span> 留下经历，随时归来</p></div></section>`;
}

/** Explain existing features with accessible native disclosures. */
export function universeStory(){
 return `<section class="universe-manifesto" aria-labelledby="manifesto-title">
  <div class="manifesto-art" aria-hidden="true"><div class="manifesto-orbits"><i></i><i></i><i></i><i></i><i></i><i></i><span></span></div><div class="manifesto-art-label"><span>ONE MOMENT.</span><span>MANY POSSIBLE LIVES.</span></div><span class="manifesto-art-caption">一念之间，故事分岔。</span></div>
  <div class="manifesto-content"><p class="home-kicker">02 / THE ELSELIFE WAY</p><h2 id="manifesto-title">故事会记得，<br><span>你来过。</span></h2><p class="manifesto-intro">世界给出开场。接下来，把你想说的话、想做的事，交给故事。</p>
   <div class="manifesto-features">
    <details name="elselife-features" open><summary><span><b>01</b> 自由行动，让世界回应</span>${icon('plus')}</summary><p>与角色交谈，调查眼前的线索，或走向另一条路。用自己的话行动，让 AI 接续当前处境。</p></details>
    <details name="elselife-features"><summary><span><b>02</b> 重要的经历，有迹可循</span>${icon('plus')}</summary><p>回顾人物、物品与已经发生的事件。离开时保存进展，再次归来，接上自己的故事。</p></details>
    <details name="elselife-features"><summary><span><b>03</b> 另一种选择，另一段人生</span>${icon('plus')}</summary><p>从已有经历建立分支，试着做出不同选择。保留原来的故事，也给另一种可能留一个位置。</p></details>
   </div><a class="manifesto-link" href="#/create">从你的一个念头开始 ${icon('arrow-up-right')}</a>
  </div></section>
 <section class="universe-invitation" aria-labelledby="invitation-title"><div><p class="home-kicker">YOUR NEXT LIFE STARTS HERE</p><h2 id="invitation-title">如果重来一次，<span>你想成为谁？</span></h2></div><a class="btn primary" href="#/create">创造世界 ${icon('arrow-up-right')}</a></section>
 <footer class="universe-footer"><a class="footer-wordmark" href="#/" aria-label="elselife 首页">elselife<span>世界之外，另有人生。</span></a><nav aria-label="页脚导航"><a href="#/stories">我的世界 ${icon('arrow-up-right')}</a><a href="#/settings">偏好设置 ${icon('arrow-up-right')}</a></nav><span class="footer-colophon">ANOTHER LIFE, YOUR WAY.</span></footer>`;
}
