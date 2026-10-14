// One tapered surface is reused at different depths to form a field of worlds.
// Geometry is deterministic; only bounded CSS transforms and stroke offsets move.
let markup;
export function universeSculpture() {
  if(markup)return markup;
  const point=(depth,angle)=>{
    const radius=51+150*Math.pow(depth,1.65),x=radius*Math.cos(angle),y=radius*Math.sin(angle)*(.64+.1*depth);
    return [(245+80*(1-depth)+x*.921+y*.389).toFixed(2),(235-62*(1-depth)-x*.389+y*.921).toFixed(2)].join(',');
  };
  const circle=(depth,from=0,to=Math.PI*2)=>Array.from({length:129},(_,i)=>point(depth,from+(to-from)*i/128)).join(' ');
  const rings=Array.from({length:23},(_,i)=>{
    const depth=.035+i/22*.965;
    return `<polyline points="${circle(depth)}" opacity="${(.1+.3*depth).toFixed(2)}"/>`;
  }).join('');
  const meridians=Array.from({length:56},(_,i)=>{
    const angle=i/56*Math.PI*2;
    const points=Array.from({length:49},(_,j)=>{
      const depth=1-j/48*.94;
      return point(depth,angle+2.35*Math.pow(1-depth,1.2));
    }).join(' ');
    return `<polyline points="${points}" opacity="${i%7===0?'.58':'.3'}"/>`;
  }).join('');
  const streams=[3,17,31,45].map((index,i)=>{
    const points=Array.from({length:65},(_,j)=>{
      const depth=1-j/64*.91;
      return point(depth,index/56*Math.PI*2+2.35*Math.pow(1-depth,1.2));
    }).join(' ');
    return `<polyline class="wormhole-stream wormhole-stream-${i}" points="${points}" pathLength="100" stroke-dasharray="3 97"/>`;
  }).join('');
  markup=`<div class="universe-sculpture" aria-hidden="true"><svg viewBox="0 0 500 450" fill="none" focusable="false">
    <defs>
      <radialGradient id="wormhole-aura"><stop stop-color="var(--portal-magenta)" stop-opacity=".14"/><stop offset=".64" stop-color="var(--portal-cyan)" stop-opacity=".055"/><stop offset="1" stop-color="var(--portal-cyan)" stop-opacity="0"/></radialGradient>
      <radialGradient id="wormhole-depth" cx=".74" cy=".25" r=".63"><stop offset=".09" stop-color="var(--portal-core)"/><stop offset=".38" stop-color="var(--portal-depth)"/><stop offset=".75" stop-color="var(--portal-face)"/><stop offset="1" stop-color="var(--portal-edge)"/></radialGradient>
      <radialGradient id="wormhole-grid" cx="325" cy="173" r="207" gradientUnits="userSpaceOnUse"><stop offset=".05" stop-color="var(--portal-yellow)"/><stop offset=".4" stop-color="var(--portal-magenta)"/><stop offset=".77" stop-color="var(--portal-cyan)"/><stop offset="1" stop-color="var(--portal-magenta)"/></radialGradient>
      <linearGradient id="wormhole-rim" x1="124" y1="82" x2="377" y2="360" gradientUnits="userSpaceOnUse"><stop stop-color="var(--portal-cyan)"/><stop offset=".36" stop-color="var(--portal-yellow)"/><stop offset=".65" stop-color="var(--portal-magenta)"/><stop offset="1" stop-color="var(--portal-cyan)"/></linearGradient>
      <pattern id="wormhole-print-dots" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".8" fill="var(--portal-ink)"/></pattern>
      <filter id="wormhole-soft" x="-30%" y="-40%" width="160%" height="180%"><feGaussianBlur stdDeviation="2.5"/></filter>
      <filter id="wormhole-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
      <g id="wormhole-form" transform="translate(-245 -235)">
      <g class="wormhole-echo" stroke="var(--portal-magenta)" stroke-width=".65">
        <ellipse cx="240" cy="234" rx="233" ry="157" transform="rotate(-29 240 234)" opacity=".22"/>
        <ellipse cx="250" cy="229" rx="226" ry="155" transform="rotate(-9 250 229)" opacity=".1"/>
        <ellipse cx="252" cy="231" rx="215" ry="151" transform="rotate(-43 252 231)" opacity=".13"/>
      </g>
      <polyline points="${circle(1)}" stroke="#847bc8" stroke-width="10" opacity=".16" filter="url(#wormhole-glow)"/>
      <polygon points="${circle(1)}" fill="url(#wormhole-depth)"/>
      <polygon points="${circle(1)}" fill="url(#wormhole-print-dots)" opacity=".13"/>
      <g stroke="url(#wormhole-grid)" stroke-width=".65">${rings}${meridians}</g>
      <polyline points="${circle(1)}" stroke="var(--portal-cyan)" stroke-width="2" transform="translate(-3 1.5)" opacity=".7"/>
      <polyline points="${circle(1)}" stroke="var(--portal-magenta)" stroke-width="2" transform="translate(3 -1.5)" opacity=".7"/>
      <polyline points="${circle(1)}" stroke="url(#wormhole-rim)" stroke-width="1.3"/>
      <polyline points="${circle(.97,Math.PI*.85,Math.PI*1.72)}" stroke="#d0d8e7" stroke-width="2.4" opacity=".6" filter="url(#wormhole-soft)"/>
      <polyline class="wormhole-lensing" points="${circle(1.015)}" pathLength="100" stroke="#d8deee" stroke-width="1" stroke-dasharray="13 87" opacity=".75"/>
      <g stroke="var(--portal-yellow)" stroke-width="1" stroke-linecap="round">${streams}</g>
      <ellipse cx="325" cy="173" rx="51" ry="32.5" transform="rotate(-23 325 173)" fill="var(--portal-core)"/>
      <ellipse cx="325" cy="173" rx="51.5" ry="33" transform="rotate(-23 325 173)" stroke="#59578a" stroke-width=".6"/>
      </g>
    </defs>
    <ellipse cx="259" cy="228" rx="242" ry="213" fill="url(#wormhole-aura)"/>
    <g class="wormhole-routes" stroke="var(--portal-cyan)" stroke-width=".65" stroke-linecap="round">
      <path d="M108 145C164 71 318 44 409 93"/>
      <path d="M110 147C150 200 212 214 294 253S408 279 437 247"/>
      <path d="M141 370C175 339 221 276 294 253C348 237 378 163 409 93"/>
      <path d="M294 253C324 351 363 396 435 365"/>
    </g>
    <g class="wormhole-constellation">
      <g class="wormhole-node wormhole-node-deep"><g transform="translate(239 47) rotate(14) scale(.09)"><use href="#wormhole-form"/></g></g>
      <g class="wormhole-node wormhole-node-deep wormhole-node-late"><g transform="translate(437 247) rotate(-20) scale(.1)"><use href="#wormhole-form"/></g></g>
      <g class="wormhole-node wormhole-node-distant"><g transform="translate(409 93) rotate(38) scale(.23)"><use href="#wormhole-form"/></g></g>
      <g class="wormhole-node wormhole-node-near"><g transform="translate(108 145) rotate(20) scale(.37)"><use href="#wormhole-form"/></g></g>
      <g class="wormhole-node wormhole-node-main"><g transform="translate(294 253) rotate(-9) scale(.66)"><use href="#wormhole-form"/></g></g>
      <g class="wormhole-node wormhole-node-distant wormhole-node-late"><g transform="translate(435 365) rotate(-24) scale(.15)"><use href="#wormhole-form"/></g></g>
      <g class="wormhole-node wormhole-node-foreground"><g transform="translate(140 369) rotate(36) scale(.33)"><use href="#wormhole-form"/></g></g>
    </g>
  </svg></div>`;
  return markup;
}
