import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdsBusinessChanges } from '../../src/components/amazon-ads/ads-business-changes';
import { ProductManagementFields } from '../../src/components/products/product-management-fields';
import { emptyProductManagement } from '../../src/lib/products/management-contract';
function Harness() {
  const [management, setManagement] = useState(emptyProductManagement());
  return <><h1>隔离组件验收</h1><AdsBusinessChanges profileId="fixture-profile" entityType="SP:campaign" externalId="101" /><ProductManagementFields workspaceId="fixture-workspace" value={management} onChange={setManagement} /><output aria-label="商品表单值">{JSON.stringify(management)}</output></>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
