// Programmatic navigation needs a reading destination for keyboard and screen
// reader users. Focus must not undo a separately restored viewport anchor.
export function focusPageContent(root=globalThis.document){
  const main=root?.querySelector('#main');if(!main)return false;
  const target=main.querySelector('h1')||main;
  target.setAttribute('tabindex','-1');target.focus({preventScroll:true});return true;
}

export function hasPageContentFocus(root=globalThis.document){
  const main=root?.querySelector('#main');if(!main||!root.activeElement)return false;
  return root.activeElement===main||root.activeElement===main.querySelector('h1');
}
