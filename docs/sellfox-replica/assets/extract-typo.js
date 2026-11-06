(function(){
  function S(el){if(!el)return null;const c=getComputedStyle(el);return{fontFamily:c.fontFamily,fontSize:c.fontSize,fontWeight:c.fontWeight,lineHeight:c.lineHeight,color:c.color};}
  function Q(s){return document.querySelector(s);}
  function first(sels){for(const s of sels){const el=Q(s);if(el){const r=el.getBoundingClientRect();if(r.width>0||r.height>0)return{selector:s,...S(el)};}}return null;}
  const out={
    body:first(['body']),
    tableHeaderTh:first(['.ant-table-thead th','.ant-table-header th','thead th','th']),
    tableTd:first(['.ant-table-tbody td','tbody td','td']),
    filterLabel:first(['.ant-form-item-label label','.filter-item label','[class*="filter"] label','label']),
    filterInput:first(['.ant-input','.ant-picker-input input','input.ant-input']),
    filterSelect:first(['.ant-select-selection-item','.ant-select-selector','.ant-select']),
    buttonPrimary:first(['.ant-btn-primary','button.ant-btn-primary']),
    buttonDefault:first(['.ant-btn-default','.ant-btn:not(.ant-btn-primary)']),
    buttonSmall:first(['.ant-btn-sm','button.ant-btn-sm']),
    sectionHeaderH2:first(['h2','.ant-page-header-heading-title','.page-title']),
    tabStrip:first(['.ant-tabs-tab-active','.ant-tabs-tab','[role="tab"][aria-selected="true"]','[role="tab"]']),
    totalsBar:first(['[class*="total"]','.ant-table-summary','[class*="Summary"]','[class*="stat"]']),
    pagination:first(['.ant-pagination-total-text','.ant-pagination-item','.ant-pagination'])
  };
  let pre=document.getElementById('__typo_capture__');
  if(!pre){pre=document.createElement('pre');pre.id='__typo_capture__';pre.style.cssText='position:fixed;left:0;top:0;z-index:2147483647;background:#fff;color:#000;max-width:90vw;max-height:40vh;overflow:auto;font:12px monospace;border:2px solid red';document.body.appendChild(pre);}
  pre.textContent=JSON.stringify(out,null,2);
  return out;
})();
