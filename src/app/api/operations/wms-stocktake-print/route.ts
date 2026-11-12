import {exportStocktakePrint} from '@/lib/wms/stocktake-print-service';
import {wmsErrorResponse,wmsRequestScope} from '../wms/_shared';
export const runtime='nodejs';
export async function GET(request:Request){try{const auth=await wmsRequestScope(request);if('response' in auth)return auth.response;const html=await exportStocktakePrint(auth.scope,new URL(request.url).searchParams.get('id')??'');return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Disposition':'attachment; filename="stocktake.html"','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox",'X-Content-Type-Options':'nosniff'}});}catch(error){return wmsErrorResponse(error);}}
