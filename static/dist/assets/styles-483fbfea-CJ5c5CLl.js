import{t as e}from"./channel-B9b3kkuS.js";import{t}from"./graphlib-CC0k3srt.js";import{t as n}from"./index-01f381cb-D28wALDH.js";import{C as r,Et as i,L as a,Pt as o,R as s,Rt as c,T as l,_ as u,at as d,b as f,dn as p,fn as m,k as h,p as g,pn as _,s as v,un as y}from"./mermaid.core-Bg7wjzGb.js";function b(e){return typeof e==`string`?new p([document.querySelectorAll(e)],[document.documentElement]):new p([_(e)],m)}function x(e,t){return!!e.children(t).length}function S(e){return w(e.v)+`:`+w(e.w)+`:`+w(e.name)}var C=/:/g;function w(e){return e?String(e).replace(C,`\\:`):``}function T(e,t){t&&e.attr(`style`,t)}function E(e,t,n){t&&e.attr(`class`,t).attr(`class`,n+` `+e.attr(`class`))}function D(e,t){var n=t.graph();if(d(n)){var r=n.transition;if(i(r))return r(e)}return e}function O(e,t){var n=e.append(`foreignObject`).attr(`width`,`100000`),r=n.append(`xhtml:div`);r.attr(`xmlns`,`http://www.w3.org/1999/xhtml`);var i=t.label;switch(typeof i){case`function`:r.insert(i);break;case`object`:r.insert(function(){return i});break;default:r.html(i)}T(r,t.labelStyle),r.style(`display`,`inline-block`),r.style(`white-space`,`nowrap`);var a=r.node().getBoundingClientRect();return n.attr(`width`,a.width).attr(`height`,a.height),n}var k={},A=function(e){let t=Object.keys(e);for(let n of t)k[n]=e[n]},j=async function(e,t,n,r,i,a){let o=r.select(`[id="${n}"]`),s=Object.keys(e);for(let n of s){let r=e[n],s=`default`;r.classes.length>0&&(s=r.classes.join(` `)),s+=` flowchart-label`;let c=f(r.styles),d=r.text===void 0?r.id:r.text,p;if(l.info(`vertex`,r,r.labelType),r.labelType===`markdown`)l.info(`vertex`,r,r.labelType);else if(g(u().flowchart.htmlLabels))p=O(o,{label:d}).node(),p.parentNode.removeChild(p);else{let e=i.createElementNS(`http://www.w3.org/2000/svg`,`text`);e.setAttribute(`style`,c.labelStyle.replace(`color:`,`fill:`));let t=d.split(v.lineBreakRegex);for(let n of t){let t=i.createElementNS(`http://www.w3.org/2000/svg`,`tspan`);t.setAttributeNS(`http://www.w3.org/XML/1998/namespace`,`xml:space`,`preserve`),t.setAttribute(`dy`,`1em`),t.setAttribute(`x`,`1`),t.textContent=n,e.appendChild(t)}p=e}let m=0,_=``;switch(r.type){case`round`:m=5,_=`rect`;break;case`square`:_=`rect`;break;case`diamond`:_=`question`;break;case`hexagon`:_=`hexagon`;break;case`odd`:_=`rect_left_inv_arrow`;break;case`lean_right`:_=`lean_right`;break;case`lean_left`:_=`lean_left`;break;case`trapezoid`:_=`trapezoid`;break;case`inv_trapezoid`:_=`inv_trapezoid`;break;case`odd_right`:_=`rect_left_inv_arrow`;break;case`circle`:_=`circle`;break;case`ellipse`:_=`ellipse`;break;case`stadium`:_=`stadium`;break;case`subroutine`:_=`subroutine`;break;case`cylinder`:_=`cylinder`;break;case`group`:_=`rect`;break;case`doublecircle`:_=`doublecircle`;break;default:_=`rect`}let y=await h(d,u());t.setNode(r.id,{labelStyle:c.labelStyle,shape:_,labelText:y,labelType:r.labelType,rx:m,ry:m,class:s,style:c.style,id:r.id,link:r.link,linkTarget:r.linkTarget,tooltip:a.db.getTooltip(r.id)||``,domId:a.db.lookUpDomId(r.id),haveCallback:r.haveCallback,width:r.type===`group`?500:void 0,dir:r.dir,type:r.type,props:r.props,padding:u().flowchart.padding}),l.info(`setNode`,{labelStyle:c.labelStyle,labelType:r.labelType,shape:_,labelText:y,rx:m,ry:m,class:s,style:c.style,id:r.id,domId:a.db.lookUpDomId(r.id),width:r.type===`group`?500:void 0,type:r.type,dir:r.dir,props:r.props,padding:u().flowchart.padding})}},M=async function(e,t,n){l.info(`abc78 edges = `,e);let i=0,a={},o,s;if(e.defaultStyle!==void 0){let t=f(e.defaultStyle);o=t.style,s=t.labelStyle}for(let n of e){i++;let d=`L-`+n.start+`-`+n.end;a[d]===void 0?(a[d]=0,l.info(`abc78 new entry`,d,a[d])):(a[d]++,l.info(`abc78 new entry`,d,a[d]));let p=d+`-`+a[d];l.info(`abc78 new link id to be used is`,d,p,a[d]);let m=`LS-`+n.start,g=`LE-`+n.end,_={style:``,labelStyle:``};switch(_.minlen=n.length||1,_.arrowhead=n.type===`arrow_open`?`none`:`normal`,_.arrowTypeStart=`arrow_open`,_.arrowTypeEnd=`arrow_open`,n.type){case`double_arrow_cross`:_.arrowTypeStart=`arrow_cross`;case`arrow_cross`:_.arrowTypeEnd=`arrow_cross`;break;case`double_arrow_point`:_.arrowTypeStart=`arrow_point`;case`arrow_point`:_.arrowTypeEnd=`arrow_point`;break;case`double_arrow_circle`:_.arrowTypeStart=`arrow_circle`;case`arrow_circle`:_.arrowTypeEnd=`arrow_circle`}let y=``,b=``;switch(n.stroke){case`normal`:y=`fill:none;`,o!==void 0&&(y=o),s!==void 0&&(b=s),_.thickness=`normal`,_.pattern=`solid`;break;case`dotted`:_.thickness=`normal`,_.pattern=`dotted`,_.style=`fill:none;stroke-width:2px;stroke-dasharray:3;`;break;case`thick`:_.thickness=`thick`,_.pattern=`solid`,_.style=`stroke-width: 3.5px;fill:none;`;break;case`invisible`:_.thickness=`invisible`,_.pattern=`solid`,_.style=`stroke-width: 0;fill:none;`}if(n.style!==void 0){let e=f(n.style);y=e.style,b=e.labelStyle}_.style=_.style+=y,_.labelStyle=_.labelStyle+=b,_.curve=n.interpolate===void 0?e.defaultInterpolate===void 0?r(k.curve,c):r(e.defaultInterpolate,c):r(n.interpolate,c),n.text===void 0?n.style!==void 0&&(_.arrowheadStyle=`fill: #333`):(_.arrowheadStyle=`fill: #333`,_.labelpos=`c`),_.labelType=n.labelType,_.label=await h(n.text.replace(v.lineBreakRegex,`
`),u()),n.style===void 0&&(_.style=_.style||`stroke: #333; stroke-width: 1.5px;fill:none;`),_.labelStyle=_.labelStyle.replace(`color:`,`fill:`),_.id=p,_.classes=`flowchart-link `+m+` `+g,t.setEdge(n.start,n.end,_,i)}},N={setConf:A,addVertices:j,addEdges:M,getClasses:function(e,t){return t.db.getClasses()},draw:async function(e,r,i,o){l.info(`Drawing flowchart`);let c=o.db.getDirection();c===void 0&&(c=`TD`);let{securityLevel:d,flowchart:f}=u(),p=f.nodeSpacing||50,m=f.rankSpacing||50,h;d===`sandbox`&&(h=y(`#i`+r));let g=y(d===`sandbox`?h.nodes()[0].contentDocument.body:`body`),_=d===`sandbox`?h.nodes()[0].contentDocument:document,v=new t({multigraph:!0,compound:!0}).setGraph({rankdir:c,nodesep:p,ranksep:m,marginx:0,marginy:0}).setDefaultEdgeLabel(function(){return{}}),x,S=o.db.getSubGraphs();l.info(`Subgraphs - `,S);for(let e=S.length-1;e>=0;e--)x=S[e],l.info(`Subgraph - `,x),o.db.addVertex(x.id,{text:x.title,type:x.labelType},`group`,void 0,x.classes,x.dir);let C=o.db.getVertices(),w=o.db.getEdges();l.info(`Edges`,w);let T=0;for(T=S.length-1;T>=0;T--){x=S[T],b(`cluster`).append(`text`);for(let e=0;e<x.nodes.length;e++)l.info(`Setting up subgraphs`,x.nodes[e],x.id),v.setParent(x.nodes[e],x.id)}await j(C,v,r,g,_,o),await M(w,v);let E=g.select(`[id="${r}"]`),D=g.select(`#`+r+` g`);if(await n(D,v,[`point`,`circle`,`cross`],`flowchart`,r),s.insertTitle(E,`flowchartTitleText`,f.titleTopMargin,o.db.getDiagramTitle()),a(v,E,f.diagramPadding,f.useMaxWidth),o.db.indexNodes(`subGraph`+T),!f.htmlLabels){let e=_.querySelectorAll(`[id="`+r+`"] .edgeLabel .label`);for(let t of e){let e=t.getBBox(),n=_.createElementNS(`http://www.w3.org/2000/svg`,`rect`);n.setAttribute(`rx`,0),n.setAttribute(`ry`,0),n.setAttribute(`width`,e.width),n.setAttribute(`height`,e.height),t.insertBefore(n,t.firstChild)}}Object.keys(C).forEach(function(e){let t=C[e];if(t.link){let n=y(`#`+r+` [id="`+e+`"]`);if(n){let e=_.createElementNS(`http://www.w3.org/2000/svg`,`a`);e.setAttributeNS(`http://www.w3.org/2000/svg`,`class`,t.classes.join(` `)),e.setAttributeNS(`http://www.w3.org/2000/svg`,`href`,t.link),e.setAttributeNS(`http://www.w3.org/2000/svg`,`rel`,`noopener`),d===`sandbox`?e.setAttributeNS(`http://www.w3.org/2000/svg`,`target`,`_top`):t.linkTarget&&e.setAttributeNS(`http://www.w3.org/2000/svg`,`target`,t.linkTarget);let r=n.insert(function(){return e},`:first-child`),i=n.select(`.label-container`);i&&r.append(function(){return i.node()});let a=n.select(`.label`);a&&r.append(function(){return a.node()})}}})}},P=(t,n)=>{let r=e,i=r(t,`r`),a=r(t,`g`),s=r(t,`b`);return o(i,a,s,n)},F=e=>`.label {
    font-family: ${e.fontFamily};
    color: ${e.nodeTextColor||e.textColor};
  }
  .cluster-label text {
    fill: ${e.titleColor};
  }
  .cluster-label span,p {
    color: ${e.titleColor};
  }

  .label text,span,p {
    fill: ${e.nodeTextColor||e.textColor};
    color: ${e.nodeTextColor||e.textColor};
  }

  .node rect,
  .node circle,
  .node ellipse,
  .node polygon,
  .node path {
    fill: ${e.mainBkg};
    stroke: ${e.nodeBorder};
    stroke-width: 1px;
  }
  .flowchart-label text {
    text-anchor: middle;
  }
  // .flowchart-label .text-outer-tspan {
  //   text-anchor: middle;
  // }
  // .flowchart-label .text-inner-tspan {
  //   text-anchor: start;
  // }

  .node .katex path {
    fill: #000;
    stroke: #000;
    stroke-width: 1px;
  }

  .node .label {
    text-align: center;
  }
  .node.clickable {
    cursor: pointer;
  }

  .arrowheadPath {
    fill: ${e.arrowheadColor};
  }

  .edgePath .path {
    stroke: ${e.lineColor};
    stroke-width: 2.0px;
  }

  .flowchart-link {
    stroke: ${e.lineColor};
    fill: none;
  }

  .edgeLabel {
    background-color: ${e.edgeLabelBackground};
    rect {
      opacity: 0.5;
      background-color: ${e.edgeLabelBackground};
      fill: ${e.edgeLabelBackground};
    }
    text-align: center;
  }

  /* For html labels only */
  .labelBkg {
    background-color: ${P(e.edgeLabelBackground,.5)};
    // background-color: 
  }

  .cluster rect {
    fill: ${e.clusterBkg};
    stroke: ${e.clusterBorder};
    stroke-width: 1px;
  }

  .cluster text {
    fill: ${e.titleColor};
  }

  .cluster span,p {
    color: ${e.titleColor};
  }
  /* .cluster div {
    color: ${e.titleColor};
  } */

  div.mermaidTooltip {
    position: absolute;
    text-align: center;
    max-width: 200px;
    padding: 2px;
    font-family: ${e.fontFamily};
    font-size: 12px;
    background: ${e.tertiaryColor};
    border: 1px solid ${e.border2};
    border-radius: 2px;
    pointer-events: none;
    z-index: 100;
  }

  .flowchartTitleText {
    text-anchor: middle;
    font-size: 18px;
    fill: ${e.textColor};
  }
`;export{T as a,x as c,E as i,b as l,F as n,D as o,O as r,S as s,N as t};