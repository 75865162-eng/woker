import { NextResponse } from 'next/server';
import { wmsRequestScope, readJson, wmsErrorResponse } from '../wms/_shared';
import { queryCostAdjustments, mutateCostAdjustment } from '@/lib/wms/cost-adjustment-service';
export const runtime='nodejs';
const headers={'Cache-Control':'no-store'};
export async function GET(request:Request){try{const auth=await wmsRequestScope(request);if('response' in auth)return auth.response;return NextResponse.json(await queryCostAdjustments(auth.scope,new URL(request.url).searchParams),{headers});}catch(error){return wmsErrorResponse(error);}}
export async function POST(request:Request){try{const body=await readJson(request),auth=await wmsRequestScope(request);if('response' in auth)return auth.response;return NextResponse.json(await mutateCostAdjustment(auth.scope,body),{headers});}catch(error){return wmsErrorResponse(error);}}
