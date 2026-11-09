import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { callSyncChatTool } from "@/lib/lili/sync-chat-server";

test("sync chat server pins actor/workspace/request and refuses missing grants or changed credential before domain writes",async()=>{
 const globals=globalThis as unknown as {prisma?:PrismaClient};const previous=globals.prisma;
 let actions=["view","sync"],marketplaceId="US",operation="run",hasSyncTool=true,revoked=false,reads=0,liliDevice=false;
 const credential={id:"credential",organizationId:"org",workspaceId:"workspace",userId:"owner",status:"ACTIVE",name:"fixture",revision:1,expiresAt:new Date(Date.now()+60_000),scopes:[{sellerAccountId:"seller",marketplaceIds:["US"]}],tools:["workflow_sync_review","workflow_sync_confirm","data_sync_start"]};
 const row={id:"owned",organizationId:"org",workspaceId:"workspace",requestedByUserId:"owner",operation:"run",changeDigest:"a".repeat(64),baseRevision:1,status:"REQUESTED",expiresAt:new Date(Date.now()+60_000),sourceIds:["source"]};
 globals.prisma={
  amazonMcpCredential:{findUnique:async()=>({...credential,name:liliDevice?"Lili device: fixture":credential.name,status:revoked?"REVOKED":"ACTIVE",tools:hasSyncTool?credential.tools:credential.tools.filter(t=>t!=="data_sync_start")})},
  liliOAuthGrant:{findUnique:async()=>liliDevice?{resource:"http://localhost/api/lili/mcp",expiresAt:credential.expiresAt,revokedAt:null}:null},auditLog:{create:async()=>({})},
  organizationMember:{findUnique:async()=>({role:"owner",user:{status:"active"}})},
  organizationRosterRole:{findMany:async()=>[]},workspaceScope:{findUnique:async()=>({id:"workspace"})},
  amazonDataAccessGrant:{findMany:async()=>[{sellerAccountId:"seller",marketplaceIds:["US"],actions}]},amazonRoleDataAccessGrant:{findMany:async()=>[]},
  amazonDataCenterChangeRequest:{findFirst:async({where}:{where:Record<string,unknown>})=>{
   reads++;assert.equal(where.organizationId,"org");assert.equal(where.workspaceId,"workspace");assert.equal(where.requestedByUserId,"owner");assert.equal(where.operation,"run");
   return where.id==="owned"&&operation==="run"?row:null;
  }},
  amazonSyncDataSource:{findMany:async()=>[{id:"source",sellerAccountId:"seller",marketplaceId}]},
  $transaction:async()=>{throw new Error("UNEXPECTED_DOMAIN_WRITE");},
 } as unknown as PrismaClient;
 const request=new Request("http://localhost/api/lili/mcp",{headers:{authorization:"Bearer amcp_"+"a".repeat(43)}});
 const args={workspaceId:"workspace",requestId:"owned"};
 try{
  const result=await callSyncChatTool(request,"workflow_sync_review",args);assert.equal(result.ok,true);assert.equal(result.nextAction?.kind,"CHAT_CONFIRM");
  const before=reads;await assert.rejects(callSyncChatTool(request,"workflow_sync_review",{...args,workspaceId:"other"}),/ACCESS_DENIED/);assert.equal(reads,before);
  await assert.rejects(callSyncChatTool(request,"workflow_sync_review",{...args,requestId:"other"}),/NOT_FOUND/);
  actions=["view"];await assert.rejects(callSyncChatTool(request,"workflow_sync_review",args));actions=["view","sync"];
  marketplaceId="CA";await assert.rejects(callSyncChatTool(request,"workflow_sync_review",args),/ACCESS_DENIED/);marketplaceId="US";
  operation="save-authorization";await assert.rejects(callSyncChatTool(request,"workflow_sync_review",args),/NOT_FOUND/);operation="run";
  hasSyncTool=false;await assert.rejects(callSyncChatTool(request,"workflow_sync_review",args),/ACCESS_DENIED/);liliDevice=true;
  assert.equal((await callSyncChatTool(request,"workflow_sync_review",args)).ok,true,"Lili device inherits live account tool permissions without duplicate grants");
  actions=["view"];await assert.rejects(callSyncChatTool(request,"workflow_sync_review",args),"view access must not become sync access");actions=["view","sync"];
  hasSyncTool=true;
  revoked=true;await assert.rejects(callSyncChatTool(request,"workflow_sync_review",args));
 }finally{globals.prisma=previous;}
});
