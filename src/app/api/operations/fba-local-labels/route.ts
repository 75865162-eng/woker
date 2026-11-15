import {createShipmentLabel,downloadShipmentLabel} from '@/lib/fba-local/shipment-label-service';
import {wmsRequestScope,wmsErrorResponse,readJson} from '../wms/_shared';
export const runtime='nodejs';
export async function GET(request:Request){
 try{
  const auth=await wmsRequestScope(request);if('response' in auth)return auth.response;
  const labelId=new URL(request.url).searchParams.get('labelId');
  const result=await downloadShipmentLabel(auth.scope,labelId??'');
  return new Response(new Uint8Array(result.buffer),{headers:{
   'Cache-Control':'no-store',
   'Content-Type':result.mimeType,
   'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`,
   'Content-Security-Policy':"default-src 'none'; sandbox",
   'X-Content-Type-Options':'nosniff',
  }});
 }catch(error){return wmsErrorResponse(error);}
}
export async function POST(request:Request){
 try{
  const auth=await wmsRequestScope(request);if('response' in auth)return auth.response;
  return Response.json(await createShipmentLabel(auth.scope,await readJson(request)),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return wmsErrorResponse(error);}
}
