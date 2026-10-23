export interface RuntimeSender {id?:string;}
export type RuntimeListener=(message:unknown,sender:RuntimeSender,reply:(value:unknown)=>void)=>boolean|void;
export interface ChromeApi {
  storage?:{local:{get(key:string):Promise<Record<string,unknown>>;set(values:Record<string,unknown>):Promise<void>}};
  runtime?:{id?:string;onMessage?:{addListener(listener:RuntimeListener):void;removeListener(listener:RuntimeListener):void}};
}

export function extensionApi():ChromeApi|undefined {
  return (globalThis as unknown as {chrome?:ChromeApi}).chrome;
}
