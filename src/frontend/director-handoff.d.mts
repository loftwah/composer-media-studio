export function directorHandoff(projectId:string,plan:{id:string;revision:number;scenes:{id:string;direction:string;referenceAssetId:string|null}[]},sceneIds:string[],intent:string):string|null;
export function currentDirectorHandoff(handoff:{text:string;fingerprint:string}|null,fingerprint:string,changed:boolean):string;
