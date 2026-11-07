export function digest(text: string): string;
export function syncSkill(options: { root: string; skillId: string; endpoint: string; rpc(name: string, args: Record<string,string>): Promise<unknown> }): Promise<{status: string; path: string; manifest: {sha256:string;[key:string]:unknown}}>;
